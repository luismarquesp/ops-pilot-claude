import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_DB_PATH } from "./sqlite-ops-store.js";
import type { Approval, ApprovalStatus, ApprovalStore, NewApproval } from "./approval-store.js";
import { ApprovalAlreadyDecidedError, ApprovalExpiredError, ApprovalNotFoundError } from "../services/errors.js";

interface ApprovalRow {
	id: string;
	turn_id: string;
	conversation_id: string;
	request_id: string | null;
	message: string;
	user_id: string | null;
	route: string;
	reflect: number;
	tool: string;
	args_json: string;
	summary: string;
	status: ApprovalStatus;
	created_at: string;
	expires_at: string;
	decided_at: string | null;
	result_json: string | null;
}

const DDL = `
	CREATE TABLE IF NOT EXISTS approvals (
		id TEXT PRIMARY KEY,
		turn_id TEXT NOT NULL,
		conversation_id TEXT NOT NULL,
		request_id TEXT,
		message TEXT NOT NULL,
		user_id TEXT,
		route TEXT NOT NULL,
		reflect INTEGER NOT NULL DEFAULT 0,
		tool TEXT NOT NULL,
		args_json TEXT NOT NULL,
		summary TEXT NOT NULL,
		status TEXT NOT NULL CHECK (status IN ('pending','approved','denied','expired')),
		created_at TEXT NOT NULL,
		expires_at TEXT NOT NULL,
		decided_at TEXT,
		result_json TEXT
	);

	CREATE INDEX IF NOT EXISTS approvals_conversation_status ON approvals(conversation_id, status);
	CREATE INDEX IF NOT EXISTS approvals_turn ON approvals(turn_id);
`;

function toApproval(row: ApprovalRow): Approval {
	return {
		id: row.id,
		turnId: row.turn_id,
		conversationId: row.conversation_id,
		requestId: row.request_id,
		message: row.message,
		userId: row.user_id,
		route: row.route,
		reflect: row.reflect === 1,
		tool: row.tool,
		args: JSON.parse(row.args_json) as unknown,
		summary: row.summary,
		status: row.status,
		createdAt: row.created_at,
		expiresAt: row.expires_at,
		decidedAt: row.decided_at,
		result: row.result_json,
	};
}

/**
 * Aprovações persistidas (specs/018, data-model.md) no mesmo `OPSPILOT_DB`.
 * Expiração preguiçosa (sem timers) e decisão por `UPDATE` condicional
 * (`changes = 1` vence) — research §3.
 */
export class SqliteApprovalStore implements ApprovalStore {
	private readonly db: DatabaseSync;

	constructor(path: string = DEFAULT_DB_PATH) {
		if (path !== ":memory:") {
			mkdirSync(dirname(path), { recursive: true });
		}
		this.db = new DatabaseSync(path);
		this.db.exec(DDL);
	}

	private row(id: string): ApprovalRow | undefined {
		return this.db.prepare("SELECT * FROM approvals WHERE id = ?").get(id) as unknown as ApprovalRow | undefined;
	}

	private expire(now: Date, where: string, ...params: string[]): void {
		this.db
			.prepare(`UPDATE approvals SET status = 'expired' WHERE status = 'pending' AND expires_at <= ? AND ${where}`)
			.run(now.toISOString(), ...params);
	}

	async create(input: NewApproval): Promise<Approval> {
		this.db
			.prepare(
				`INSERT INTO approvals (id, turn_id, conversation_id, request_id, message, user_id, route, reflect, tool, args_json,
					summary, status, created_at, expires_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
			)
			.run(
				input.id,
				input.turnId,
				input.conversationId,
				input.requestId,
				input.message,
				input.userId,
				input.route,
				input.reflect ? 1 : 0,
				input.tool,
				JSON.stringify(input.args ?? {}),
				input.summary,
				input.createdAt,
				input.expiresAt,
			);
		return toApproval(this.row(input.id)!);
	}

	async get(id: string, now: Date): Promise<Approval | undefined> {
		this.expire(now, "id = ?", id);
		const row = this.row(id);
		return row ? toApproval(row) : undefined;
	}

	async listPending(conversationId: string, now: Date): Promise<Approval[]> {
		this.expire(now, "conversation_id = ?", conversationId);
		const rows = this.db
			.prepare("SELECT * FROM approvals WHERE conversation_id = ? AND status = 'pending' ORDER BY created_at, id")
			.all(conversationId) as unknown as ApprovalRow[];
		return rows.map(toApproval);
	}

	async decide(id: string, decision: "approved" | "denied", now: Date): Promise<Approval> {
		const iso = now.toISOString();
		const { changes } = this.db
			.prepare("UPDATE approvals SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending' AND expires_at > ?")
			.run(decision, iso, id, iso);
		if (Number(changes) === 1) {
			return toApproval(this.row(id)!);
		}
		const row = this.row(id);
		if (!row) {
			throw new ApprovalNotFoundError(id);
		}
		if (row.status === "pending" || row.status === "expired") {
			this.expire(now, "id = ?", id);
			throw new ApprovalExpiredError(id);
		}
		throw new ApprovalAlreadyDecidedError(id, row.status);
	}

	async saveResult(id: string, result: string): Promise<void> {
		this.db.prepare("UPDATE approvals SET result_json = ? WHERE id = ?").run(result, id);
	}

	async ledger(turnId: string): Promise<Approval[]> {
		const rows = this.db
			.prepare("SELECT * FROM approvals WHERE turn_id = ? AND status <> 'pending' ORDER BY created_at, id")
			.all(turnId) as unknown as ApprovalRow[];
		return rows.map(toApproval);
	}

	close(): void {
		this.db.close();
	}
}

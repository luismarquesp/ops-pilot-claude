import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_DB_PATH } from "./sqlite-ops-store.js";
import type { GraphTraceEvent } from "../graph/production-graph.js";
import type { RequestErrorCode, RequestRecord, RequestStatRow, RequestStore, StoredRequest } from "./request-store.js";

interface RequestRow {
	id: string;
	started_at: string;
	duration_ms: number;
	status: number;
	outcome: "ok" | "error";
	error_code: RequestErrorCode | null;
	conversation_id: string | null;
	user_id: string | null;
	route: string | null;
	route_source: string | null;
	model_used: string | null;
	prompt_tokens: number | null;
	latency_ms: number | null;
	metrics_json: string | null;
}

const DDL = `
	PRAGMA foreign_keys = ON;

	CREATE TABLE IF NOT EXISTS requests (
		id TEXT PRIMARY KEY,
		started_at TEXT NOT NULL,
		duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
		status INTEGER NOT NULL,
		outcome TEXT NOT NULL CHECK (outcome IN ('ok','error')),
		error_code TEXT,
		conversation_id TEXT,
		user_id TEXT,
		route TEXT,
		route_source TEXT,
		model_used TEXT,
		prompt_tokens INTEGER,
		latency_ms INTEGER,
		metrics_json TEXT
	);

	CREATE INDEX IF NOT EXISTS requests_started_at ON requests(started_at);

	CREATE TABLE IF NOT EXISTS trace_events (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
		seq INTEGER NOT NULL CHECK (seq >= 0),
		type TEXT NOT NULL,
		node TEXT NOT NULL,
		payload TEXT NOT NULL,
		UNIQUE (request_id, seq)
	);
`;

function toRecord(row: RequestRow): RequestRecord {
	return {
		id: row.id,
		startedAt: row.started_at,
		durationMs: row.duration_ms,
		status: row.status,
		outcome: row.outcome,
		errorCode: row.error_code,
		conversationId: row.conversation_id,
		userId: row.user_id,
		route: row.route,
		routeSource: row.route_source,
		modelUsed: row.model_used,
		promptTokens: row.prompt_tokens,
		latencyMs: row.latency_ms,
		metrics: row.metrics_json === null ? null : JSON.parse(row.metrics_json),
	};
}

/**
 * Requisições + rastro persistidos (specs/016, data-model.md) via `node:sqlite`,
 * no padrão do `SqliteConversationStore`: DDL idempotente no construtor,
 * prepared statements, mesmo arquivo `OPSPILOT_DB`. `save` é uma transação
 * explícita (research.md §4).
 */
export class SqliteRequestStore implements RequestStore {
	private readonly db: DatabaseSync;

	constructor(path: string = DEFAULT_DB_PATH) {
		if (path !== ":memory:") {
			mkdirSync(dirname(path), { recursive: true });
		}
		this.db = new DatabaseSync(path);
		this.db.exec(DDL);
	}

	async save(record: RequestRecord, trace: readonly GraphTraceEvent[]): Promise<void> {
		const insertRequest = this.db.prepare(
			`INSERT INTO requests (id, started_at, duration_ms, status, outcome, error_code, conversation_id, user_id,
				route, route_source, model_used, prompt_tokens, latency_ms, metrics_json)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		const insertEvent = this.db.prepare(
			"INSERT INTO trace_events (request_id, seq, type, node, payload) VALUES (?, ?, ?, ?, ?)",
		);

		this.db.exec("BEGIN");
		try {
			insertRequest.run(
				record.id,
				record.startedAt,
				record.durationMs,
				record.status,
				record.outcome,
				record.errorCode,
				record.conversationId,
				record.userId,
				record.route,
				record.routeSource,
				record.modelUsed,
				record.promptTokens,
				record.latencyMs,
				record.metrics === null ? null : JSON.stringify(record.metrics),
			);
			trace.forEach((event, seq) => {
				insertEvent.run(record.id, seq, event.type, event.node, JSON.stringify(event));
			});
			this.db.exec("COMMIT");
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	async get(id: string): Promise<StoredRequest | undefined> {
		const row = this.db.prepare("SELECT * FROM requests WHERE id = ?").get(id) as unknown as RequestRow | undefined;
		if (!row) {
			return undefined;
		}
		const events = this.db
			.prepare("SELECT payload FROM trace_events WHERE request_id = ? ORDER BY seq")
			.all(id) as unknown as Array<{ payload: string }>;
		return { request: toRecord(row), trace: events.map((event) => JSON.parse(event.payload) as GraphTraceEvent) };
	}

	async listSince(from: string): Promise<RequestStatRow[]> {
		return this.db
			.prepare(
				`SELECT started_at AS startedAt, status, outcome, route, model_used AS modelUsed,
					prompt_tokens AS promptTokens, duration_ms AS durationMs
				 FROM requests WHERE started_at >= ? ORDER BY started_at, id`,
			)
			.all(from)
			.map((row) => ({ ...row }) as unknown as RequestStatRow);
	}

	/** Acesso cru para os testes de atomicidade e cascade. */
	exec(sql: string): void {
		this.db.exec(sql);
	}

	count(table: "requests" | "trace_events"): number {
		const row = this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as unknown as { n: number };
		return row.n;
	}

	close(): void {
		this.db.close();
	}
}

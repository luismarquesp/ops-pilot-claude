import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ConversationNotFoundError } from "../services/errors.js";
import { DEFAULT_DB_PATH } from "./sqlite-ops-store.js";
import { assertValidSummary } from "./conversation-store.js";
import type {
	Conversation,
	ConversationMessage,
	ConversationStore,
	ConversationSummary,
	MessageRole,
	NewConversationSummary,
	StoredMessage,
} from "./conversation-store.js";

interface MessageRow {
	role: MessageRole;
	content: string;
	created_at: string;
}

interface SummaryRow {
	summary: string;
	covered_until: number;
	messages_covered: number;
	updated_at: string;
}

const DDL = `
	PRAGMA foreign_keys = ON;

	CREATE TABLE IF NOT EXISTS conversations (
		id TEXT PRIMARY KEY,
		created_at TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		conversation_id TEXT NOT NULL REFERENCES conversations(id),
		role TEXT NOT NULL CHECK (role IN ('user','assistant')),
		content TEXT NOT NULL CHECK (length(content) > 0),
		created_at TEXT NOT NULL
	);

	CREATE INDEX IF NOT EXISTS messages_conversation_id_id ON messages (conversation_id, id);

	CREATE TABLE IF NOT EXISTS conversation_summaries (
		conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
		summary TEXT NOT NULL CHECK (length(summary) > 0),
		covered_until INTEGER NOT NULL CHECK (covered_until > 0),
		messages_covered INTEGER NOT NULL CHECK (messages_covered > 0),
		updated_at TEXT NOT NULL
	);
`;

/**
 * Conversas persistentes do chat (specs/007) via `node:sqlite`, no mesmo
 * padrão do `SqliteOpsStore`: DDL idempotente no construtor, prepared
 * statements em toda query, mesmo arquivo `OPSPILOT_DB` (research.md §7).
 * Ordem cronológica = `messages.id` crescente.
 */
export class SqliteConversationStore implements ConversationStore {
	private readonly db: DatabaseSync;

	constructor(path: string = DEFAULT_DB_PATH) {
		if (path !== ":memory:") {
			mkdirSync(dirname(path), { recursive: true });
		}
		this.db = new DatabaseSync(path);
		this.db.exec(DDL);
	}

	private assertExists(conversationId: string): void {
		const row = this.db.prepare("SELECT 1 AS found FROM conversations WHERE id = ?").get(conversationId);
		if (!row) {
			throw new ConversationNotFoundError(conversationId);
		}
	}

	async create(): Promise<Conversation> {
		const conversation = { id: randomUUID(), createdAt: new Date().toISOString() };
		this.db
			.prepare("INSERT INTO conversations (id, created_at) VALUES (?, ?)")
			.run(conversation.id, conversation.createdAt);
		return conversation;
	}

	async append(conversationId: string, role: MessageRole, content: string): Promise<ConversationMessage> {
		this.assertExists(conversationId);

		const createdAt = new Date().toISOString();
		this.db
			.prepare("INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)")
			.run(conversationId, role, content, createdAt);
		return { role, content, createdAt };
	}

	async lastMessages(conversationId: string, limit: number): Promise<ConversationMessage[]> {
		this.assertExists(conversationId);

		const rows = this.db
			.prepare(
				`SELECT role, content, created_at
				 FROM messages
				 WHERE conversation_id = ?
				 ORDER BY id DESC
				 LIMIT ?`,
			)
			.all(conversationId, Math.max(limit, 0)) as unknown as MessageRow[];

		return rows.reverse().map((row) => ({ role: row.role, content: row.content, createdAt: row.created_at }));
	}

	async messagesSince(conversationId: string, afterSeq: number): Promise<StoredMessage[]> {
		this.assertExists(conversationId);

		const rows = this.db
			.prepare(
				`SELECT id, role, content, created_at
				 FROM messages
				 WHERE conversation_id = ? AND id > ?
				 ORDER BY id`,
			)
			.all(conversationId, afterSeq) as unknown as Array<MessageRow & { id: number }>;

		return rows.map((row) => ({ seq: row.id, role: row.role, content: row.content, createdAt: row.created_at }));
	}

	async getSummary(conversationId: string): Promise<ConversationSummary | undefined> {
		this.assertExists(conversationId);

		const row = this.db
			.prepare("SELECT summary, covered_until, messages_covered, updated_at FROM conversation_summaries WHERE conversation_id = ?")
			.get(conversationId) as unknown as SummaryRow | undefined;

		return row
			? { summary: row.summary, coveredUntil: row.covered_until, messagesCovered: row.messages_covered, updatedAt: row.updated_at }
			: undefined;
	}

	/** Upsert condicional (specs/012, research.md §6): só substitui se a cobertura avançar. */
	async saveSummary(conversationId: string, summary: NewConversationSummary): Promise<boolean> {
		assertValidSummary(summary);
		this.assertExists(conversationId);

		const { changes } = this.db
			.prepare(
				`INSERT INTO conversation_summaries (conversation_id, summary, covered_until, messages_covered, updated_at)
				 VALUES (?, ?, ?, ?, ?)
				 ON CONFLICT(conversation_id) DO UPDATE SET
					summary = excluded.summary,
					covered_until = excluded.covered_until,
					messages_covered = excluded.messages_covered,
					updated_at = excluded.updated_at
				 WHERE excluded.covered_until > conversation_summaries.covered_until`,
			)
			.run(conversationId, summary.summary, summary.coveredUntil, summary.messagesCovered, new Date().toISOString());
		return Number(changes) > 0;
	}

	/** Fecha o arquivo/handle do SQLite — usado pelos testes para não vazar handles entre casos. */
	close(): void {
		this.db.close();
	}
}

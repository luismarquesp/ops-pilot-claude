import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_DB_PATH } from "../store/sqlite-ops-store.js";
import type { Embedder } from "./embeddings.js";
import { findDuplicate, fromBlob, rankBySimilarity, toBlob } from "./similarity.js";

/** Máximo de fatos devolvidos por `recall` (FR-003). */
export const RECALL_LIMIT = 3;
/** Similaridade mínima (inclusiva) para um fato entrar no `recall` (FR-003). */
export const RECALL_MIN_SCORE = 0.3;
/** Similaridade acima da qual `remember` considera o fato duplicado (FR-002). */
export const DEDUP_THRESHOLD = 0.92;

/** Um fato duradouro sobre um usuário (specs/008, data-model.md). O vetor não sai do store. */
export interface Memory {
	id: string;
	userId: string;
	fact: string;
	createdAt: string;
}

export interface RememberResult {
	memory: Memory;
	/** `false` quando um fato equivalente já existia e foi devolvido no lugar. */
	created: boolean;
}

export type RecalledMemory = Memory & { score: number };

/**
 * Model da memória semântica por usuário (constitution Princípio III). Toda
 * operação é restrita ao `userId` informado. Ver contracts/memory-store.md.
 */
export interface MemoryStore {
	/** Guarda `fact` para `userId`, a menos que já exista um fato com similaridade > 0,92. */
	remember(userId: string, fact: string): Promise<RememberResult>;

	/** Até `k` fatos de `userId` com similaridade ≥ 0,3 a `query`, do mais para o menos similar. */
	recall(userId: string, query: string, k?: number): Promise<RecalledMemory[]>;

	/** Remove o fato `memoryId` de `userId`; `false` se não existe ou é de outro usuário. */
	forget(userId: string, memoryId: string): Promise<boolean>;

	/**
	 * Todos os fatos de `userId`, do mais recente para o mais antigo (specs/010).
	 * Não lê embeddings nem chama o embedder. Usuário sem fatos → `[]`.
	 */
	list(userId: string): Promise<Memory[]>;
}

interface MemoryRow {
	id: string;
	user_id: string;
	fact: string;
	embedding: Uint8Array;
	created_at: string;
}

type Candidate = Memory & { embedding: Float32Array };

const DDL = `
	CREATE TABLE IF NOT EXISTS memories (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL CHECK (length(user_id) > 0),
		fact TEXT NOT NULL CHECK (length(fact) > 0),
		embedding BLOB NOT NULL,
		created_at TEXT NOT NULL
	);

	CREATE INDEX IF NOT EXISTS memories_user_id ON memories (user_id);
`;

function toMemory({ id, userId, fact, createdAt }: Memory): Memory {
	return { id, userId, fact, createdAt };
}

/**
 * Memória semântica via `node:sqlite` (research.md §3/§5), no mesmo padrão do
 * `SqliteConversationStore`: DDL idempotente no construtor, prepared
 * statements, mesmo arquivo `OPSPILOT_DB`. O embedding é gravado como BLOB.
 */
export class SqliteMemoryStore implements MemoryStore {
	private readonly db: DatabaseSync;

	constructor(
		private readonly embedder: Embedder,
		path: string = DEFAULT_DB_PATH,
	) {
		if (path !== ":memory:") {
			mkdirSync(dirname(path), { recursive: true });
		}
		this.db = new DatabaseSync(path);
		this.db.exec(DDL);
	}

	private loadCandidates(userId: string): Candidate[] {
		const rows = this.db
			.prepare("SELECT id, user_id, fact, embedding, created_at FROM memories WHERE user_id = ?")
			.all(userId) as unknown as MemoryRow[];

		return rows.map((row) => ({
			id: row.id,
			userId: row.user_id,
			fact: row.fact,
			createdAt: row.created_at,
			embedding: fromBlob(row.embedding),
		}));
	}

	async remember(userId: string, fact: string): Promise<RememberResult> {
		const embedding = await this.embedder.embed(fact);

		const duplicate = findDuplicate(embedding, this.loadCandidates(userId), DEDUP_THRESHOLD);
		if (duplicate) {
			return { memory: toMemory(duplicate), created: false };
		}

		const memory: Memory = { id: randomUUID(), userId, fact, createdAt: new Date().toISOString() };
		this.db
			.prepare("INSERT INTO memories (id, user_id, fact, embedding, created_at) VALUES (?, ?, ?, ?, ?)")
			.run(memory.id, memory.userId, memory.fact, toBlob(embedding), memory.createdAt);
		return { memory, created: true };
	}

	async recall(userId: string, query: string, k: number = RECALL_LIMIT): Promise<RecalledMemory[]> {
		const candidates = this.loadCandidates(userId);
		if (candidates.length === 0) {
			return [];
		}

		const vector = await this.embedder.embed(query);
		return rankBySimilarity(vector, candidates, { limit: k, minScore: RECALL_MIN_SCORE }).map((candidate) => ({
			...toMemory(candidate),
			score: candidate.score,
		}));
	}

	async forget(userId: string, memoryId: string): Promise<boolean> {
		const { changes } = this.db.prepare("DELETE FROM memories WHERE id = ? AND user_id = ?").run(memoryId, userId);
		return Number(changes) > 0;
	}

	async list(userId: string): Promise<Memory[]> {
		const rows = this.db
			.prepare(
				`SELECT id, user_id, fact, created_at
				 FROM memories
				 WHERE user_id = ?
				 ORDER BY created_at DESC, rowid DESC`,
			)
			.all(userId) as unknown as Omit<MemoryRow, "embedding">[];

		return rows.map((row) => ({ id: row.id, userId: row.user_id, fact: row.fact, createdAt: row.created_at }));
	}

	/** Fecha o handle do SQLite — usado pelos testes para não vazar handles entre casos. */
	close(): void {
		this.db.close();
	}
}

import type { GraphTraceEvent } from "../graph/production-graph.js";
import type { RequestRecord, RequestStatRow, RequestStore, StoredRequest } from "./request-store.js";

export interface MockRequestStoreOptions {
	/** Simula banco indisponível: todo `save` rejeita sem gravar (specs/016, FR-007). */
	failOnSave?: boolean;
}

/**
 * `RequestStore` em memória, sem I/O — fake dos testes (specs/016). Guarda
 * cópias (`structuredClone`), como o SQLite guarda JSON: mutar a entrada depois
 * não muda o registro.
 */
export function createMockRequestStore({ failOnSave = false }: MockRequestStoreOptions = {}): RequestStore {
	const byId = new Map<string, StoredRequest>();

	return {
		async save(record: RequestRecord, trace: readonly GraphTraceEvent[]): Promise<void> {
			if (failOnSave) {
				throw new Error("falha simulada ao gravar");
			}
			if (byId.has(record.id)) {
				throw new Error(`Requisição já gravada: ${record.id}`);
			}
			byId.set(record.id, structuredClone({ request: record, trace: [...trace] }));
		},

		async get(id: string): Promise<StoredRequest | undefined> {
			const stored = byId.get(id);
			return stored ? structuredClone(stored) : undefined;
		},

		async listSince(from: string): Promise<RequestStatRow[]> {
			return [...byId.values()]
				.map(({ request }) => request)
				.filter((request) => request.startedAt >= from)
				.sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0))
				.map(({ startedAt, status, outcome, route, modelUsed, promptTokens, durationMs }) => ({ startedAt, status, outcome, route, modelUsed, promptTokens, durationMs }));
		},
	};
}

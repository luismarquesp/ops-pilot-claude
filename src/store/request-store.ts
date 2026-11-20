import type { ChatMetrics } from "../services/chat-service.js";
import type { GraphTraceEvent } from "../graph/production-graph.js";

/** Códigos de erro de turno persistidos (specs/016, data-model.md). 400/422 não são persistidos. */
export type RequestErrorCode =
	| "conversation_not_found"
	| "model_unavailable"
	| "timeout"
	| "internal_error"
	// specs/018 — decisão de aprovação
	| "approval_not_found"
	| "approval_already_decided"
	| "approval_expired";

/**
 * Registro de um turno do `/chat` que passou da validação (specs/016). As
 * colunas planas `modelUsed`/`promptTokens`/`latencyMs` são cópias de `metrics`
 * para consulta direta; `metrics` guarda o `ChatMetrics` completo.
 */
export interface RequestRecord {
	id: string;
	startedAt: string;
	durationMs: number;
	status: number;
	outcome: "ok" | "error";
	errorCode: RequestErrorCode | null;
	conversationId: string | null;
	userId: string | null;
	route: string | null;
	routeSource: string | null;
	modelUsed: string | null;
	promptTokens: number | null;
	latencyMs: number | null;
	metrics: ChatMetrics | null;
}

/** Linha enxuta para agregação (specs/017): só colunas planas, sem métricas nem rastro. */
export type RequestStatRow = Pick<RequestRecord, "startedAt" | "status" | "outcome" | "route" | "modelUsed" | "promptTokens" | "durationMs">;

export interface StoredRequest {
	request: RequestRecord;
	/** Em ordem de ocorrência; posição = índice (research.md §5). */
	trace: GraphTraceEvent[];
}

/** Persistência de requisições + rastro (Model — constitution Princípio III). */
export interface RequestStore {
	/** Registro + rastro numa transação: ambos ou nenhum (FR-006). Id repetido → lança. */
	save(record: RequestRecord, trace: readonly GraphTraceEvent[]): Promise<void>;
	/** Rastro em `seq` crescente; `undefined` se não existe. */
	get(id: string): Promise<StoredRequest | undefined>;
	/** Requisições com `startedAt >= from` (ISO), em ordem de `startedAt` (specs/017). */
	listSince(from: string): Promise<RequestStatRow[]>;
}

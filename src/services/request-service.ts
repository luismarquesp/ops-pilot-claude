import type { GraphTrace } from "../graph/production-graph.js";
import type { Logger } from "../obs/logger.js";
import type { RequestErrorCode, RequestRecord, RequestStore, StoredRequest } from "../store/request-store.js";
import type { ChatResult, PendingApprovalResult } from "./chat-service.js";
import { RequestNotFoundError } from "./errors.js";

/** Rota e origem do primeiro evento `route` do rastro (pura); `null`s sem ele. */
export function routeOf(trace: GraphTrace): { route: string | null; routeSource: string | null } {
	const event = trace.find((e) => e.type === "route");
	return event?.type === "route" ? { route: event.route, routeSource: event.source } : { route: null, routeSource: null };
}

export interface RequestRecordInput {
	requestId: string;
	startedAt: string;
	durationMs: number;
	/** Pedido já validado: `conversationId` e `userId` opcionais. */
	input: { conversationId?: string; userId?: string };
	/** Sucesso: resultado do turno; um turno pausado (specs/018) vira status 202. */
	result?: ChatResult | PendingApprovalResult;
	/** Erro: status HTTP e código (ignorados quando há `result`). */
	status?: number;
	errorCode?: RequestErrorCode;
}

/**
 * Monta o registro de um turno (pura, specs/016 — data-model.md): sucesso →
 * 200 `ok` com métricas, rota do rastro e a conversa da resposta; erro →
 * `error`, sem métricas nem rota, com a conversa do pedido.
 */
export function buildRequestRecord({ requestId, startedAt, durationMs, input, result, status, errorCode }: RequestRecordInput): RequestRecord {
	const base = { id: requestId, startedAt, durationMs: Math.max(0, Math.round(durationMs)), userId: input.userId ?? null };
	if (result) {
		const { metrics } = result;
		return {
			...base,
			status: result.kind === "pending" ? 202 : 200,
			outcome: "ok",
			errorCode: null,
			conversationId: result.conversationId,
			...routeOf(result.trace),
			modelUsed: metrics.modelUsed,
			promptTokens: metrics.promptTokens,
			latencyMs: metrics.latencyMs,
			metrics,
		};
	}
	return {
		...base,
		status: status ?? 500,
		outcome: "error",
		errorCode: errorCode ?? "internal_error",
		conversationId: input.conversationId ?? null,
		route: null,
		routeSource: null,
		modelUsed: null,
		promptTokens: null,
		latencyMs: null,
		metrics: null,
	};
}

export interface RecordRequestDeps {
	requests: RequestStore;
	logger: Logger;
}

/**
 * Grava registro + rastro (specs/016, research.md §2). Nunca rejeita: falha de
 * persistência não muda a resposta do `/chat` (FR-007) e é logada só com o nome
 * do erro.
 */
export async function recordRequest({ requests, logger }: RecordRequestDeps, record: RequestRecord, trace: GraphTrace): Promise<void> {
	try {
		await requests.save(record, trace);
	} catch (error) {
		logger.error("request.persist.failed", {
			requestId: record.id,
			errorName: error instanceof Error ? error.name : typeof error,
		});
	}
}

/** Registro + rastro de uma requisição; `RequestNotFoundError` se não existe. */
export async function getRequest(requests: RequestStore, id: string): Promise<StoredRequest> {
	const stored = await requests.get(id);
	if (!stored) {
		throw new RequestNotFoundError(id);
	}
	return stored;
}

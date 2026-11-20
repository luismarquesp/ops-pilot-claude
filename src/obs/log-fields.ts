import type { GraphTraceEvent } from "../graph/production-graph.js";
import type { ChatMetrics } from "../services/chat-service.js";
import type { LogFields } from "./logger.js";

/**
 * Campos de log de um evento do rastro (pura, specs/016 — research.md §7).
 * Lista permitida: só metadados. Nunca `content`, `args`, o `reason` do
 * roteador (texto do LLM) nem os passos do plano; um tipo novo sai só com os
 * campos base (FR-013).
 */
export function traceEventLogFields(event: GraphTraceEvent, seq: number, requestId: string): LogFields {
	const base: LogFields = { requestId, seq, type: event.type, node: event.node };
	switch (event.type) {
		case "action":
			return { ...base, tool: event.tool };
		case "route":
			return { ...base, route: event.route, source: event.source };
		case "fallback":
			return { ...base, from: event.from, to: event.to, reason: event.reason };
		case "summarize":
			return { ...base, messagesSummarized: event.messagesSummarized };
		case "plan":
			return { ...base, steps: event.steps.length };
		// specs/018: `args`, `summary` e `result` podem carregar texto livre (título do incidente).
		case "approval":
			return { ...base, approvalId: event.approvalId, tool: event.tool };
		case "decision":
			return { ...base, approvalId: event.approvalId, decision: event.decision };
		default:
			return base;
	}
}

export interface RequestEndInput {
	requestId: string;
	status: number;
	durationMs: number;
	errorCode?: string;
	route?: string | null;
	metrics?: ChatMetrics;
}

/** Campos da linha `chat.request.end` (pura): métricas numéricas só em sucesso. */
export function requestEndLogFields({ requestId, status, durationMs, errorCode, route, metrics }: RequestEndInput): LogFields {
	const base: LogFields = { requestId, status, durationMs, ...(errorCode ? { errorCode } : {}) };
	if (!metrics) {
		return base;
	}
	return {
		...base,
		...(route ? { route } : {}),
		llmCalls: metrics.llmCalls,
		promptTokens: metrics.promptTokens,
		modelUsed: metrics.modelUsed,
		historyMessages: metrics.historyMessages,
		memoryFacts: metrics.memoryFacts,
	};
}

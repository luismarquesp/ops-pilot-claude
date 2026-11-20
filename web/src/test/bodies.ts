/** Corpos de exemplo da API para os testes da web (contrato: specs/016 e specs/018). */

export const METRICS = {
	llmCalls: 2,
	latencyMs: 1200,
	historyMessages: 0,
	memoryFacts: 0,
	promptTokens: 1830,
	contextBreakdown: { question: 5, history: 0, memory: 0, summary: 0, total: 5 },
	contextTrimmed: { historyMessages: 0, memoryFacts: 0, summaryTruncated: false },
	modelUsed: "openrouter/free",
};

export const CONVERSATION_ID = "5b1f3c2e-0000-4000-8000-000000000001";

export const OK_BODY = {
	requestId: "0f8d6a1e-0000-4000-8000-000000000001",
	conversationId: CONVERSATION_ID,
	answer: "Nada disparando.",
	trace: [
		{ type: "route", route: "react", reason: "uma tool", source: "router", node: "roteador" },
		{ type: "action", tool: "list_alerts", args: { status: "firing" }, node: "react" },
		{ type: "observation", content: "[]", node: "react" },
		{ type: "answer", content: "Nada disparando.", node: "react" },
	],
	metrics: METRICS,
};

export function okBody(answer: string, overrides: Record<string, unknown> = {}) {
	return { ...OK_BODY, answer, ...overrides };
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { requestEndLogFields, traceEventLogFields } from "./log-fields.js";
import type { GraphTraceEvent } from "../graph/production-graph.js";
import { SAMPLE_METRICS } from "../store/request-store.contract-tests.js";

const BASE = { requestId: "r", seq: 3 };

test("traceEventLogFields: eventos de conteúdo saem só com os campos base", () => {
	const events: GraphTraceEvent[] = [
		{ type: "thought", content: "SEGREDO", node: "react" },
		{ type: "observation", content: "SEGREDO", node: "react" },
		{ type: "answer", content: "SEGREDO", node: "react" },
		{ type: "critique", content: "SEGREDO", node: "reflection" },
	];

	for (const event of events) {
		assert.deepEqual(traceEventLogFields(event, 3, "r"), { ...BASE, type: event.type, node: event.node });
	}
});

test("traceEventLogFields: action leva tool, sem args", () => {
	const event: GraphTraceEvent = { type: "action", tool: "list_alerts", args: { q: "SEGREDO" }, node: "react" };

	assert.deepEqual(traceEventLogFields(event, 3, "r"), { ...BASE, type: "action", node: "react", tool: "list_alerts" });
});

test("traceEventLogFields: route leva route e source, sem reason", () => {
	const event: GraphTraceEvent = { type: "route", route: "react", reason: "SEGREDO", source: "router", node: "roteador" };

	assert.deepEqual(traceEventLogFields(event, 3, "r"), { ...BASE, type: "route", node: "roteador", route: "react", source: "router" });
});

test("traceEventLogFields: fallback leva from, to e reason (nome do erro)", () => {
	const event: GraphTraceEvent = { type: "fallback", from: "a", to: "b", reason: "RateLimitError", node: "react" };

	assert.deepEqual(traceEventLogFields(event, 3, "r"), { ...BASE, type: "fallback", node: "react", from: "a", to: "b", reason: "RateLimitError" });
});

test("traceEventLogFields: summarize leva a contagem, sem o resumo; plan leva só o número de passos", () => {
	const summarize: GraphTraceEvent = { type: "summarize", content: "SEGREDO", messagesSummarized: 8, node: "contexto" };
	const plan: GraphTraceEvent = { type: "plan", steps: ["SEGREDO 1", "SEGREDO 2"], node: "plan-and-execute" };

	assert.deepEqual(traceEventLogFields(summarize, 3, "r"), { ...BASE, type: "summarize", node: "contexto", messagesSummarized: 8 });
	assert.deepEqual(traceEventLogFields(plan, 3, "r"), { ...BASE, type: "plan", node: "plan-and-execute", steps: 2 });
});

test("traceEventLogFields: tipo desconhecido sai só com os campos base", () => {
	const event = { type: "novo", content: "SEGREDO", extra: { x: 1 }, node: "react" } as unknown as GraphTraceEvent;

	assert.deepEqual(traceEventLogFields(event, 3, "r"), { ...BASE, type: "novo", node: "react" });
});

test("requestEndLogFields inclui métricas numéricas e rota só quando há metrics", () => {
	assert.deepEqual(requestEndLogFields({ requestId: "r", status: 503, durationMs: 12, errorCode: "model_unavailable" }), {
		requestId: "r",
		status: 503,
		durationMs: 12,
		errorCode: "model_unavailable",
	});
	assert.deepEqual(requestEndLogFields({ requestId: "r", status: 200, durationMs: 12, route: "react", metrics: SAMPLE_METRICS }), {
		requestId: "r",
		status: 200,
		durationMs: 12,
		route: "react",
		llmCalls: SAMPLE_METRICS.llmCalls,
		promptTokens: SAMPLE_METRICS.promptTokens,
		modelUsed: SAMPLE_METRICS.modelUsed,
		historyMessages: SAMPLE_METRICS.historyMessages,
		memoryFacts: SAMPLE_METRICS.memoryFacts,
	});
});

test("traceEventLogFields: approval leva approvalId e tool, sem args nem summary", () => {
	const event: GraphTraceEvent = { type: "approval", approvalId: "ap-1", tool: "open_incident", args: { title: "SEGREDO" }, summary: "SEGREDO", node: "react" };

	assert.deepEqual(traceEventLogFields(event, 3, "r"), { ...BASE, type: "approval", node: "react", approvalId: "ap-1", tool: "open_incident" });
});

test("traceEventLogFields: decision leva approvalId e decision, sem result", () => {
	const event: GraphTraceEvent = { type: "decision", approvalId: "ap-1", decision: "approved", result: "SEGREDO", node: "contexto" };

	assert.deepEqual(traceEventLogFields(event, 3, "r"), { ...BASE, type: "decision", node: "contexto", approvalId: "ap-1", decision: "approved" });
});

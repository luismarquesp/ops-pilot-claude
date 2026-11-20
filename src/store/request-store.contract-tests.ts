import { test } from "node:test";
import assert from "node:assert/strict";
import type { RequestRecord, RequestStore } from "./request-store.js";
import type { GraphTraceEvent } from "../graph/production-graph.js";
import type { ChatMetrics } from "../services/chat-service.js";

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

export const SAMPLE_METRICS: ChatMetrics = {
	llmCalls: 3,
	latencyMs: 120,
	historyMessages: 2,
	memoryFacts: 1,
	promptTokens: 1830,
	contextBreakdown: { question: 5, history: 40, memory: 10, summary: 0, total: 55 },
	contextTrimmed: { historyMessages: 0, memoryFacts: 0, summaryTruncated: false },
	modelUsed: "modelo/principal",
};

export const SAMPLE_TRACE: GraphTraceEvent[] = [
	{ type: "route", route: "react", reason: "uma tool", source: "router", node: "roteador" },
	{ type: "action", tool: "list_alerts", args: { status: "firing" }, node: "react" },
	{ type: "observation", content: "[{\"id\":1}]", node: "react" },
	{ type: "answer", content: "nada disparando", node: "react" },
];

export function okRecord(id: string, overrides: Partial<RequestRecord> = {}): RequestRecord {
	return {
		id,
		startedAt: "2026-11-17T12:00:00.000Z",
		durationMs: 130,
		status: 200,
		outcome: "ok",
		errorCode: null,
		conversationId: "5b1f3c2e-0000-4000-8000-000000000001",
		userId: "ana",
		route: "react",
		routeSource: "router",
		modelUsed: "modelo/principal",
		promptTokens: 1830,
		latencyMs: 120,
		metrics: SAMPLE_METRICS,
		...overrides,
	};
}

export function errorRecord(id: string): RequestRecord {
	return okRecord(id, {
		status: 503,
		outcome: "error",
		errorCode: "model_unavailable",
		userId: null,
		route: null,
		routeSource: null,
		modelUsed: null,
		promptTokens: null,
		latencyMs: null,
		metrics: null,
	});
}

/**
 * Suíte de contrato de `RequestStore` (specs/016, data-model.md) — roda
 * idêntica contra `SqliteRequestStore` e o mock. Atomicidade, cascade e
 * persistência entre instâncias ficam em `sqlite-request-store.test.ts`.
 */
export function runRequestStoreContractTests(label: string, createStore: () => RequestStore): void {
	test(`[${label}] save + get devolve o registro e o rastro na mesma ordem`, async () => {
		const store = createStore();
		const id = "11111111-0000-4000-8000-000000000001";

		await store.save(okRecord(id), SAMPLE_TRACE);

		assert.deepEqual(await store.get(id), { request: okRecord(id), trace: SAMPLE_TRACE });
	});

	test(`[${label}] registro de erro tem metrics null e rastro vazio`, async () => {
		const store = createStore();
		const id = "11111111-0000-4000-8000-000000000002";

		await store.save(errorRecord(id), []);

		assert.deepEqual(await store.get(id), { request: errorRecord(id), trace: [] });
	});

	test(`[${label}] get de id inexistente devolve undefined`, async () => {
		assert.equal(await createStore().get(UNKNOWN_ID), undefined);
	});

	test(`[${label}] save com id repetido lança e não altera o original`, async () => {
		const store = createStore();
		const id = "11111111-0000-4000-8000-000000000003";
		await store.save(okRecord(id), SAMPLE_TRACE);

		await assert.rejects(store.save(errorRecord(id), []));

		assert.deepEqual(await store.get(id), { request: okRecord(id), trace: SAMPLE_TRACE });
	});

	test(`[${label}] listSince devolve as linhas enxutas com startedAt >= from, em ordem`, async () => {
		const store = createStore();
		await store.save(okRecord("22222222-0000-4000-8000-000000000003", { startedAt: "2026-11-18T10:00:00.000Z" }), SAMPLE_TRACE);
		await store.save(okRecord("22222222-0000-4000-8000-000000000001", { startedAt: "2026-11-17T09:59:59.999Z" }), []);
		await store.save(errorRecord("22222222-0000-4000-8000-000000000002"), []);

		assert.deepEqual(await store.listSince("2026-11-17T10:00:00.000Z"), [
			{ startedAt: "2026-11-17T12:00:00.000Z", status: 503, outcome: "error", route: null, modelUsed: null, promptTokens: null, durationMs: 130 },
			{ startedAt: "2026-11-18T10:00:00.000Z", status: 200, outcome: "ok", route: "react", modelUsed: "modelo/principal", promptTokens: 1830, durationMs: 130 },
		]);
		assert.deepEqual(await store.listSince("2026-11-19T00:00:00.000Z"), []);
	});

	test(`[${label}] o registro guardado não é afetado por mutações posteriores da entrada`, async () => {
		const store = createStore();
		const id = "11111111-0000-4000-8000-000000000004";
		const trace = structuredClone(SAMPLE_TRACE);
		await store.save(okRecord(id), trace);

		trace.pop();

		assert.equal((await store.get(id))?.trace.length, SAMPLE_TRACE.length);
	});
}

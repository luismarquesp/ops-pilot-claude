import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRequestRecord, getRequest, recordRequest, routeOf } from "./request-service.js";
import { RequestNotFoundError } from "./errors.js";
import { createMockRequestStore } from "../store/mock-request-store.js";
import { createLogger } from "../obs/logger.js";
import { okRecord, SAMPLE_METRICS, SAMPLE_TRACE } from "../store/request-store.contract-tests.js";
import type { ChatResult } from "./chat-service.js";

const ID = "44444444-0000-4000-8000-000000000001";
const CONVERSATION = "5b1f3c2e-0000-4000-8000-000000000009";

test("routeOf lê o primeiro evento route, ou null sem ele", () => {
	assert.deepEqual(routeOf(SAMPLE_TRACE), { route: "react", routeSource: "router" });
	assert.deepEqual(routeOf([{ type: "answer", content: "x", node: "react" }]), { route: null, routeSource: null });
});

test("buildRequestRecord em sucesso copia métricas, rota e conversa da resposta", () => {
	const result: ChatResult = { conversationId: CONVERSATION, answer: "x", trace: SAMPLE_TRACE, metrics: SAMPLE_METRICS };

	const record = buildRequestRecord({
		requestId: ID,
		startedAt: "2026-11-17T12:00:00.000Z",
		durationMs: 130.4,
		input: { userId: "ana" },
		result,
	});

	assert.deepEqual(record, {
		id: ID,
		startedAt: "2026-11-17T12:00:00.000Z",
		durationMs: 130,
		status: 200,
		outcome: "ok",
		errorCode: null,
		conversationId: CONVERSATION,
		userId: "ana",
		route: "react",
		routeSource: "router",
		modelUsed: SAMPLE_METRICS.modelUsed,
		promptTokens: SAMPLE_METRICS.promptTokens,
		latencyMs: SAMPLE_METRICS.latencyMs,
		metrics: SAMPLE_METRICS,
	});
});

test("buildRequestRecord em erro não tem métricas nem rota e usa a conversa do pedido", () => {
	const record = buildRequestRecord({
		requestId: ID,
		startedAt: "t",
		durationMs: 5,
		input: { conversationId: CONVERSATION },
		status: 404,
		errorCode: "conversation_not_found",
	});

	assert.deepEqual(record, {
		id: ID,
		startedAt: "t",
		durationMs: 5,
		status: 404,
		outcome: "error",
		errorCode: "conversation_not_found",
		conversationId: CONVERSATION,
		userId: null,
		route: null,
		routeSource: null,
		modelUsed: null,
		promptTokens: null,
		latencyMs: null,
		metrics: null,
	});
});

test("recordRequest grava registro e rastro", async () => {
	const requests = createMockRequestStore();

	await recordRequest({ requests, logger: createLogger({ sink: () => {} }) }, okRecord(ID), SAMPLE_TRACE);

	assert.deepEqual(await requests.get(ID), { request: okRecord(ID), trace: SAMPLE_TRACE });
});

test("recordRequest com falha no store não rejeita e loga só o nome do erro", async () => {
	const lines: string[] = [];
	const logger = createLogger({ sink: (line) => lines.push(line) });

	await recordRequest({ requests: createMockRequestStore({ failOnSave: true }), logger }, okRecord(ID), SAMPLE_TRACE);

	assert.equal(lines.length, 1);
	const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
	assert.equal(entry.event, "request.persist.failed");
	assert.equal(entry.level, "error");
	assert.equal(entry.requestId, ID);
	assert.equal(entry.errorName, "Error");
	assert.doesNotMatch(lines[0]!, /falha simulada/);
});

test("getRequest de id inexistente lança RequestNotFoundError", async () => {
	await assert.rejects(getRequest(createMockRequestStore(), ID), RequestNotFoundError);
});

test("buildRequestRecord de turno pausado (specs/018) grava status 202, outcome ok e a conversa criada", () => {
	const record = buildRequestRecord({
		requestId: ID,
		startedAt: "2026-11-20T12:00:00.000Z",
		durationMs: 50,
		input: {},
		result: {
			kind: "pending",
			conversationId: CONVERSATION,
			approval: {} as never,
			trace: SAMPLE_TRACE,
			metrics: SAMPLE_METRICS,
		},
	});

	assert.equal(record.status, 202);
	assert.equal(record.outcome, "ok");
	assert.equal(record.conversationId, CONVERSATION);
	assert.equal(record.route, "react");
});

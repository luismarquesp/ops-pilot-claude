import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStats, getStats, percentile, sinceSchema, windowMs } from "./stats-service.js";
import type { RequestStatRow } from "../store/request-store.js";
import { createMockRequestStore } from "../store/mock-request-store.js";
import { errorRecord, okRecord } from "../store/request-store.contract-tests.js";

function row(overrides: Partial<RequestStatRow> = {}): RequestStatRow {
	return {
		startedAt: "2026-11-18T10:00:00.000Z",
		status: 200,
		outcome: "ok",
		route: "react",
		modelUsed: "pago",
		promptTokens: 1000,
		durationMs: 100,
		...overrides,
	};
}

const PRICES = new Map([["pago", 2]]);

test("sinceSchema aceita <n>m|h|d até 30d e recusa o resto", () => {
	for (const ok of ["1m", "90m", "24h", "7d", "30d", "720h"]) {
		assert.equal(sinceSchema.safeParse(ok).success, true, ok);
	}
	for (const bad of ["", "0h", "abc", "24", "1w", "-1h", "1.5h", "31d", "721h"]) {
		assert.equal(sinceSchema.safeParse(bad).success, false, bad);
	}
});

test("windowMs converte a janela em milissegundos", () => {
	assert.equal(windowMs("15m"), 15 * 60_000);
	assert.equal(windowMs("24h"), 24 * 3_600_000);
	assert.equal(windowMs("2d"), 2 * 86_400_000);
});

test("percentile: posto mais próximo, sem ordenar a entrada; vazio → null", () => {
	const values = [50, 10, 40, 20, 30];

	assert.equal(percentile(values, 50), 30);
	assert.equal(percentile(values, 95), 50);
	assert.equal(percentile([7], 95), 7);
	assert.equal(percentile([], 50), null);
	assert.deepEqual(values, [50, 10, 40, 20, 30]);
	assert.equal(percentile(Array.from({ length: 100 }, (_, i) => i + 1), 95), 95);
});

test("computeStats: janela vazia não tem NaN", () => {
	assert.deepEqual(computeStats([], PRICES), {
		total: 0,
		errors: 0,
		errorRate: 0,
		cost: { usd: 0, unpriced: 0 },
		latencyMs: { p50: null, p95: null },
		byRoute: [],
		byModel: [],
	});
});

test("computeStats: total, erros, custo (:free = 0, sem preço → unpriced) e quebras por rota e modelo", () => {
	const rows = [
		row({ durationMs: 100 }),
		row({ durationMs: 300, promptTokens: 500 }),
		row({ route: "plan-and-execute", modelUsed: "x:free", promptTokens: 9000, durationMs: 200 }),
		row({ route: "reflection", modelUsed: "sem-preco", durationMs: 900 }),
		row({ status: 503, outcome: "error", route: null, modelUsed: null, promptTokens: null, durationMs: 40 }),
	];

	const stats = computeStats(rows, PRICES);

	assert.equal(stats.total, 5);
	assert.equal(stats.errors, 1);
	assert.equal(stats.errorRate, 0.2);
	assert.deepEqual(stats.cost, { usd: 0.003, unpriced: 1 });
	assert.deepEqual(stats.latencyMs, { p50: 200, p95: 900 });
	assert.deepEqual(
		stats.byRoute.map((g) => [g.route, g.total, g.errors, g.cost.usd, g.cost.unpriced]),
		[
			["react", 2, 0, 0.003, 0],
			["plan-and-execute", 1, 0, 0, 0],
			["reflection", 1, 0, 0, 1],
			[null, 1, 1, 0, 0],
		],
	);
	assert.deepEqual(stats.byRoute[0]?.latencyMs, { p50: 100, p95: 300 });
	assert.deepEqual(stats.byRoute[3], {
		route: null,
		total: 1,
		errors: 1,
		errorRate: 1,
		cost: { usd: 0, unpriced: 0 },
		latencyMs: { p50: 40, p95: 40 },
	});
	assert.deepEqual(
		stats.byModel.map((g) => [g.model, g.total]),
		[
			["pago", 2],
			["sem-preco", 1],
			["x:free", 1],
			[null, 1],
		],
	);
});

test("computeStats arredonda errorRate em 4 casas e usd em 6", () => {
	const stats = computeStats([row({ promptTokens: 1 }), row({ outcome: "error" }), row()], new Map([["pago", 0.1234567]]));

	assert.equal(stats.errorRate, 0.3333);
	assert.equal(stats.cost.usd, 0.000247);
});

test("getStats filtra pela janela e devolve since/from/to", async () => {
	const requests = createMockRequestStore();
	await requests.save(okRecord("33333333-0000-4000-8000-000000000001", { startedAt: "2026-11-18T11:00:00.000Z", modelUsed: "x:free" }), []);
	await requests.save(okRecord("33333333-0000-4000-8000-000000000002", { startedAt: "2026-11-18T08:59:59.000Z" }), []);
	await requests.save(okRecord("33333333-0000-4000-8000-000000000004", { startedAt: "2026-11-18T12:00:01.000Z" }), []);
	await requests.save(errorRecord("33333333-0000-4000-8000-000000000003"), []);

	const stats = await getStats(requests, { since: "3h", now: new Date("2026-11-18T12:00:00.000Z"), prices: new Map() });

	assert.equal(stats.since, "3h");
	assert.equal(stats.from, "2026-11-18T09:00:00.000Z");
	assert.equal(stats.to, "2026-11-18T12:00:00.000Z");
	assert.equal(stats.total, 1);
	assert.deepEqual(stats.cost, { usd: 0, unpriced: 0 });
});

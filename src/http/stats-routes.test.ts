import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createStatsRouter, type StatsRouterOptions } from "./stats-routes.js";
import { createMockRequestStore } from "../store/mock-request-store.js";
import { errorRecord, okRecord } from "../store/request-store.contract-tests.js";
import type { RequestStore } from "../store/request-store.js";
import type { StatsReport } from "../services/stats-service.js";

const NOW = new Date("2026-11-18T12:00:00.000Z");

async function withRouter(requests: RequestStore, options: StatsRouterOptions, callback: (baseUrl: string) => Promise<void>): Promise<void> {
	const app = express();
	app.use("/stats", createStatsRouter(requests, { now: () => NOW, ...options }));
	const server = app.listen(0);
	await new Promise<void>((resolve) => server.once("listening", resolve));
	const address = server.address();
	if (address === null || typeof address === "string") {
		throw new Error("sem porta");
	}
	try {
		await callback(`http://127.0.0.1:${address.port}`);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
}

async function seeded(): Promise<RequestStore> {
	const requests = createMockRequestStore();
	await requests.save(okRecord("44444444-0000-4000-8000-000000000001", { startedAt: "2026-11-18T11:30:00.000Z", durationMs: 100 }), []);
	await requests.save(
		okRecord("44444444-0000-4000-8000-000000000002", { startedAt: "2026-11-18T06:00:00.000Z", modelUsed: "x:free", route: "plan-and-execute", durationMs: 900 }),
		[],
	);
	await requests.save(errorRecord("44444444-0000-4000-8000-000000000003"), []); // 2026-11-17T12:00 — na borda inclusiva da janela de 24h
	await requests.save(okRecord("44444444-0000-4000-8000-000000000004", { startedAt: "2026-11-10T00:00:00.000Z" }), []);
	return requests;
}

test("GET /stats sem since usa 24h e agrega total, erros, custo, percentis, rota e modelo", async () => {
	await withRouter(await seeded(), { prices: new Map([["modelo/principal", 10]]) }, async (baseUrl) => {
		const response = await fetch(`${baseUrl}/stats`);
		const body = (await response.json()) as StatsReport;

		assert.equal(response.status, 200);
		assert.equal(body.since, "24h");
		assert.equal(body.from, "2026-11-17T12:00:00.000Z");
		assert.equal(body.to, NOW.toISOString());
		assert.equal(body.total, 3);
		assert.equal(body.errors, 1);
		assert.deepEqual(body.cost, { usd: 0.0183, unpriced: 0 });
		assert.deepEqual(body.latencyMs, { p50: 130, p95: 900 });
		assert.deepEqual(
			body.byRoute.map((g) => [g.route, g.total]),
			[
				["plan-and-execute", 1],
				["react", 1],
				[null, 1],
			],
		);
		assert.deepEqual(
			body.byModel.map((g) => [g.model, g.total, g.cost.usd]),
			[
				["modelo/principal", 1, 0.0183],
				["x:free", 1, 0],
				[null, 1, 0],
			],
		);
	});
});

test("GET /stats?since=1h restringe a janela; sem preço o custo vira unpriced", async () => {
	await withRouter(await seeded(), {}, async (baseUrl) => {
		const body = (await (await fetch(`${baseUrl}/stats?since=1h`)).json()) as StatsReport;

		assert.equal(body.total, 1);
		assert.deepEqual(body.cost, { usd: 0, unpriced: 1 });
	});
});

test("GET /stats com since inválido responde 400 com issues", async () => {
	await withRouter(createMockRequestStore(), {}, async (baseUrl) => {
		for (const since of ["abc", "0h", "31d"]) {
			const response = await fetch(`${baseUrl}/stats?since=${since}`);

			assert.equal(response.status, 400, since);
			assert.ok(Array.isArray(((await response.json()) as { issues: unknown[] }).issues));
		}
	});
});

test("GET /stats sem requisições devolve zeros e percentis null", async () => {
	await withRouter(createMockRequestStore(), {}, async (baseUrl) => {
		const body = (await (await fetch(`${baseUrl}/stats`)).json()) as StatsReport;

		assert.equal(body.total, 0);
		assert.equal(body.errorRate, 0);
		assert.deepEqual(body.latencyMs, { p50: null, p95: null });
		assert.deepEqual(body.byRoute, []);
	});
});

import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createRequestRouter } from "./request-routes.js";
import { createMockRequestStore } from "../store/mock-request-store.js";
import { okRecord, SAMPLE_TRACE } from "../store/request-store.contract-tests.js";
import type { RequestStore } from "../store/request-store.js";

const ID = "55555555-0000-4000-8000-000000000001";
const MISSING = "55555555-0000-4000-8000-000000000002";

async function withRouter(requests: RequestStore, callback: (baseUrl: string) => Promise<void>): Promise<void> {
	const app = express();
	app.use("/requests", createRequestRouter(requests));
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

test("GET /requests/:id devolve registro e rastro", async () => {
	const requests = createMockRequestStore();
	await requests.save(okRecord(ID), SAMPLE_TRACE);

	await withRouter(requests, async (baseUrl) => {
		const response = await fetch(`${baseUrl}/requests/${ID}`);

		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), { request: okRecord(ID), trace: SAMPLE_TRACE });
	});
});

test("GET /requests/:id com id não-UUID responde 400 com issues", async () => {
	await withRouter(createMockRequestStore(), async (baseUrl) => {
		const response = await fetch(`${baseUrl}/requests/nao-e-uuid`);

		assert.equal(response.status, 400);
		assert.ok(Array.isArray(((await response.json()) as { issues: unknown[] }).issues));
	});
});

test("GET /requests/:id inexistente responde 404 request_not_found", async () => {
	await withRouter(createMockRequestStore(), async (baseUrl) => {
		const response = await fetch(`${baseUrl}/requests/${MISSING}`);

		assert.equal(response.status, 404);
		assert.deepEqual(await response.json(), { error: "request_not_found", requestId: MISSING });
	});
});

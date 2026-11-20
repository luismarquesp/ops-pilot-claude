import { test } from "node:test";
import assert from "node:assert/strict";
import express, { type Response } from "express";
import { requestContext, requestIdOf, withRequestId } from "./request-context.js";

test("withRequestId acrescenta requestId sem mutar o corpo", () => {
	const body = { a: 1 };

	const result = withRequestId(body, "id");

	assert.deepEqual(result, { requestId: "id", a: 1 });
	assert.deepEqual(body, { a: 1 });
});

test("requestIdOf lê res.locals.requestId só quando é string", () => {
	assert.equal(requestIdOf({ locals: { requestId: "x" } } as unknown as Response), "x");
	assert.equal(requestIdOf({ locals: {} } as unknown as Response), undefined);
	assert.equal(requestIdOf({ locals: { requestId: 42 } } as unknown as Response), undefined);
});

async function withApp(callback: (baseUrl: string) => Promise<void>): Promise<void> {
	const app = express();
	app.use("/chat", requestContext({ newId: () => "fixo" }));
	app.post("/chat", (_req, res) => {
		res.json({ locals: res.locals.requestId });
	});
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

test("requestContext grava o id em res.locals e no X-Request-Id, ignorando o do cliente", async () => {
	await withApp(async (baseUrl) => {
		const res = await fetch(`${baseUrl}/chat`, { method: "POST", headers: { "x-request-id": "cliente" } });

		assert.equal(res.headers.get("x-request-id"), "fixo");
		assert.deepEqual(await res.json(), { locals: "fixo" });
	});
});

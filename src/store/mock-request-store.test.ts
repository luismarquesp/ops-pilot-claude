import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockRequestStore } from "./mock-request-store.js";
import { okRecord, runRequestStoreContractTests, SAMPLE_TRACE } from "./request-store.contract-tests.js";

runRequestStoreContractTests("mock", () => createMockRequestStore());

test("[mock] failOnSave rejeita e não grava nada", async () => {
	const store = createMockRequestStore({ failOnSave: true });
	const id = "22222222-0000-4000-8000-000000000001";

	await assert.rejects(store.save(okRecord(id), SAMPLE_TRACE));

	assert.equal(await store.get(id), undefined);
});

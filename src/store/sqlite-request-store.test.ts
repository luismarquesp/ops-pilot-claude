import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteRequestStore } from "./sqlite-request-store.js";
import { okRecord, runRequestStoreContractTests, SAMPLE_TRACE } from "./request-store.contract-tests.js";
import type { GraphTraceEvent } from "../graph/production-graph.js";

runRequestStoreContractTests("sqlite", () => new SqliteRequestStore(":memory:"));

test("[sqlite] registro e rastro sobrevivem a uma nova instância sobre o mesmo arquivo", async () => {
	const dir = mkdtempSync(join(tmpdir(), "opspilot-requests-"));
	const path = join(dir, "test.db");
	const id = "33333333-0000-4000-8000-000000000001";
	try {
		const first = new SqliteRequestStore(path);
		await first.save(okRecord(id), SAMPLE_TRACE);
		first.close();

		// Dois construtores sobre o mesmo arquivo: DDL idempotente.
		const second = new SqliteRequestStore(path);
		assert.deepEqual(await second.get(id), { request: okRecord(id), trace: SAMPLE_TRACE });
		second.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("[sqlite] falha no meio do rastro não deixa registro nem eventos (transação)", async () => {
	const store = new SqliteRequestStore(":memory:");
	const id = "33333333-0000-4000-8000-000000000002";
	// Segundo evento sem `node`: viola o NOT NULL depois que o registro e o 1º evento entraram.
	const broken = [SAMPLE_TRACE[0]!, { type: "answer", content: "x" } as unknown as GraphTraceEvent];

	await assert.rejects(store.save(okRecord(id), broken));

	assert.equal(await store.get(id), undefined);
	assert.equal(store.count("requests"), 0);
	assert.equal(store.count("trace_events"), 0);
	// A conexão segue utilizável depois do ROLLBACK.
	await store.save(okRecord(id), SAMPLE_TRACE);
	assert.equal(store.count("trace_events"), SAMPLE_TRACE.length);
	store.close();
});

test("[sqlite] apagar a requisição apaga os eventos (ON DELETE CASCADE)", async () => {
	const store = new SqliteRequestStore(":memory:");
	await store.save(okRecord("33333333-0000-4000-8000-000000000003"), SAMPLE_TRACE);

	store.exec("DELETE FROM requests");

	assert.equal(store.count("trace_events"), 0);
	store.close();
});

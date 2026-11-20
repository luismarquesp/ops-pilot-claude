import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteOpsStore } from "./sqlite-ops-store.js";
import { runOpsStoreContractTests } from "./ops-store.contract-tests.js";

runOpsStoreContractTests("sqlite", () => new SqliteOpsStore(":memory:"));

test("[sqlite] CHECK do banco rejeita severidade fora do enum, mesmo contornando o Zod da tool", async () => {
	const store = new SqliteOpsStore(":memory:");

	await assert.rejects(() =>
		store.openIncident({ title: "X", service: "checkout", severity: "nonsense" as never }),
	);
});

test("[sqlite] seed não duplica ao reabrir a store sobre o mesmo arquivo", async () => {
	const dir = mkdtempSync(join(tmpdir(), "opspilot-"));
	const dbPath = join(dir, "opspilot.db");

	try {
		const first = new SqliteOpsStore(dbPath);
		const servicesAfterFirst = (await first.listAlerts()).length;
		first.close();

		const second = new SqliteOpsStore(dbPath);
		const alertsAfterSecond = await second.listAlerts();
		second.close();

		assert.equal(servicesAfterFirst, 6);
		assert.equal(alertsAfterSecond.length, 6);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

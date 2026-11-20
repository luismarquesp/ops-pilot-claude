import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteApprovalStore } from "./sqlite-approval-store.js";
import { newApproval, runApprovalStoreContractTests, T0 } from "./approval-store.contract-tests.js";

runApprovalStoreContractTests("sqlite", () => new SqliteApprovalStore(":memory:"));

test("[sqlite] aprovação pendente sobrevive a uma nova instância sobre o mesmo arquivo (FR-013c)", async () => {
	const dir = mkdtempSync(join(tmpdir(), "opspilot-approvals-"));
	const path = join(dir, "test.db");
	const id = "aaaaaaaa-0000-4000-8000-0000000000ff";
	try {
		const first = new SqliteApprovalStore(path);
		await first.create(newApproval(id));
		first.close();

		const second = new SqliteApprovalStore(path);
		const pending = await second.listPending(newApproval(id).conversationId, new Date(T0.getTime() + 60_000));
		assert.deepEqual(
			pending.map((a) => a.id),
			[id],
		);
		second.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteConversationStore } from "./sqlite-conversation-store.js";
import { SqliteOpsStore } from "./sqlite-ops-store.js";
import { runConversationStoreContractTests } from "./conversation-store.contract-tests.js";

runConversationStoreContractTests("sqlite", () => new SqliteConversationStore(":memory:"));

test("[sqlite] CHECK do banco rejeita role fora do enum", async () => {
	const store = new SqliteConversationStore(":memory:");
	const { id } = await store.create();

	await assert.rejects(() => store.append(id, "system" as never, "oi"));
	store.close();
});

test("[sqlite] conversa sobrevive a reabrir a store sobre o mesmo arquivo", async () => {
	const dir = mkdtempSync(join(tmpdir(), "opspilot-"));
	const dbPath = join(dir, "opspilot.db");

	try {
		const first = new SqliteConversationStore(dbPath);
		const { id } = await first.create();
		await first.append(id, "user", "p1");
		await first.append(id, "assistant", "r1");
		await first.append(id, "user", "p2");
		await first.append(id, "assistant", "r2");
		first.close();

		const second = new SqliteConversationStore(dbPath);
		const reopened = (await second.lastMessages(id, 12)).map((message) => message.content);
		await second.append(id, "user", "p3");
		const afterAppend = (await second.lastMessages(id, 12)).map((message) => message.content);
		second.close();

		assert.deepEqual(reopened, ["p1", "r1", "p2", "r2"]);
		assert.deepEqual(afterAppend, ["p1", "r1", "p2", "r2", "p3"]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("[sqlite] SqliteOpsStore e SqliteConversationStore coexistem no mesmo arquivo", async () => {
	const dir = mkdtempSync(join(tmpdir(), "opspilot-"));
	const dbPath = join(dir, "opspilot.db");

	try {
		const ops = new SqliteOpsStore(dbPath);
		const conversations = new SqliteConversationStore(dbPath);
		const { id } = await conversations.create();
		await conversations.append(id, "user", "quais alertas?");

		assert.equal((await ops.listAlerts()).length, 6);
		assert.deepEqual(
			(await conversations.lastMessages(id, 12)).map((message) => message.content),
			["quais alertas?"],
		);
		ops.close();
		conversations.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

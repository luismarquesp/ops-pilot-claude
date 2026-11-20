import { test } from "node:test";
import assert from "node:assert/strict";
import { listFacts, registerFact, removeFact } from "./memory-service.js";
import { MemoryNotFoundError, SecretDetectedError } from "./errors.js";
import { SqliteMemoryStore } from "../memory/memory-store.js";
import { createFakeEmbedder } from "../memory/fake-embedder.js";

const FACT = "É responsável pelo checkout.";

function setup(table: Record<string, number[]> = { [FACT]: [1, 0] }) {
	const embedder = createFakeEmbedder(table);
	return { memory: new SqliteMemoryStore(embedder, ":memory:"), embedder };
}

test("registerFact guarda um fato novo e acusa duplicata na repetição", async () => {
	const { memory } = setup();

	const first = await registerFact(memory, { userId: "luis", fact: FACT });
	const second = await registerFact(memory, { userId: "luis", fact: FACT });
	memory.close();

	assert.equal(first.created, true);
	assert.equal(second.created, false);
	assert.equal(second.memory.id, first.memory.id);
});

test("registerFact rejeita fato com segredo sem gravar e sem chamar o embedder", async () => {
	const { memory, embedder } = setup();

	await assert.rejects(
		() => registerFact(memory, { userId: "luis", fact: "minha senha: hunter2" }),
		(error: unknown) => error instanceof SecretDetectedError && !error.message.includes("hunter2"),
	);
	assert.deepEqual(embedder.calls, []);
	memory.close();
});

test("listFacts devolve o mesmo que memory.list", async () => {
	const { memory } = setup();
	await registerFact(memory, { userId: "luis", fact: FACT });

	assert.deepEqual(await listFacts(memory, "luis"), await memory.list("luis"));
	memory.close();
});

test("removeFact remove o fato do próprio usuário", async () => {
	const { memory } = setup();
	const { memory: saved } = await registerFact(memory, { userId: "luis", fact: FACT });

	await removeFact(memory, { userId: "luis", memoryId: saved.id });

	assert.deepEqual(await memory.list("luis"), []);
	memory.close();
});

test("removeFact de fato alheio ou inexistente rejeita com MemoryNotFoundError", async () => {
	const { memory } = setup();
	const { memory: saved } = await registerFact(memory, { userId: "luis", fact: FACT });
	const missing = "00000000-0000-4000-8000-000000000000";

	await assert.rejects(
		() => removeFact(memory, { userId: "ana", memoryId: saved.id }),
		(error: unknown) => error instanceof MemoryNotFoundError && error.memoryId === saved.id,
	);
	await assert.rejects(() => removeFact(memory, { userId: "luis", memoryId: missing }), MemoryNotFoundError);
	assert.equal((await memory.list("luis")).length, 1);
	memory.close();
});

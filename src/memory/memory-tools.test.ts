import { test } from "node:test";
import assert from "node:assert/strict";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { SqliteMemoryStore } from "./memory-store.js";
import { createFakeEmbedder } from "./fake-embedder.js";
import { createMemoryTools } from "./memory-tools.js";

const FACT = "sou do time de pagamentos";
const OTHER_FACT = "prefiro respostas curtas";

function setup() {
	const store = new SqliteMemoryStore(
		createFakeEmbedder({
			[FACT]: [1, 0, 0],
			[OTHER_FACT]: [0, 1, 0],
			query: [1, 0, 0],
			"aquilo de eu ser de pagamentos": [0.9, 0.1, 0],
			"sobre respostas curtinhas": [0.1, 0.95, 0],
			"algo sem relação": [0, 0, 1],
		}),
		":memory:",
	);
	return { store, alice: createMemoryTools(store, "alice"), bob: createMemoryTools(store, "bob") };
}

function toolNamed(tools: StructuredToolInterface[], name: string): StructuredToolInterface {
	const found = tools.find((candidate) => candidate.name === name);
	assert.ok(found, `tool ${name} ausente`);
	return found;
}

test("remember_fact guarda o fato (sem espaços nas pontas) só para o usuário do turno", async () => {
	const { store, alice } = setup();

	const output = JSON.parse(await toolNamed(alice, "remember_fact").invoke({ fact: `  ${FACT}  ` })) as {
		id: string;
		fact: string;
		created: boolean;
	};

	assert.equal(output.fact, FACT);
	assert.equal(output.created, true);
	assert.equal(typeof output.id, "string");
	assert.deepEqual(
		(await store.recall("alice", "query")).map((memory) => memory.id),
		[output.id],
	);
	assert.deepEqual(await store.recall("bob", "query"), []);
	store.close();
});

test("remember_fact rejeita fato vazio pelo schema", async () => {
	const { store, alice } = setup();

	await assert.rejects(() => toolNamed(alice, "remember_fact").invoke({ fact: "   " }));
	store.close();
});

test("remember_fact de fato equivalente devolve created: false e o mesmo id", async () => {
	const { store, alice } = setup();
	const remember = toolNamed(alice, "remember_fact");

	const first = JSON.parse(await remember.invoke({ fact: FACT })) as { id: string; created: boolean };
	const second = JSON.parse(await remember.invoke({ fact: FACT })) as { id: string; created: boolean };
	store.close();

	assert.equal(second.created, false);
	assert.equal(second.id, first.id);
});

// --- forget_preference (specs/009) ---

test("createMemoryTools devolve remember_fact e forget_preference (sem forget_fact)", () => {
	const { store, alice } = setup();

	assert.deepEqual(
		alice.map((candidate) => candidate.name),
		["remember_fact", "forget_preference"],
	);
	store.close();
});

test("forget_preference esquece o fato mais parecido com a descrição e devolve o texto", async () => {
	const { store, alice } = setup();
	await store.remember("alice", FACT);
	await store.remember("alice", OTHER_FACT);

	const output = await toolNamed(alice, "forget_preference").invoke({ description: "sobre respostas curtinhas" });

	assert.equal(output, JSON.stringify({ forgotten: true, fact: OTHER_FACT }));
	assert.deepEqual(
		(await store.recall("alice", "query")).map((memory) => memory.fact),
		[FACT],
	);
	store.close();
});

test("forget_preference abaixo do limiar não remove nada", async () => {
	const { store, alice } = setup();
	await store.remember("alice", FACT);

	const output = await toolNamed(alice, "forget_preference").invoke({ description: "algo sem relação" });

	assert.equal(output, JSON.stringify({ forgotten: false }));
	assert.equal((await store.recall("alice", "query")).length, 1);
	store.close();
});

test("forget_preference nunca remove fato de outro usuário", async () => {
	const { store, bob } = setup();
	await store.remember("alice", FACT);

	const output = await toolNamed(bob, "forget_preference").invoke({ description: "aquilo de eu ser de pagamentos" });

	assert.equal(output, JSON.stringify({ forgotten: false }));
	assert.equal((await store.recall("alice", "query")).length, 1);
	store.close();
});

test("forget_preference rejeita descrição vazia pelo schema", async () => {
	const { store, alice } = setup();

	await assert.rejects(() => toolNamed(alice, "forget_preference").invoke({ description: "   " }));
	store.close();
});

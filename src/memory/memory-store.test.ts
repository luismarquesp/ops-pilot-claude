import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteMemoryStore } from "./memory-store.js";
import { createFakeEmbedder } from "./fake-embedder.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function createStore(table: Record<string, number[]>) {
	const embedder = createFakeEmbedder(table);
	return { store: new SqliteMemoryStore(embedder, ":memory:"), embedder };
}

test("remember guarda um fato novo e devolve created: true", async () => {
	const { store } = createStore({ "sou do time de pagamentos": [1, 0, 0] });

	const { memory, created } = await store.remember("alice", "sou do time de pagamentos");
	store.close();

	assert.equal(created, true);
	assert.match(memory.id, UUID);
	assert.equal(memory.userId, "alice");
	assert.equal(memory.fact, "sou do time de pagamentos");
	assert.ok(!Number.isNaN(Date.parse(memory.createdAt)));
});

test("fatos sobrevivem a reabrir a store sobre o mesmo arquivo, sem duplicar", async () => {
	const dir = mkdtempSync(join(tmpdir(), "opspilot-memory-"));
	const dbPath = join(dir, "opspilot.db");
	const embedder = createFakeEmbedder({ "sou do time de pagamentos": [1, 0, 0] });

	try {
		const first = new SqliteMemoryStore(embedder, dbPath);
		await first.remember("alice", "sou do time de pagamentos");
		first.close();

		new SqliteMemoryStore(embedder, dbPath).close();

		const db = new DatabaseSync(dbPath);
		const row = db.prepare("SELECT COUNT(*) AS total, length(embedding) AS bytes FROM memories").get() as {
			total: number;
			bytes: number;
		};
		db.close();

		assert.equal(row.total, 1);
		assert.equal(row.bytes, 12);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

/** Vetor 2D unitário cujo produto escalar com a query [1, 0] é `score`. */
const scored = (score: number): number[] => [score, Math.sqrt(1 - score * score)];

test("recall devolve no máximo 3 fatos com score >= 0.3, do mais para o menos similar", async () => {
	// Cada fato usa uma dimensão própria para o resto do vetor: entre si eles
	// ficam distantes (sem acionar o dedup), e contra a query têm o score do nome.
	const apart = (score: number, dimension: number): number[] =>
		Array.from({ length: 6 }, (_, index) => (index === 0 ? score : index === dimension ? Math.sqrt(1 - score * score) : 0));
	const { store } = createStore({
		query: [1, 0, 0, 0, 0, 0],
		"f-0.95": apart(0.95, 1),
		"f-0.2": apart(0.2, 2),
		"f-0.8": apart(0.8, 3),
		"f-0.5": apart(0.5, 4),
		"f-0.4": apart(0.4, 5),
	});
	for (const fact of ["f-0.95", "f-0.2", "f-0.8", "f-0.5", "f-0.4"]) {
		await store.remember("alice", fact);
	}

	const recalled = await store.recall("alice", "query");
	store.close();

	assert.deepEqual(
		recalled.map((memory) => memory.fact),
		["f-0.95", "f-0.8", "f-0.5"],
	);
	assert.ok(recalled.every((memory) => !("embedding" in memory)));
	assert.ok(Math.abs((recalled[0]?.score ?? 0) - 0.95) < 1e-6);
});

test("recall descarta fatos abaixo de 0.3", async () => {
	const { store } = createStore({ query: [1, 0], "f-0.2": scored(0.2) });
	await store.remember("alice", "f-0.2");

	assert.deepEqual(await store.recall("alice", "query"), []);
	store.close();
});

test("recall de usuário sem fatos devolve [] sem chamar o embedder", async () => {
	const { store, embedder } = createStore({});

	assert.deepEqual(await store.recall("alice", "query"), []);
	assert.deepEqual(embedder.calls, []);
	store.close();
});

test("recall nunca devolve fatos de outro usuário", async () => {
	const { store } = createStore({ query: [1, 0], "fato do bob": [1, 0], "fato da alice": scored(0.5) });
	await store.remember("bob", "fato do bob");
	await store.remember("alice", "fato da alice");

	const recalled = await store.recall("alice", "query");
	store.close();

	assert.deepEqual(
		recalled.map((memory) => [memory.userId, memory.fact]),
		[["alice", "fato da alice"]],
	);
});

test("recall encontra fatos gravados antes de reabrir a store", async () => {
	const dir = mkdtempSync(join(tmpdir(), "opspilot-memory-"));
	const dbPath = join(dir, "opspilot.db");
	const embedder = createFakeEmbedder({ query: [1, 0], "sou do time de pagamentos": [1, 0] });

	try {
		const first = new SqliteMemoryStore(embedder, dbPath);
		await first.remember("alice", "sou do time de pagamentos");
		first.close();

		const second = new SqliteMemoryStore(embedder, dbPath);
		const recalled = await second.recall("alice", "query");
		second.close();

		assert.deepEqual(
			recalled.map((memory) => memory.fact),
			["sou do time de pagamentos"],
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// --- Dedup (US2) ---

test("remember de fato quase idêntico (> 0.92) devolve o existente sem criar outro", async () => {
	const { store } = createStore({
		query: [1, 0],
		"sou do time de pagamentos": [1, 0],
		"eu sou do time de pagamentos.": scored(0.97),
	});

	const original = await store.remember("alice", "sou do time de pagamentos");
	const again = await store.remember("alice", "eu sou do time de pagamentos.");
	const recalled = await store.recall("alice", "query");
	store.close();

	assert.equal(again.created, false);
	assert.deepEqual(again.memory, original.memory);
	assert.deepEqual(
		recalled.map((memory) => memory.id),
		[original.memory.id],
	);
});

test("remember com similaridade exatamente 0.92 não é duplicata", async () => {
	const { store } = createStore({ a: [1, 0], b: scored(0.92) });

	await store.remember("alice", "a");
	const second = await store.remember("alice", "b");
	store.close();

	assert.equal(second.created, true);
});

test("dedup é por usuário: o mesmo fato de outro usuário é aceito", async () => {
	const { store } = createStore({ "sou do time de pagamentos": [1, 0] });

	await store.remember("alice", "sou do time de pagamentos");
	const forBob = await store.remember("bob", "sou do time de pagamentos");
	store.close();

	assert.equal(forBob.created, true);
	assert.equal(forBob.memory.userId, "bob");
});

test("registrar o mesmo fato 5 vezes guarda exatamente 1", async () => {
	const { store } = createStore({ query: [1, 0], "sou do time de pagamentos": [1, 0] });

	for (let i = 0; i < 5; i += 1) {
		await store.remember("alice", "sou do time de pagamentos");
	}
	const recalled = await store.recall("alice", "query");
	store.close();

	assert.equal(recalled.length, 1);
});

// --- Forget (US3) ---

test("forget remove o fato do próprio usuário", async () => {
	const { store } = createStore({ query: [1, 0], "sou do time de pagamentos": [1, 0] });
	const { memory } = await store.remember("alice", "sou do time de pagamentos");

	assert.equal(await store.forget("alice", memory.id), true);
	assert.deepEqual(await store.recall("alice", "query"), []);
	store.close();
});

test("forget de fato de outro usuário não remove nada", async () => {
	const { store } = createStore({ query: [1, 0], "sou do time de pagamentos": [1, 0] });
	const { memory } = await store.remember("alice", "sou do time de pagamentos");

	assert.equal(await store.forget("bob", memory.id), false);
	assert.equal((await store.recall("alice", "query")).length, 1);
	store.close();
});

test("forget de id inexistente devolve false sem lançar", async () => {
	const { store } = createStore({});

	assert.equal(await store.forget("alice", "00000000-0000-4000-8000-000000000000"), false);
	store.close();
});

// --- list (specs/010) ---

test("list devolve todos os fatos do usuário, do mais recente para o mais antigo, sem embedding", async () => {
	const { store } = createStore({ a: [1, 0, 0], b: [0, 1, 0], c: [0, 0, 1] });
	for (const fact of ["a", "b", "c"]) {
		await store.remember("alice", fact);
	}

	const listed = await store.list("alice");
	store.close();

	assert.deepEqual(
		listed.map((memory) => memory.fact),
		["c", "b", "a"],
	);
	assert.ok(listed.every((memory) => !("embedding" in memory)));
	assert.deepEqual(Object.keys(listed[0] ?? {}).sort(), ["createdAt", "fact", "id", "userId"]);
});

test("list de usuário sem fatos devolve [] e nunca chama o embedder", async () => {
	const { store, embedder } = createStore({ "fato do bob": [1, 0] });
	await store.remember("bob", "fato do bob");
	const callsBefore = embedder.calls.length;

	assert.deepEqual(await store.list("alice"), []);
	assert.equal(embedder.calls.length, callsBefore);
	store.close();
});

test("list nunca devolve fatos de outro usuário", async () => {
	const { store } = createStore({ "fato do bob": [1, 0], "fato da alice": [0, 1] });
	await store.remember("bob", "fato do bob");
	await store.remember("alice", "fato da alice");

	const listed = await store.list("alice");
	store.close();

	assert.deepEqual(
		listed.map((memory) => [memory.userId, memory.fact]),
		[["alice", "fato da alice"]],
	);
});

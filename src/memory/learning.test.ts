import { test } from "node:test";
import assert from "node:assert/strict";
import { learnFromMessage, logLearningFailure, toLearnableFact, type LearningVerdict } from "./learning.js";
import { SqliteMemoryStore } from "./memory-store.js";
import { createFakeEmbedder } from "./fake-embedder.js";

const FACT = "O plantonista cuida do checkout";

test("toLearnableFact só devolve fatos presentes, não vazios e dentro do tamanho", () => {
	const cases: Array<[LearningVerdict, string | undefined]> = [
		[{ hasLearning: false, fact: "x" }, undefined],
		[{ hasLearning: true }, undefined],
		[{ hasLearning: true, fact: "   " }, undefined],
		[{ hasLearning: true, fact: ` ${"a".repeat(501)} ` }, undefined],
		[{ hasLearning: true, fact: "a".repeat(500) }, "a".repeat(500)],
		[{ hasLearning: true, fact: `  ${FACT}  ` }, FACT],
	];

	for (const [verdict, expected] of cases) {
		assert.equal(toLearnableFact(verdict), expected, JSON.stringify(verdict).slice(0, 60));
	}
});

function setup(verdict: LearningVerdict | (() => Promise<LearningVerdict>)) {
	const memory = new SqliteMemoryStore(createFakeEmbedder({ [FACT]: [1, 0], query: [1, 0] }), ":memory:");
	const received: string[] = [];
	const logged: unknown[] = [];
	const deps = {
		memory,
		extractor: async (message: string) => {
			received.push(message);
			return typeof verdict === "function" ? verdict() : verdict;
		},
		log: (error: unknown) => {
			logged.push(error);
		},
	};
	return { memory, received, logged, deps };
}

test("learnFromMessage guarda o fato para o usuário informado", async () => {
	const { memory, deps } = setup({ hasLearning: true, fact: FACT });

	assert.equal(await learnFromMessage({ userId: "alice", message: "sou eu que cuido do checkout" }, deps), "learned");
	assert.deepEqual(
		(await memory.recall("alice", "query")).map((memory) => memory.fact),
		[FACT],
	);
	assert.deepEqual(await memory.recall("bob", "query"), []);
	memory.close();
});

test("learnFromMessage devolve duplicate quando o fato já existe", async () => {
	const { memory, deps } = setup({ hasLearning: true, fact: FACT });
	const input = { userId: "alice", message: "sou eu que cuido do checkout" };

	await learnFromMessage(input, deps);
	assert.equal(await learnFromMessage(input, deps), "duplicate");
	memory.close();
});

test("learnFromMessage sem aprendizado devolve nothing e não grava", async () => {
	const { memory, deps } = setup({ hasLearning: false });

	assert.equal(await learnFromMessage({ userId: "alice", message: "lista os alertas" }, deps), "nothing");
	assert.deepEqual(await memory.recall("alice", "query"), []);
	memory.close();
});

test("learnFromMessage passa ao extrator exatamente a mensagem do usuário", async () => {
	const { memory, received, deps } = setup({ hasLearning: false });

	await learnFromMessage({ userId: "alice", message: "mensagem original" }, deps);
	assert.deepEqual(received, ["mensagem original"]);
	memory.close();
});

test("learnFromMessage com extrator que lança devolve failed e loga, sem rejeitar", async () => {
	const error = new TypeError("conteúdo sensível");
	const { memory, logged, deps } = setup(async () => {
		throw error;
	});

	assert.equal(await learnFromMessage({ userId: "alice", message: "oi" }, deps), "failed");
	assert.deepEqual(logged, [error]);
	memory.close();
});

test("learnFromMessage com memória que lança devolve failed", async () => {
	const { memory, deps } = setup({ hasLearning: true, fact: FACT });
	memory.close();

	assert.equal(await learnFromMessage({ userId: "alice", message: "oi" }, deps), "failed");
});

test("logLearningFailure loga só o nome do erro, nunca a mensagem", (context) => {
	const warn = context.mock.method(console, "warn", () => {});

	logLearningFailure(new TypeError("conteúdo sensível"));

	const printed = warn.mock.calls.map((call) => call.arguments.join(" ")).join("\n");
	assert.ok(printed.includes("TypeError"));
	assert.ok(!printed.includes("conteúdo sensível"));
});

// --- Segredos e pedidos pontuais (US2) ---

test("toLearnableFact descarta fato que contém segredo", () => {
	assert.equal(toLearnableFact({ hasLearning: true, fact: "O token dele é ghp_0123456789abcdefABCDEF0123" }), undefined);
});

test("learnFromMessage com segredo na mensagem nem chama o extrator", async () => {
	const { memory, received, deps } = setup({ hasLearning: true, fact: FACT });

	const outcome = await learnFromMessage(
		{ userId: "alice", message: "sou do time de SRE, minha senha do grafana: hunter2" },
		deps,
	);

	assert.equal(outcome, "skipped_secret");
	assert.deepEqual(received, []);
	assert.deepEqual(await memory.recall("alice", "query"), []);
	memory.close();
});

test("learnFromMessage descarta fato proposto com segredo (segunda barreira)", async () => {
	const { memory, deps } = setup({ hasLearning: true, fact: "A chave dele é AKIAABCDEFGHIJKLMNOP" });

	assert.equal(await learnFromMessage({ userId: "alice", message: "qual a chave da AWS?" }, deps), "rejected");
	assert.deepEqual(await memory.recall("alice", "query"), []);
	memory.close();
});

test("learnFromMessage com pedido pontual (extrator diz não) devolve nothing", async () => {
	const { memory, deps } = setup({ hasLearning: false });

	assert.equal(await learnFromMessage({ userId: "alice", message: "fecha o incidente 42" }, deps), "nothing");
	memory.close();
});

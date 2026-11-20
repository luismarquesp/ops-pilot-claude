import { test } from "node:test";
import assert from "node:assert/strict";
import { runChat } from "./chat-service.js";
import { withReflection } from "../agents/reflection.js";
import type { ReasoningStrategy, StrategyResult } from "../agents/strategy.js";
import { createMockConversationStore } from "../store/mock-conversation-store.js";
import { SqliteMemoryStore } from "../memory/memory-store.js";
import { createFakeEmbedder } from "../memory/fake-embedder.js";
import { recordUsage } from "../context/usage-tracker.js";
import type { TokenUsage } from "../context/tokens.js";
import { contextBreakdown } from "../context/breakdown.js";
import { createFakeSummarizer } from "../agents/fake-summarizer.js";
import type { Summarizer } from "../agents/summarizer.js";
import type { ContextBudget } from "../context/context-builder.js";
import { estimateTokens } from "../context/tokens.js";
import { formatQuestionWithHistory, type HistoryMessage } from "../agents/history.js";
import { formatQuestionWithMemory } from "../memory/memory-prompt.js";
import { createFakeRouter } from "../agents/fake-router.js";
import { recordModelCall } from "../agents/model-calls.js";
import type { Router } from "../agents/router.js";
import { ModelUnavailableError, TimeoutError } from "./errors.js";

const fakeStrategy: ReasoningStrategy = {
	name: "fake",
	async run(): Promise<StrategyResult> {
		return { answer: "ok", trace: [{ type: "answer", content: "ok" }], metrics: { llmCalls: 3, latencyMs: 9 } };
	},
};

test("runChat em conversa nova reporta historyMessages 0 e preserva as métricas da estratégia", async () => {
	const result = await runChat(
		{ message: "oi" },
		{ strategies: { react: fakeStrategy }, conversations: createMockConversationStore(), timeoutMs: 1_000 },
	);

	assert.deepEqual(result.metrics, {
		llmCalls: 3,
		latencyMs: 9,
		historyMessages: 0,
		memoryFacts: 0,
		promptTokens: null,
		contextBreakdown: { question: 1, history: 0, memory: 0, summary: 0, total: 1 },
		contextTrimmed: { historyMessages: 0, memoryFacts: 0, summaryTruncated: false },
		modelUsed: null,
	});
});

test("runChat reporta historyMessages igual ao histórico carregado, mesmo com reflexão por dentro", async () => {
	const conversations = createMockConversationStore();
	const strategy = withReflection(fakeStrategy, { critic: async () => ({ approved: true }) });
	const deps = { strategies: { react: strategy }, conversations, timeoutMs: 1_000 };

	const first = await runChat({ message: "p1" }, deps);
	const second = await runChat({ message: "p2", conversationId: first.conversationId }, deps);

	assert.equal(second.metrics.historyMessages, 2);
	assert.equal(second.metrics.llmCalls, 4);
});

function spyStrategy(questions: string[]): ReasoningStrategy {
	return {
		name: "spy",
		async run(input): Promise<StrategyResult> {
			questions.push(input.question);
			return { answer: "ok", trace: [], metrics: { llmCalls: 1, latencyMs: 1 } };
		},
	};
}

async function memoryWith(table: Record<string, number[]>, facts: Array<[string, string]>) {
	const memory = new SqliteMemoryStore(createFakeEmbedder(table), ":memory:");
	for (const [userId, fact] of facts) {
		await memory.remember(userId, fact);
	}
	return { memory };
}

test("runChat com userId injeta os fatos lembrados na pergunta e reporta memoryFacts", async () => {
	const { memory } = await memoryWith({ "qual banco?": [1, 0], "usamos postgres": [1, 0] }, [
		["alice", "usamos postgres"],
	]);
	const questions: string[] = [];

	const result = await runChat(
		{ message: "qual banco?", userId: "alice" },
		{ strategies: { react: spyStrategy(questions) }, conversations: createMockConversationStore(), memory, timeoutMs: 1_000 },
	);

	assert.equal(result.metrics.memoryFacts, 1);
	assert.ok(questions[0]?.includes("\n- usamos postgres\n"));
	assert.ok(questions[0]?.endsWith("\n\nqual banco?"));
});

test("runChat com conversa e userId monta fatos → histórico → pergunta", async () => {
	const { memory } = await memoryWith({ p1: [1, 0], p2: [1, 0], "usamos postgres": [1, 0] }, [["alice", "usamos postgres"]]);
	const questions: string[] = [];
	const deps = { strategies: { react: spyStrategy(questions) }, conversations: createMockConversationStore(), memory, timeoutMs: 1_000 };

	const first = await runChat({ message: "p1", userId: "alice" }, deps);
	await runChat({ message: "p2", userId: "alice", conversationId: first.conversationId }, deps);

	const second = questions[1] ?? "";
	const factsAt = second.indexOf("usamos postgres");
	const historyAt = second.indexOf("Histórico recente desta conversa");
	assert.ok(factsAt >= 0 && historyAt > factsAt, second);
	assert.ok(second.endsWith("Pergunta atual: p2"));
});

test("runChat sem userId não consulta a memória e não altera a pergunta", async () => {
	const { memory } = await memoryWith({ "usamos postgres": [1, 0] }, [["alice", "usamos postgres"]]);
	const questions: string[] = [];

	const result = await runChat(
		{ message: "qual banco?" },
		{ strategies: { react: spyStrategy(questions) }, conversations: createMockConversationStore(), memory, timeoutMs: 1_000 },
	);

	assert.deepEqual(questions, ["qual banco?"]);
	assert.equal(result.metrics.memoryFacts, 0);
});

test("runChat com userId cujos fatos não atingem o limiar mantém a pergunta", async () => {
	const { memory } = await memoryWith({ "qual banco?": [1, 0], "gosto de verde": [0, 1] }, [["alice", "gosto de verde"]]);
	const questions: string[] = [];

	const result = await runChat(
		{ message: "qual banco?", userId: "alice" },
		{ strategies: { react: spyStrategy(questions) }, conversations: createMockConversationStore(), memory, timeoutMs: 1_000 },
	);

	assert.deepEqual(questions, ["qual banco?"]);
	assert.equal(result.metrics.memoryFacts, 0);
});

test("runChat propaga falha do embedder e não grava nada na conversa", async () => {
	const { memory } = await memoryWith({ "usamos postgres": [1, 0] }, [["alice", "usamos postgres"]]);
	const conversations = createMockConversationStore();
	const { id } = await conversations.create();

	await assert.rejects(
		() =>
			runChat(
				{ message: "texto sem vetor no fake", userId: "alice", conversationId: id },
				{ strategies: { react: fakeStrategy }, conversations, memory, timeoutMs: 1_000 },
			),
		/fake embedder/,
	);
	assert.deepEqual(await conversations.lastMessages(id, 12), []);
});

// --- Refletor de aprendizado (specs/009) ---

test("runChat não espera o learn: resolve mesmo com learn que nunca termina", async () => {
	const deps = { strategies: { react: fakeStrategy }, conversations: createMockConversationStore(), timeoutMs: 1_000 };
	const without = await runChat({ message: "oi", userId: "alice" }, deps);

	const withLearn = await runChat(
		{ message: "oi", userId: "alice" },
		{ ...deps, learn: () => new Promise<never>(() => {}) },
	);

	assert.equal(withLearn.answer, without.answer);
	assert.deepEqual(withLearn.metrics, without.metrics);
});

test("runChat chama learn uma vez, com userId e a mensagem do turno", async () => {
	const calls: Array<{ userId: string; message: string }> = [];

	await runChat(
		{ message: "sou eu que cuido do checkout", userId: "alice" },
		{
			strategies: { react: fakeStrategy },
			conversations: createMockConversationStore(),
			timeoutMs: 1_000,
			learn: async (input) => {
				calls.push(input);
			},
		},
	);

	assert.deepEqual(calls, [{ userId: "alice", message: "sou eu que cuido do checkout" }]);
});

test("runChat chama learn só depois que pergunta e resposta estão gravadas", async () => {
	const conversations = createMockConversationStore();
	const { id } = await conversations.create();
	let seenAtLearn: string[] = [];

	await runChat(
		{ message: "p1", userId: "alice", conversationId: id },
		{
			strategies: { react: fakeStrategy },
			conversations,
			timeoutMs: 1_000,
			learn: async () => {
				seenAtLearn = (await conversations.lastMessages(id, 12)).map((message) => message.content);
			},
		},
	);
	await new Promise((resolve) => setImmediate(resolve));

	assert.deepEqual(seenAtLearn, ["p1", "ok"]);
});

test("runChat não chama learn sem userId, em timeout nem quando a estratégia lança", async () => {
	const calls: unknown[] = [];
	const learn = async (input: unknown) => {
		calls.push(input);
	};
	const conversations = createMockConversationStore();

	await runChat({ message: "oi" }, { strategies: { react: fakeStrategy }, conversations, timeoutMs: 1_000, learn });

	const hanging: ReasoningStrategy = { name: "hang", run: () => new Promise<StrategyResult>(() => {}) };
	await assert.rejects(() =>
		runChat({ message: "oi", userId: "alice" }, { strategies: { react: hanging }, conversations, timeoutMs: 20, learn }),
	);

	const failing: ReasoningStrategy = {
		name: "boom",
		async run(): Promise<StrategyResult> {
			throw new Error("boom");
		},
	};
	await assert.rejects(() =>
		runChat({ message: "oi", userId: "alice" }, { strategies: { react: failing }, conversations, timeoutMs: 1_000, learn }),
	);

	assert.deepEqual(calls, []);
});

test("runChat com learn que rejeita não gera unhandledRejection", async () => {
	const unhandled: unknown[] = [];
	const listener = (reason: unknown) => {
		unhandled.push(reason);
	};
	process.on("unhandledRejection", listener);

	try {
		await runChat(
			{ message: "oi", userId: "alice" },
			{
				strategies: { react: fakeStrategy },
				conversations: createMockConversationStore(),
				timeoutMs: 1_000,
				learn: () => Promise.reject(new Error("x")),
			},
		);
		await new Promise((resolve) => setImmediate(resolve));
	} finally {
		process.off("unhandledRejection", listener);
	}

	assert.deepEqual(unhandled, []);
});

// --- Medição de contexto (specs/011) ---

const usage = (inputTokens: number): TokenUsage => ({ inputTokens, outputTokens: 10, totalTokens: inputTokens + 10 });

/** Estratégia falsa que simula uma chamada ao modelo por valor de `inputs`, como o callback de `createModel` faria. */
function usageStrategy(...inputs: number[]): ReasoningStrategy {
	return {
		name: "usage",
		async run(): Promise<StrategyResult> {
			for (const inputTokens of inputs) {
				await new Promise((resolve) => setImmediate(resolve));
				recordUsage(usage(inputTokens));
			}
			return { answer: "ok", trace: [], metrics: { llmCalls: inputs.length, latencyMs: 1 } };
		},
	};
}

test("runChat reporta promptTokens como a soma das chamadas ao modelo do turno", async () => {
	const result = await runChat(
		{ message: "oi" },
		{ strategies: { react: usageStrategy(100, 250) }, conversations: createMockConversationStore(), timeoutMs: 1_000 },
	);

	assert.equal(result.metrics.promptTokens, 350);
});

test("runChat inclui no promptTokens a chamada do crítico da reflexão", async () => {
	const strategy = withReflection(usageStrategy(100), {
		critic: async () => {
			recordUsage(usage(40));
			return { approved: true };
		},
	});

	const result = await runChat({ message: "oi" }, { strategies: { react: strategy }, conversations: createMockConversationStore(), timeoutMs: 1_000 });

	assert.equal(result.metrics.promptTokens, 140);
});

test("runChat não conta no promptTokens o uso do learn disparado depois do turno", async () => {
	const result = await runChat(
		{ message: "oi", userId: "alice" },
		{
			strategies: { react: usageStrategy(100) },
			conversations: createMockConversationStore(),
			timeoutMs: 1_000,
			learn: async () => {
				recordUsage(usage(5_000));
			},
		},
	);
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(result.metrics.promptTokens, 100);
});

test("runChat concorrentes não misturam o promptTokens", async () => {
	const conversations = createMockConversationStore();

	const [small, big] = await Promise.all([
		runChat({ message: "a" }, { strategies: { react: usageStrategy(1, 1) }, conversations, timeoutMs: 1_000 }),
		runChat({ message: "b" }, { strategies: { react: usageStrategy(1_000) }, conversations, timeoutMs: 1_000 }),
	]);

	assert.equal(small.metrics.promptTokens, 2);
	assert.equal(big.metrics.promptTokens, 1_000);
});

test("runChat reporta contextBreakdown estimado sobre pergunta, histórico e fatos do turno", async () => {
	const { memory } = await memoryWith({ p1: [1, 0], p2: [1, 0], "usamos postgres": [1, 0] }, [["alice", "usamos postgres"]]);
	const conversations = createMockConversationStore();
	const deps = { strategies: { react: fakeStrategy }, conversations, memory, timeoutMs: 1_000 };

	const first = await runChat({ message: "p1", userId: "alice" }, deps);
	const second = await runChat({ message: "p2", userId: "alice", conversationId: first.conversationId }, deps);

	const expected = contextBreakdown("p2", [{ role: "user", content: "p1" }, { role: "assistant", content: "ok" }], [{ fact: "usamos postgres" }]);
	assert.deepEqual(second.metrics.contextBreakdown, expected);
	assert.ok(expected.history > 0 && expected.memory > 0);
	assert.equal(expected.total, expected.question + expected.history + expected.memory);
});

test("runChat sem histórico e sem userId reporta histórico e memória zerados no contextBreakdown", async () => {
	const result = await runChat(
		{ message: "quais alertas?" },
		{ strategies: { react: fakeStrategy }, conversations: createMockConversationStore(), timeoutMs: 1_000 },
	);

	assert.equal(result.metrics.contextBreakdown.history, 0);
	assert.equal(result.metrics.contextBreakdown.memory, 0);
	assert.equal(result.metrics.contextBreakdown.total, result.metrics.contextBreakdown.question);
});

// --- Sumarização de histórico (specs/012) ---

/** Conduz `turns` turnos na mesma conversa; devolve as perguntas vistas pela estratégia e os resultados. */
async function converse(
	turns: number,
	deps: { summarizer?: Summarizer; userId?: string; memory?: SqliteMemoryStore; strategy?: ReasoningStrategy; budget?: ContextBudget } = {},
) {
	const questions: string[] = [];
	const conversations = createMockConversationStore();
	const results: Awaited<ReturnType<typeof runChat>>[] = [];
	let conversationId: string | undefined;
	for (let turn = 1; turn <= turns; turn += 1) {
		const result = await runChat(
			{ message: `p${turn}`, conversationId, userId: deps.userId },
			{
				strategies: { react: deps.strategy ?? spyStrategy(questions) },
				conversations,
				memory: deps.memory,
				summarizer: deps.summarizer,
				budget: deps.budget,
				timeoutMs: 1_000,
			},
		);
		conversationId = result.conversationId;
		results.push(result);
	}
	return { questions, results, conversations, conversationId: conversationId ?? "" };
}

test("runChat chama o resumidor só nos turnos 9, 13 e 17 de uma conversa de 20 turnos", async () => {
	const summarizer = createFakeSummarizer();
	const callsAfterTurn: number[] = [];
	const questions: string[] = [];
	const strategy = spyStrategy(questions);
	const wrapped: ReasoningStrategy = {
		name: "spy",
		async run(input) {
			const result = await strategy.run(input);
			callsAfterTurn.push(summarizer.calls.length);
			return result;
		},
	};

	await converse(20, { summarizer, strategy: wrapped });

	const summarizedAt = callsAfterTurn.flatMap((calls, index) => (calls > (callsAfterTurn[index - 1] ?? 0) ? [index + 1] : []));
	assert.deepEqual(summarizedAt, [9, 13, 17]);
});

test("runChat no turno do gatilho entrega o resumo antes do histórico e só 8 falas por extenso", async () => {
	const summarizer = createFakeSummarizer();
	const { questions, results } = await converse(9, { summarizer });

	const ninth = questions[8] ?? "";
	const summaryAt = ninth.indexOf("Resumo da conversa até aqui:");
	const historyAt = ninth.indexOf("Histórico recente desta conversa");
	assert.ok(summaryAt >= 0 && historyAt > summaryAt, ninth);
	assert.equal(ninth.split("\n").filter((line) => /^(Plantonista|OpsPilot): /.test(line)).length, 8);
	assert.equal(results[8]?.metrics.historyMessages, 8);
});

test("runChat com userId monta fatos → resumo → histórico → pergunta", async () => {
	const table: Record<string, number[]> = { "usamos postgres": [1, 0] };
	for (let turn = 1; turn <= 9; turn += 1) {
		table[`p${turn}`] = [1, 0];
	}
	const { memory } = await memoryWith(table, [["alice", "usamos postgres"]]);

	const { questions } = await converse(9, { summarizer: createFakeSummarizer(), userId: "alice", memory });

	const ninth = questions[8] ?? "";
	const positions = ["usamos postgres", "Resumo da conversa até aqui:", "Histórico recente desta conversa", "Pergunta atual: p9"].map(
		(marker) => ninth.indexOf(marker),
	);
	assert.ok(positions.every((position, index) => position >= 0 && (index === 0 || position > (positions[index - 1] ?? 0))), ninth);
});

test("runChat com resumidor que falha completa o turno e grava pergunta e resposta", async () => {
	const { results, conversations, conversationId } = await converse(9, { summarizer: createFakeSummarizer({ fail: true }) });

	assert.equal(results[8]?.answer, "ok");
	assert.equal(results[8]?.metrics.historyMessages, 16);
	assert.equal((await conversations.messagesSince(conversationId, 0)).length, 18);
	assert.equal(await conversations.getSummary(conversationId), undefined);
});

test("runChat soma o uso do resumidor no promptTokens, mas não em llmCalls", async () => {
	const fake = createFakeSummarizer();
	const summarizer: Summarizer = async (input) => {
		recordUsage(usage(70));
		return fake(input);
	};

	const { results } = await converse(9, { summarizer, strategy: usageStrategy(100) });

	assert.equal(results[7]?.metrics.promptTokens, 100);
	assert.equal(results[8]?.metrics.promptTokens, 170);
	assert.equal(results[8]?.metrics.llmCalls, 1);
});

test("runChat põe o evento summarize no início do trace só no turno que gerou o resumo", async () => {
	const { results, conversations, conversationId } = await converse(12, { summarizer: createFakeSummarizer() });

	const turnsWithEvent = results.flatMap((result, index) =>
		result.trace.some((event) => event.type === "summarize") ? [index + 1] : [],
	);
	assert.deepEqual(turnsWithEvent, [9]);
	const saved = await conversations.getSummary(conversationId);
	assert.deepEqual(results[8]?.trace[0], { type: "summarize", content: saved?.summary, messagesSummarized: 8, node: "contexto" });
});

test("runChat reporta contextBreakdown.summary só depois do primeiro resumo, com total somando as quatro fatias", async () => {
	const { results } = await converse(10, { summarizer: createFakeSummarizer() });

	const summaries = results.map((result) => result.metrics.contextBreakdown.summary);
	assert.ok(summaries.slice(0, 8).every((value) => value === 0), String(summaries));
	assert.ok(summaries.slice(8).every((value) => value > 0), String(summaries));
	for (const { metrics } of results) {
		const { question, history, memory, summary, total } = metrics.contextBreakdown;
		assert.equal(total, question + history + memory + summary);
	}
});

test("runChat com resumidor que falha não emite o evento summarize", async () => {
	const { results } = await converse(9, { summarizer: createFakeSummarizer({ fail: true }) });

	assert.ok(results.every((result) => result.trace.every((event) => event.type !== "summarize")));
});

// --- Orçamento de contexto por seção (specs/013) ---

const turnsOf = (count: number): HistoryMessage[] =>
	Array.from({ length: count }, (_, index) => [
		{ role: "user" as const, content: `p${index + 1}` },
		{ role: "assistant" as const, content: "ok" },
	]).flat();

const windowFor = (messages: readonly HistoryMessage[]) => estimateTokens(formatQuestionWithHistory(messages, ""));

test("runChat com janela orçada entrega à estratégia só as mensagens mais recentes que cabem", async () => {
	const lastTwo = turnsOf(3).slice(-2);
	const { questions, results } = await converse(4, { budget: { summary: 200, window: windowFor(lastTwo), memory: 300 } });

	assert.equal(questions[3], formatQuestionWithHistory(lastTwo, "p4"));
	assert.equal(results[3]?.metrics.historyMessages, 2);
	assert.equal(results[3]?.metrics.contextTrimmed.historyMessages, 4);
});

test("runChat com reflexão: o retry também recebe a pergunta orçada", async () => {
	const lastTwo = turnsOf(3).slice(-2);
	const questions: string[] = [];
	let verdicts = 0;
	const reflected = withReflection(spyStrategy(questions), {
		critic: async () => (verdicts++ % 2 === 0 ? { approved: false, feedback: "refaça" } : { approved: true }),
	});
	const { results } = await converse(4, {
		strategy: reflected,
		budget: { summary: 200, window: windowFor(lastTwo), memory: 300 },
	});

	assert.equal(results.length, 4);
	const lastTurn = questions.slice(-2);
	assert.equal(lastTurn.length, 2);
	for (const question of lastTurn) {
		assert.ok(question.includes(formatQuestionWithHistory(lastTwo, "p4")), question);
		assert.ok(!question.includes("Plantonista: p1"), question);
	}
});

test("runChat sem orçamento nas deps monta a mesma pergunta de antes da feature", async () => {
	const { questions } = await converse(4);

	assert.equal(questions[3], formatQuestionWithHistory(turnsOf(3), "p4"));
});

test("runChat com memória orçada corta o fato de menor score e reporta o corte", async () => {
	const { memory } = await memoryWith(
		{ "qual banco?": [1, 0], "f-alto usamos postgres": [1, 0], "f-medio prefere curto": [0.8, 0.6], "f-baixo time de pagamentos": [0.4, -0.9165] },
		[
			["alice", "f-alto usamos postgres"],
			["alice", "f-medio prefere curto"],
			["alice", "f-baixo time de pagamentos"],
		],
	);
	const kept = [{ fact: "f-alto usamos postgres" }, { fact: "f-medio prefere curto" }];
	const questions: string[] = [];

	const result = await runChat(
		{ message: "qual banco?", userId: "alice" },
		{
			strategies: { react: spyStrategy(questions) },
			conversations: createMockConversationStore(),
			memory,
			timeoutMs: 1_000,
			budget: { summary: 200, window: 1200, memory: estimateTokens(formatQuestionWithMemory(kept, "")) },
		},
	);

	assert.equal(questions[0], formatQuestionWithMemory(kept, "qual banco?"));
	assert.equal(result.metrics.memoryFacts, 2);
	assert.deepEqual(result.metrics.contextTrimmed, { historyMessages: 0, memoryFacts: 1, summaryTruncated: false });
	assert.ok(result.metrics.contextBreakdown.memory <= estimateTokens(formatQuestionWithMemory(kept, "")));
});

test("runChat com tetos baixos mantém cada fatia do contextBreakdown dentro do teto e reporta os cortes", async () => {
	const budget: ContextBudget = { summary: 10, window: 20, memory: 300 };
	const { results } = await converse(10, { summarizer: createFakeSummarizer(), budget });

	for (const { metrics } of results) {
		assert.ok(metrics.contextBreakdown.summary <= budget.summary, JSON.stringify(metrics));
		assert.ok(metrics.contextBreakdown.history <= budget.window, JSON.stringify(metrics));
	}
	const last = results.at(-1)?.metrics;
	assert.equal(last?.contextTrimmed.summaryTruncated, true);
	assert.ok((last?.contextTrimmed.historyMessages ?? 0) > 0);
	assert.equal(results[0]?.metrics.contextTrimmed.historyMessages, 0);
});

// --- Grafo unificado de produção (specs/014) ---

function namedStrategy(name: string, llmCalls = 1): ReasoningStrategy {
	return {
		name,
		async run(): Promise<StrategyResult> {
			return { answer: name, trace: [{ type: "answer", content: name }], metrics: { llmCalls, latencyMs: 1 } };
		},
	};
}

const twoRoutes = () => ({ react: namedStrategy("react"), "plan-and-execute": namedStrategy("plan-and-execute", 4) });

test("runChat com roteador roda a rota escolhida e conta a chamada do roteador em llmCalls", async () => {
	const result = await runChat(
		{ message: "para cada alerta, abra um incidente" },
		{
			strategies: twoRoutes(),
			router: createFakeRouter({ route: "plan-and-execute", reason: "vários passos" }),
			conversations: createMockConversationStore(),
			timeoutMs: 1_000,
		},
	);

	assert.equal(result.answer, "plan-and-execute");
	assert.equal(result.metrics.llmCalls, 5);
	assert.deepEqual(result.trace[0], {
		type: "route",
		route: "plan-and-execute",
		reason: "vários passos",
		source: "router",
		node: "roteador",
	});
});

test("runChat com strategy na entrada faz override sem chamar o roteador", async () => {
	const router = createFakeRouter({ route: "react", reason: "x" });

	const result = await runChat(
		{ message: "oi", strategy: "plan-and-execute" },
		{ strategies: twoRoutes(), router, conversations: createMockConversationStore(), timeoutMs: 1_000 },
	);

	assert.equal(router.calls.length, 0);
	assert.equal(result.answer, "plan-and-execute");
	assert.equal(result.trace[0]?.type === "route" ? result.trace[0].source : undefined, "override");
});

test("runChat soma no promptTokens o uso do roteador", async () => {
	const router: Router = async () => {
		recordUsage(usage(7));
		return { route: "react", reason: "direto" };
	};

	const result = await runChat(
		{ message: "oi" },
		{ strategies: { react: usageStrategy(100) }, router, conversations: createMockConversationStore(), timeoutMs: 1_000 },
	);

	assert.equal(result.metrics.promptTokens, 107);
});

test("runChat com roteador que nunca responde estoura o timeout e não grava nada", async () => {
	const conversations = createMockConversationStore();
	const { id } = await conversations.create();

	await assert.rejects(
		() =>
			runChat(
				{ message: "oi", conversationId: id },
				{ strategies: twoRoutes(), router: () => new Promise<never>(() => {}), conversations, timeoutMs: 20 },
			),
		TimeoutError,
	);
	assert.deepEqual(await conversations.lastMessages(id, 12), []);
});

test("runChat com roteador que falha grava o turno e dispara o learn", async (t) => {
	t.mock.method(console, "warn", () => {});
	const conversations = createMockConversationStore();
	const learned: string[] = [];

	const result = await runChat(
		{ message: "oi", userId: "alice" },
		{
			strategies: twoRoutes(),
			router: createFakeRouter(new Error("fora do ar")),
			conversations,
			timeoutMs: 1_000,
			learn: async ({ message }) => {
				learned.push(message);
			},
		},
	);

	assert.equal(result.answer, "react");
	assert.deepEqual(
		(await conversations.lastMessages(result.conversationId, 12)).map((message) => message.content),
		["oi", "react"],
	);
	assert.deepEqual(learned, ["oi"]);
});

// --- Resiliência de modelo (specs/015) ---

test("runChat com ModelUnavailableError propaga a classe, não grava nada e não dispara o learn", async () => {
	const conversations = createMockConversationStore();
	const { id } = await conversations.create();
	const learned: unknown[] = [];
	const unavailable: ReasoningStrategy = {
		name: "react",
		async run(): Promise<StrategyResult> {
			throw new ModelUnavailableError(["a", "b"]);
		},
	};

	await assert.rejects(
		() =>
			runChat(
				{ message: "oi", conversationId: id, userId: "alice" },
				{
					strategies: { react: unavailable },
					conversations,
					timeoutMs: 1_000,
					learn: async (input) => {
						learned.push(input);
					},
				},
			),
		ModelUnavailableError,
	);
	assert.deepEqual(await conversations.lastMessages(id, 12), []);
	assert.deepEqual(learned, []);
});

test("runChat reporta metrics.modelUsed e o evento fallback quando a estratégia trocou de modelo", async () => {
	const switching: ReasoningStrategy = {
		name: "react",
		async run(): Promise<StrategyResult> {
			recordModelCall({ modelUsed: "b", switches: [{ from: "a", to: "b", reason: "X" }] });
			return { answer: "ok", trace: [{ type: "answer", content: "ok" }], metrics: { llmCalls: 1, latencyMs: 1 } };
		},
	};

	const result = await runChat(
		{ message: "oi" },
		{ strategies: { react: switching }, conversations: createMockConversationStore(), timeoutMs: 1_000 },
	);

	assert.equal(result.metrics.modelUsed, "b");
	assert.deepEqual(
		result.trace.find((event) => event.type === "fallback"),
		{ type: "fallback", from: "a", to: "b", reason: "X", node: "react" },
	);
});

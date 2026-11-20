import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp, type AppDeps } from "./server.js";
import type { ReasoningStrategy, StrategyResult } from "../agents/strategy.js";
import type { Critic } from "../agents/reflection.js";
import { createMockConversationStore } from "../store/mock-conversation-store.js";
import type { ConversationStore } from "../store/conversation-store.js";
import { SqliteMemoryStore } from "../memory/memory-store.js";
import { createFakeEmbedder } from "../memory/fake-embedder.js";
import { recordUsage } from "../context/usage-tracker.js";
import { createFakeSummarizer } from "../agents/fake-summarizer.js";
import { createFakeRouter } from "../agents/fake-router.js";
import { ModelUnavailableError } from "../services/errors.js";
import { recordModelCall } from "../agents/model-calls.js";
import { createMockRequestStore } from "../store/mock-request-store.js";
import type { RequestStore } from "../store/request-store.js";
import { createLogger } from "../obs/logger.js";
import { NO_ROUTER_REASON, OVERRIDE_REASON, type GraphTraceEvent } from "../graph/production-graph.js";

function fakeResult(answer: string): StrategyResult {
	return {
		answer,
		trace: [{ type: "answer", content: answer }],
		metrics: { llmCalls: 1, latencyMs: 5 },
	};
}

function fakeStrategy(name: string, result: StrategyResult): ReasoningStrategy {
	return {
		name,
		async run(): Promise<StrategyResult> {
			return result;
		},
	};
}

/** Estratégia falsa cujo run() nunca resolve — usada para exercitar o timeout (504). */
function hangingStrategy(name: string): ReasoningStrategy {
	return {
		name,
		run(): Promise<StrategyResult> {
			return new Promise<StrategyResult>(() => {});
		},
	};
}

async function withServer(
	registry: Map<string, ReasoningStrategy>,
	opts: Parameters<typeof createApp>[1],
	callback: (baseUrl: string, conversations: ConversationStore) => Promise<void>,
	conversations: ConversationStore = createMockConversationStore(),
	extra: Partial<Pick<AppDeps, "memory" | "strategiesFor" | "learn" | "summarizer" | "contextBudget" | "router" | "requests" | "logger" | "corsOrigins">> = {},
): Promise<void> {
	const app = createApp(
		{
			strategiesFor: extra.strategiesFor ?? (() => registry),
			conversations,
			memory: extra.memory,
			learn: extra.learn,
			summarizer: extra.summarizer,
			contextBudget: extra.contextBudget,
			router: extra.router,
			requests: extra.requests,
			logger: extra.logger,
			corsOrigins: extra.corsOrigins,
		},
		opts,
	);
	const server = app.listen(0);
	await new Promise<void>((resolve) => server.once("listening", resolve));

	const address = server.address();
	if (address === null || typeof address === "string") {
		throw new Error("Falha ao obter a porta do servidor de teste");
	}

	try {
		await callback(`http://127.0.0.1:${address.port}`, conversations);
	} finally {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	}
}

test("POST /chat com só message e sem roteador cai em react (fallback) e responde 200", async () => {
	const registry = new Map([["react", fakeStrategy("react", fakeResult("tudo certo"))]]);

	await withServer(registry, {}, async (baseUrl) => {
		const response = await fetch(`${baseUrl}/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ message: "Como está o plantão?" }),
		});

		assert.equal(response.status, 200);
		const body = (await response.json()) as StrategyResult & { conversationId: string };
		const expected = fakeResult("tudo certo");
		assert.equal(body.answer, expected.answer);
		assert.deepEqual(body.trace, [
			{ type: "route", route: "react", reason: NO_ROUTER_REASON, source: "fallback", node: "roteador" },
			{ type: "answer", content: "tudo certo", node: "react" },
		]);
		assert.equal(body.metrics.llmCalls, expected.metrics.llmCalls);
		assert.equal(body.metrics.latencyMs, expected.metrics.latencyMs);
	});
});

test("POST /chat com strategy escolhe a estratégia pedida, não a padrão", async () => {
	const registry = new Map([
		["react", fakeStrategy("react", fakeResult("resposta padrão"))],
		["plan-and-execute", fakeStrategy("plan-and-execute", fakeResult("resposta da outra"))],
	]);

	await withServer(registry, {}, async (baseUrl) => {
		const response = await fetch(`${baseUrl}/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ message: "oi", strategy: "plan-and-execute" }),
		});

		assert.equal(response.status, 200);
		const body = (await response.json()) as StrategyResult;
		assert.equal(body.answer, "resposta da outra");
	});
});

test("POST /chat com reflect:true aplica withReflection sobre a estratégia resolvida", async () => {
	const registry = new Map([["react", fakeStrategy("react", fakeResult("primeira resposta"))]]);
	const approvingCritic: Critic = async () => ({ approved: true });

	await withServer(registry, { reflectionOptions: { critic: approvingCritic } }, async (baseUrl) => {
		const response = await fetch(`${baseUrl}/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ message: "oi", reflect: true }),
		});

		assert.equal(response.status, 200);
		const body = (await response.json()) as StrategyResult;
		assert.equal(body.answer, "primeira resposta");
		assert.ok(body.trace.some((event) => event.type === "critique"));
	});
});

test("POST /chat sem message (ou vazio) responde 400 com issues do Zod", async () => {
	const registry = new Map([["react", fakeStrategy("react", fakeResult("x"))]]);

	await withServer(registry, {}, async (baseUrl) => {
		const missing = await fetch(`${baseUrl}/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		assert.equal(missing.status, 400);
		const missingBody = (await missing.json()) as { issues: unknown[] };
		assert.ok(Array.isArray(missingBody.issues));
		assert.ok(missingBody.issues.length > 0);

		const empty = await fetch(`${baseUrl}/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ message: "" }),
		});
		assert.equal(empty.status, 400);
	});
});

test("POST /chat com strategy desconhecida responde 422, distinto de 400", async () => {
	const registry = new Map([["react", fakeStrategy("react", fakeResult("x"))]]);

	await withServer(registry, {}, async (baseUrl) => {
		const response = await fetch(`${baseUrl}/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ message: "oi", strategy: "nao-existe" }),
		});

		assert.equal(response.status, 422);
		const body = (await response.json()) as { error: string; strategy: string; available: string[] };
		assert.equal(body.error, "unknown_strategy");
		assert.equal(body.strategy, "nao-existe");
		assert.deepEqual(body.available, ["react", "reflection"]);
	});
});

test("POST /chat com strategy desconhecida e reflect:true ainda responde 422 (nunca tenta refletir)", async () => {
	const registry = new Map([["react", fakeStrategy("react", fakeResult("x"))]]);

	await withServer(registry, {}, async (baseUrl) => {
		const response = await fetch(`${baseUrl}/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ message: "oi", strategy: "nao-existe", reflect: true }),
		});

		assert.equal(response.status, 422);
	});
});

test("POST /chat com execução que nunca termina responde 504 dentro do timeout configurado", async () => {
	const registry = new Map([["react", hangingStrategy("react")]]);

	await withServer(registry, { timeoutMs: 20 }, async (baseUrl) => {
		const response = await fetch(`${baseUrl}/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ message: "oi" }),
		});

		assert.equal(response.status, 504);
		const body = (await response.json()) as { error: string; timeoutMs: number };
		assert.equal(body.error, "timeout");
		assert.equal(body.timeoutMs, 20);
	});
});

// --- Conversa persistente (specs/007) ---

type ChatBody = StrategyResult & { conversationId: string };

/** Estratégia fake que registra cada `question` recebida e ecoa uma resposta numerada. */
function recordingStrategy(name: string): { strategy: ReasoningStrategy; questions: string[] } {
	const questions: string[] = [];
	return {
		questions,
		strategy: {
			name,
			async run(input): Promise<StrategyResult> {
				questions.push(input.question);
				return fakeResult(`resposta ${questions.length}`);
			},
		},
	};
}

async function postChat(baseUrl: string, body: unknown): Promise<Response> {
	return fetch(`${baseUrl}/chat`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

/** Corpo sem o `requestId` (specs/016): o resto do corpo do /chat não muda (FR-002). */
function withoutRequestId(body: unknown): unknown {
	const { requestId: _requestId, ...rest } = body as Record<string, unknown>;
	return rest;
}

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

test("POST /chat sem conversationId cria conversa, devolve o id e grava pergunta + resposta", async () => {
	const registry = new Map([["react", fakeStrategy("react", fakeResult("tudo certo"))]]);

	await withServer(registry, {}, async (baseUrl, conversations) => {
		const response = await postChat(baseUrl, { message: "Como está o plantão?" });

		assert.equal(response.status, 200);
		const body = (await response.json()) as ChatBody;
		assert.match(body.conversationId, /^[0-9a-f-]{36}$/);

		const messages = await conversations.lastMessages(body.conversationId, 12);
		assert.deepEqual(
			messages.map(({ role, content }) => ({ role, content })),
			[
				{ role: "user", content: "Como está o plantão?" },
				{ role: "assistant", content: "tudo certo" },
			],
		);
	});
});

test("POST /chat com conversationId devolve o mesmo id e leva o turno anterior para a estratégia", async () => {
	const { strategy, questions } = recordingStrategy("react");
	const registry = new Map([["react", strategy]]);

	await withServer(registry, {}, async (baseUrl) => {
		const first = (await (await postChat(baseUrl, { message: "quais alertas?" })).json()) as ChatBody;
		const response = await postChat(baseUrl, {
			message: "abre um incidente para o segundo",
			conversationId: first.conversationId,
		});

		assert.equal(response.status, 200);
		const second = (await response.json()) as ChatBody;
		assert.equal(second.conversationId, first.conversationId);
		assert.equal(questions[0], "quais alertas?");
		assert.ok(questions[1]?.includes("Plantonista: quais alertas?"));
		assert.ok(questions[1]?.includes("OpsPilot: resposta 1"));
		assert.ok(questions[1]?.endsWith("Pergunta atual: abre um incidente para o segundo"));
	});
});

test("POST /chat com conversationId inexistente responde 404 sem executar a estratégia", async () => {
	const { strategy, questions } = recordingStrategy("react");
	const registry = new Map([["react", strategy]]);

	await withServer(registry, {}, async (baseUrl) => {
		const response = await postChat(baseUrl, { message: "oi", conversationId: UNKNOWN_ID });

		assert.equal(response.status, 404);
		assert.deepEqual(withoutRequestId(await response.json()), { error: "conversation_not_found", conversationId: UNKNOWN_ID });
		assert.equal(questions.length, 0);
	});
});

test("POST /chat com conversationId malformado responde 400 com issues do Zod", async () => {
	const registry = new Map([["react", fakeStrategy("react", fakeResult("x"))]]);

	await withServer(registry, {}, async (baseUrl) => {
		const response = await postChat(baseUrl, { message: "oi", conversationId: "abc" });

		assert.equal(response.status, 400);
		const body = (await response.json()) as { issues: unknown[] };
		assert.ok(body.issues.length > 0);
	});
});

test("POST /chat com timeout (504) ou estratégia desconhecida (422) não grava nada na conversa", async () => {
	const registry = new Map([
		["react", fakeStrategy("react", fakeResult("primeira"))],
		["plan-and-execute", hangingStrategy("plan-and-execute")],
	]);

	await withServer(registry, { timeoutMs: 20 }, async (baseUrl, conversations) => {
		const { conversationId } = (await (await postChat(baseUrl, { message: "oi" })).json()) as ChatBody;

		const timedOut = await postChat(baseUrl, { message: "trava", strategy: "plan-and-execute", conversationId });
		const unknown = await postChat(baseUrl, { message: "e essa?", strategy: "nao-existe", conversationId });

		assert.equal(timedOut.status, 504);
		assert.equal(unknown.status, 422);
		assert.equal((await conversations.lastMessages(conversationId, 12)).length, 2);
	});
});

test("POST /chat com reflect:true grava a resposta final e nunca grava o trace", async () => {
	const registry = new Map([["react", fakeStrategy("react", fakeResult("resposta refletida"))]]);
	const approvingCritic: Critic = async () => ({ approved: true });

	await withServer(registry, { reflectionOptions: { critic: approvingCritic } }, async (baseUrl, conversations) => {
		const body = (await (await postChat(baseUrl, { message: "oi", reflect: true })).json()) as ChatBody;

		const messages = await conversations.lastMessages(body.conversationId, 12);
		assert.deepEqual(
			messages.map((message) => message.content),
			["oi", "resposta refletida"],
		);
	});
});

test("POST /chat sem resumidor leva só as 8 mensagens mais recentes para a estratégia", async () => {
	const { strategy, questions } = recordingStrategy("react");
	const registry = new Map([["react", strategy]]);

	await withServer(registry, {}, async (baseUrl) => {
		const { conversationId } = (await (await postChat(baseUrl, { message: "p1" })).json()) as ChatBody;
		for (let turn = 2; turn <= 9; turn += 1) {
			await postChat(baseUrl, { message: `p${turn}`, conversationId });
		}

		// 9º turno vê 16 mensagens anteriores (p1..p8 + respostas); sem resumidor, só p5..p8 cabem na janela de 8 (specs/012).
		const last = questions[8] ?? "";
		assert.ok(!last.includes("Plantonista: p4\n"));
		assert.ok(last.includes("Plantonista: p5\n"));
		assert.ok(last.includes("OpsPilot: resposta 8\n"));
		assert.equal(last.split("\n").filter((line) => /^(Plantonista|OpsPilot): /.test(line)).length, 8);
	});
});

test("POST /chat sem resumidor reporta metrics.historyMessages crescendo até a janela de 8", async () => {
	const { strategy } = recordingStrategy("react");
	const registry = new Map([["react", strategy]]);

	await withServer(registry, {}, async (baseUrl) => {
		const seen: number[] = [];
		let conversationId: string | undefined;
		for (let turn = 1; turn <= 8; turn += 1) {
			const body = (await (await postChat(baseUrl, { message: `p${turn}`, conversationId })).json()) as ChatBody & {
				metrics: { historyMessages: number };
			};
			conversationId = body.conversationId;
			seen.push(body.metrics.historyMessages);
		}

		assert.deepEqual(seen, [0, 2, 4, 6, 8, 8, 8, 8]);
	});
});

// --- Memória semântica (specs/008) ---

type MemoryChatBody = ChatBody & { metrics: { memoryFacts: number } };

async function memoryWithFact(): Promise<{ memory: SqliteMemoryStore }> {
	const memory = new SqliteMemoryStore(
		createFakeEmbedder({ "qual banco usamos?": [1, 0], "usamos postgres": [1, 0] }),
		":memory:",
	);
	await memory.remember("alice", "usamos postgres");
	return { memory };
}

test("POST /chat com userId injeta os fatos lembrados e reporta metrics.memoryFacts", async () => {
	const { strategy, questions } = recordingStrategy("react");
	const registry = new Map([["react", strategy]]);
	const { memory } = await memoryWithFact();

	await withServer(
		registry,
		{},
		async (baseUrl) => {
			const response = await postChat(baseUrl, { message: "qual banco usamos?", userId: "alice" });

			assert.equal(response.status, 200);
			const body = (await response.json()) as MemoryChatBody;
			assert.equal(body.metrics.memoryFacts, 1);
			assert.ok(questions[0]?.includes("\n- usamos postgres\n"));
			assert.ok(questions[0]?.endsWith("\n\nqual banco usamos?"));
		},
		undefined,
		{ memory },
	);
	memory.close();
});

test("POST /chat sem userId reporta memoryFacts 0 e não altera a pergunta", async () => {
	const { strategy, questions } = recordingStrategy("react");
	const { memory } = await memoryWithFact();

	await withServer(
		new Map([["react", strategy]]),
		{},
		async (baseUrl) => {
			const body = (await (await postChat(baseUrl, { message: "qual banco usamos?" })).json()) as MemoryChatBody;

			assert.equal(body.metrics.memoryFacts, 0);
			assert.deepEqual(questions, ["qual banco usamos?"]);
		},
		undefined,
		{ memory },
	);
	memory.close();
});

test("POST /chat passa o userId para strategiesFor (undefined sem userId)", async () => {
	const registry = new Map([["react", fakeStrategy("react", fakeResult("ok"))]]);
	const requested: Array<string | undefined> = [];

	await withServer(
		registry,
		{},
		async (baseUrl) => {
			await postChat(baseUrl, { message: "oi", userId: "alice" });
			await postChat(baseUrl, { message: "oi" });

			assert.deepEqual(requested, ["alice", undefined]);
		},
		undefined,
		{
			strategiesFor: (userId) => {
				requested.push(userId);
				return registry;
			},
		},
	);
});

test("POST /chat com userId inválido responde 400 com issues do Zod", async () => {
	const registry = new Map([["react", fakeStrategy("react", fakeResult("ok"))]]);

	await withServer(registry, {}, async (baseUrl) => {
		for (const userId of ["", "   ", 42, "x".repeat(129)]) {
			const response = await postChat(baseUrl, { message: "oi", userId });

			assert.equal(response.status, 400, `userId ${JSON.stringify(userId)}`);
			const body = (await response.json()) as { issues: unknown[] };
			assert.ok(body.issues.length > 0);
		}
	});
});

test("POST /chat com userId e embedder quebrado responde 500 internal_error", async () => {
	const registry = new Map([["react", fakeStrategy("react", fakeResult("ok"))]]);
	const { memory } = await memoryWithFact();
	const originalError = console.error;
	console.error = () => {};

	try {
		await withServer(
			registry,
			{},
			async (baseUrl) => {
				const response = await postChat(baseUrl, { message: "texto sem vetor no fake", userId: "alice" });

				assert.equal(response.status, 500);
				assert.deepEqual(withoutRequestId(await response.json()), { error: "internal_error" });
			},
			undefined,
			{ memory },
		);
	} finally {
		console.error = originalError;
		memory.close();
	}
});

// --- Refletor de aprendizado (specs/009) ---

test("POST /chat dispara learn com o userId da requisição, e não dispara sem userId", async () => {
	const registry = new Map([["react", fakeStrategy("react", fakeResult("ok"))]]);
	const calls: Array<{ userId: string; message: string }> = [];

	await withServer(
		registry,
		{},
		async (baseUrl) => {
			assert.equal((await postChat(baseUrl, { message: "sou eu que cuido do checkout", userId: "alice" })).status, 200);
			assert.equal((await postChat(baseUrl, { message: "lista os alertas" })).status, 200);

			assert.deepEqual(calls, [{ userId: "alice", message: "sou eu que cuido do checkout" }]);
		},
		undefined,
		{
			learn: async (input) => {
				calls.push(input);
			},
		},
	);
});

// --- Medição de contexto (specs/011) ---

async function postChatMetrics(strategy: ReasoningStrategy, message: string): Promise<Record<string, unknown>> {
	let metrics: Record<string, unknown> = {};
	await withServer(new Map([["react", strategy]]), {}, async (baseUrl) => {
		const response = await fetch(`${baseUrl}/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ message }),
		});
		assert.equal(response.status, 200);
		metrics = ((await response.json()) as { metrics: Record<string, unknown> }).metrics;
	});
	return metrics;
}

test("POST /chat 200 traz promptTokens real somado no turno", async () => {
	const strategy: ReasoningStrategy = {
		name: "react",
		async run(): Promise<StrategyResult> {
			recordUsage({ inputTokens: 42, outputTokens: 1, totalTokens: 43 });
			return fakeResult("ok");
		},
	};

	const metrics = await postChatMetrics(strategy, "Como está o plantão?");

	assert.equal(metrics.promptTokens, 42);
});

test("POST /chat 200 sem uso informado traz promptTokens null, presente no JSON", async () => {
	const metrics = await postChatMetrics(fakeStrategy("react", fakeResult("ok")), "Como está o plantão?");

	assert.ok("promptTokens" in metrics);
	assert.equal(metrics.promptTokens, null);
});

test("POST /chat 200 traz contextBreakdown com as quatro fatias e total igual à soma", async () => {
	const metrics = await postChatMetrics(fakeStrategy("react", fakeResult("ok")), "Como está o plantão?");
	const breakdown = metrics.contextBreakdown as Record<string, number>;

	for (const key of ["question", "history", "memory", "total"]) {
		assert.equal(typeof breakdown[key], "number", key);
	}
	assert.equal(breakdown.total, (breakdown.question ?? 0) + (breakdown.history ?? 0) + (breakdown.memory ?? 0));
	assert.ok((breakdown.question ?? 0) > 0);
});

// --- Sumarização de histórico (specs/012) ---

test("POST /chat com resumidor aplica o resumo no 9º turno e responde 200", async () => {
	const { strategy, questions } = recordingStrategy("react");
	const summarizer = createFakeSummarizer();

	await withServer(
		new Map([["react", strategy]]),
		{},
		async (baseUrl) => {
			let conversationId: string | undefined;
			for (let turn = 1; turn <= 9; turn += 1) {
				const response = await postChat(baseUrl, { message: `p${turn}`, conversationId });
				assert.equal(response.status, 200);
				conversationId = ((await response.json()) as ChatBody).conversationId;
			}

			assert.equal(summarizer.calls.length, 1);
			assert.ok((questions[8] ?? "").startsWith("Resumo da conversa até aqui:"));
		},
		undefined,
		{ summarizer },
	);
});

test("POST /chat traz o evento summarize e contextBreakdown.summary só a partir do turno do resumo", async () => {
	const { strategy } = recordingStrategy("react");
	type Body = ChatBody & { metrics: { contextBreakdown: { summary: number } } };

	await withServer(
		new Map([["react", strategy]]),
		{},
		async (baseUrl) => {
			const bodies: Body[] = [];
			let conversationId: string | undefined;
			for (let turn = 1; turn <= 9; turn += 1) {
				const body = (await (await postChat(baseUrl, { message: `p${turn}`, conversationId })).json()) as Body;
				conversationId = body.conversationId;
				bodies.push(body);
			}

			assert.equal(bodies[7]?.trace.some((event) => event.type === "summarize"), false);
			assert.equal(bodies[7]?.metrics.contextBreakdown.summary, 0);
			assert.equal(bodies[8]?.trace[0]?.type, "summarize");
			assert.ok((bodies[8]?.metrics.contextBreakdown.summary ?? 0) > 0);
		},
		undefined,
		{ summarizer: createFakeSummarizer() },
	);
});

test("POST /chat com contextBudget baixo reporta metrics.contextTrimmed após turnos na mesma conversa (specs/013)", async () => {
	const { strategy } = recordingStrategy("react");
	type Body = ChatBody & {
		metrics: { contextTrimmed: { historyMessages: number; memoryFacts: number; summaryTruncated: boolean }; contextBreakdown: { history: number } };
	};

	await withServer(
		new Map([["react", strategy]]),
		{},
		async (baseUrl) => {
			const bodies: Body[] = [];
			let conversationId: string | undefined;
			for (let turn = 1; turn <= 4; turn += 1) {
				const body = (await (await postChat(baseUrl, { message: `p${turn}`, conversationId })).json()) as Body;
				conversationId = body.conversationId;
				bodies.push(body);
			}

			assert.deepEqual(bodies[0]?.metrics.contextTrimmed, { historyMessages: 0, memoryFacts: 0, summaryTruncated: false });
			assert.ok((bodies[3]?.metrics.contextTrimmed.historyMessages ?? 0) > 0);
			assert.ok((bodies[3]?.metrics.contextBreakdown.history ?? Infinity) <= 25);
		},
		undefined,
		{ contextBudget: { summary: 200, window: 25, memory: 300 } },
	);
});

// --- Grafo unificado de produção (specs/014) ---

const NODES = ["contexto", "roteador", "react", "plan-and-execute", "reflection"];

function routesRegistry() {
	return new Map([
		["react", fakeStrategy("react", fakeResult("resposta react"))],
		["plan-and-execute", fakeStrategy("plan-and-execute", fakeResult("resposta plan"))],
	]);
}

type GraphBody = { answer: string; trace: GraphTraceEvent[]; metrics: { llmCalls: number } };

test("POST /chat sem strategy: o roteador decide e o rastro traz route com source router", async () => {
	const router = createFakeRouter({ route: "plan-and-execute", reason: "vários passos" });

	await withServer(
		routesRegistry(),
		{},
		async (baseUrl) => {
			const response = await postChat(baseUrl, { message: "para cada alerta, abra um incidente" });

			assert.equal(response.status, 200);
			const body = (await response.json()) as GraphBody;
			assert.equal(body.answer, "resposta plan");
			assert.deepEqual(body.trace[0], {
				type: "route",
				route: "plan-and-execute",
				reason: "vários passos",
				source: "router",
				node: "roteador",
			});
			assert.ok(body.trace.every((event) => NODES.includes(event.node)), JSON.stringify(body.trace));
			assert.equal(router.calls.length, 1);
		},
		undefined,
		{ router },
	);
});

test("POST /chat com roteador que falha responde 200 via react com source fallback", async (t) => {
	t.mock.method(console, "warn", () => {});

	await withServer(
		routesRegistry(),
		{},
		async (baseUrl) => {
			const response = await postChat(baseUrl, { message: "oi" });

			assert.equal(response.status, 200);
			const body = (await response.json()) as GraphBody;
			assert.equal(body.answer, "resposta react");
			const route = body.trace.find((event) => event.type === "route");
			assert.equal(route?.type === "route" ? route.source : undefined, "fallback");
		},
		undefined,
		{ router: createFakeRouter(new Error("fora do ar")) },
	);
});

test("POST /chat com reflect:true sem strategy aplica reflexão sobre a rota escolhida", async () => {
	let criticCalls = 0;
	const critic: Critic = async () => {
		criticCalls += 1;
		return { approved: true };
	};

	await withServer(
		routesRegistry(),
		{ reflectionOptions: { critic } },
		async (baseUrl) => {
			const response = await postChat(baseUrl, { message: "oi", reflect: true });

			assert.equal(response.status, 200);
			assert.equal(criticCalls, 1);
		},
		undefined,
		{ router: createFakeRouter({ route: "react", reason: "direto" }) },
	);
});

test("POST /chat com strategy faz override: não chama o roteador e registra source override", async () => {
	const router = createFakeRouter({ route: "react", reason: "x" });

	await withServer(
		routesRegistry(),
		{},
		async (baseUrl) => {
			const response = await postChat(baseUrl, { message: "oi", strategy: "plan-and-execute" });

			assert.equal(response.status, 200);
			const body = (await response.json()) as GraphBody;
			assert.equal(router.calls.length, 0);
			assert.equal(body.answer, "resposta plan");
			assert.deepEqual(body.trace[0], {
				type: "route",
				route: "plan-and-execute",
				reason: OVERRIDE_REASON,
				source: "override",
				node: "roteador",
			});
		},
		undefined,
		{ router },
	);
});

test("POST /chat com strategy desconhecida lista as três rotas e não grava nada", async () => {
	await withServer(routesRegistry(), {}, async (baseUrl, conversations) => {
		const { conversationId } = (await (await postChat(baseUrl, { message: "oi" })).json()) as ChatBody;

		const response = await postChat(baseUrl, { message: "e essa?", strategy: "xyz", conversationId });

		assert.equal(response.status, 422);
		assert.deepEqual(withoutRequestId(await response.json()), {
			error: "unknown_strategy",
			strategy: "xyz",
			available: ["react", "plan-and-execute", "reflection"],
		});
		assert.equal((await conversations.lastMessages(conversationId, 12)).length, 2);
	});
});

test("POST /chat com strategy reflection e reflect:true reflete uma vez só", async () => {
	let criticCalls = 0;
	const critic: Critic = async () => {
		criticCalls += 1;
		return { approved: true };
	};

	await withServer(routesRegistry(), { reflectionOptions: { critic } }, async (baseUrl) => {
		const response = await postChat(baseUrl, { message: "oi", strategy: "reflection", reflect: true });

		assert.equal(response.status, 200);
		const body = (await response.json()) as GraphBody;
		assert.equal(criticCalls, 1);
		assert.ok(body.trace.some((event) => event.node === "reflection"));
	});
});

test("POST /chat com strategy react (cliente legado) continua 200", async () => {
	await withServer(routesRegistry(), {}, async (baseUrl) => {
		const response = await postChat(baseUrl, { message: "oi", strategy: "react" });

		assert.equal(response.status, 200);
		assert.equal(((await response.json()) as GraphBody).answer, "resposta react");
	});
});

// --- Resiliência de modelo (specs/015) ---

function unavailableStrategy(name: string): ReasoningStrategy {
	return {
		name,
		async run(): Promise<StrategyResult> {
			throw new ModelUnavailableError(["a", "b"]);
		},
	};
}

test("POST /chat com todos os modelos indisponíveis responde 503 model_unavailable sem gravar nada", async (t) => {
	const warn = t.mock.method(console, "warn", () => {});
	const error = t.mock.method(console, "error", () => {});
	const registry = new Map([
		["react", fakeStrategy("react", fakeResult("primeira"))],
		["plan-and-execute", unavailableStrategy("plan-and-execute")],
	]);

	await withServer(registry, {}, async (baseUrl, conversations) => {
		const { conversationId } = (await (await postChat(baseUrl, { message: "oi" })).json()) as ChatBody;

		const response = await postChat(baseUrl, { message: "de novo", strategy: "plan-and-execute", conversationId });

		assert.equal(response.status, 503);
		assert.deepEqual(withoutRequestId(await response.json()), { error: "model_unavailable", modelsTried: ["a", "b"] });
		assert.equal((await conversations.lastMessages(conversationId, 12)).length, 2);
		const logged = [...warn.mock.calls, ...error.mock.calls].map((call) => call.arguments.join(" ")).join("\n");
		assert.doesNotMatch(logged, /Nenhum modelo respondeu/);
	});
});

test("POST /chat com erro que não vem do modelo continua 500 internal_error", async (t) => {
	t.mock.method(console, "error", () => {});
	const buggy: ReasoningStrategy = {
		name: "react",
		async run(): Promise<StrategyResult> {
			throw new Error("bug");
		},
	};

	await withServer(new Map([["react", buggy]]), {}, async (baseUrl) => {
		const response = await postChat(baseUrl, { message: "oi" });

		assert.equal(response.status, 500);
		assert.deepEqual(withoutRequestId(await response.json()), { error: "internal_error" });
	});
});

test("POST /chat com roteador indisponível segue pela estratégia e responde 200", async (t) => {
	t.mock.method(console, "warn", () => {});

	await withServer(
		new Map([["react", fakeStrategy("react", fakeResult("respondeu"))]]),
		{},
		async (baseUrl) => {
			const response = await postChat(baseUrl, { message: "oi" });

			assert.equal(response.status, 200);
			assert.equal(((await response.json()) as ChatBody).answer, "respondeu");
		},
		undefined,
		{ router: createFakeRouter(new ModelUnavailableError(["a"])) },
	);
});

test("POST /chat 200 traz metrics.modelUsed: null sem chamada ao modelo e o id quando há", async () => {
	const answering: ReasoningStrategy = {
		name: "plan-and-execute",
		async run(): Promise<StrategyResult> {
			recordModelCall({ modelUsed: "modelo/reserva", switches: [] });
			return fakeResult("com modelo");
		},
	};
	const registry = new Map([
		["react", fakeStrategy("react", fakeResult("sem modelo"))],
		["plan-and-execute", answering],
	]);

	await withServer(registry, {}, async (baseUrl) => {
		const plain = (await (await postChat(baseUrl, { message: "oi" })).json()) as { metrics: Record<string, unknown> };
		const withModel = (await (await postChat(baseUrl, { message: "oi", strategy: "plan-and-execute" })).json()) as {
			metrics: Record<string, unknown>;
		};

		assert.ok("modelUsed" in plain.metrics);
		assert.equal(plain.metrics.modelUsed, null);
		assert.equal(withModel.metrics.modelUsed, "modelo/reserva");
	});
});

// --- requestId (specs/016) ---

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function buggyStrategy(name: string, message = "bug"): ReasoningStrategy {
	return {
		name,
		async run(): Promise<StrategyResult> {
			throw new Error(message);
		},
	};
}

/** Cada caminho do /chat, com o status esperado (contracts/chat-api.md). */
function requestIdCases(): Array<{ label: string; status: number; send: (baseUrl: string) => Promise<Response> }> {
	return [
		{ label: "200", status: 200, send: (b) => postChat(b, { message: "oi" }) },
		{ label: "400", status: 400, send: (b) => postChat(b, { message: "" }) },
		{ label: "422", status: 422, send: (b) => postChat(b, { message: "oi", strategy: "xyz" }) },
		{ label: "404", status: 404, send: (b) => postChat(b, { message: "oi", conversationId: UNKNOWN_ID }) },
		{ label: "503", status: 503, send: (b) => postChat(b, { message: "oi", strategy: "plan-and-execute" }) },
		{ label: "504", status: 504, send: (b) => postChat(b, { message: "oi", strategy: "reflection" }) },
		{
			label: "500 JSON malformado",
			status: 500,
			send: (b) => fetch(`${b}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }),
		},
	];
}

/** Registry com uma rota para cada desfecho: react ok, plan-and-execute 503, reflection 504. */
function outcomesRegistry(): Map<string, ReasoningStrategy> {
	return new Map([
		["react", fakeStrategy("react", fakeResult("ok"))],
		["plan-and-execute", unavailableStrategy("plan-and-execute")],
		["reflection", hangingStrategy("reflection")],
	]);
}

test("POST /chat traz requestId UUID igual no corpo e no X-Request-Id em todo status", async (t) => {
	t.mock.method(console, "error", () => {});
	t.mock.method(console, "warn", () => {});
	const ids: string[] = [];
	const check = async (response: Response, status: number, label: string) => {
		const body = (await response.json()) as { requestId?: string };
		assert.equal(response.status, status, label);
		assert.match(body.requestId ?? "", UUID_PATTERN, label);
		assert.equal(response.headers.get("x-request-id"), body.requestId, label);
		ids.push(body.requestId!);
	};

	await withServer(outcomesRegistry(), { timeoutMs: 20 }, async (baseUrl) => {
		for (const { label, status, send } of requestIdCases()) {
			await check(await send(baseUrl), status, label);
		}
	});
	await withServer(new Map([["react", buggyStrategy("react")]]), {}, async (baseUrl) => {
		await check(await postChat(baseUrl, { message: "oi" }), 500, "500 turno");
	});
	assert.equal(new Set(ids).size, ids.length);
});

test("POST /chat ignora o X-Request-Id do cliente", async () => {
	await withServer(new Map([["react", fakeStrategy("react", fakeResult("ok"))]]), {}, async (baseUrl) => {
		const response = await fetch(`${baseUrl}/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Request-Id": "cliente" },
			body: JSON.stringify({ message: "oi" }),
		});
		const body = (await response.json()) as { requestId: string };

		assert.notEqual(body.requestId, "cliente");
		assert.equal(response.headers.get("x-request-id"), body.requestId);
	});
});

test("POST /chat usa o newRequestId injetado", async () => {
	await withServer(new Map([["react", fakeStrategy("react", fakeResult("ok"))]]), { newRequestId: () => "fixo" }, async (baseUrl) => {
		const response = await postChat(baseUrl, { message: "oi" });

		assert.equal(response.headers.get("x-request-id"), "fixo");
		assert.equal(((await response.json()) as { requestId: string }).requestId, "fixo");
	});
});

// --- Rastro persistido (specs/016) ---

interface RequestBody {
	request: Record<string, unknown> & { status: number; errorCode: string | null; metrics: unknown; route: string | null };
	trace: unknown[];
}

async function getRequestRecord(baseUrl: string, requestId: string): Promise<Response> {
	return fetch(`${baseUrl}/requests/${requestId}`);
}

test("POST /chat 200 é consultável em GET /requests/:id com o mesmo trace e as mesmas metrics", async () => {
	const requests = createMockRequestStore();
	const registry = new Map([["react", fakeStrategy("react", fakeResult("ok"))]]);

	await withServer(
		registry,
		{},
		async (baseUrl) => {
			const chat = (await (await postChat(baseUrl, { message: "oi", userId: "ana" })).json()) as ChatBody & {
				requestId: string;
				metrics: unknown;
			};

			const response = await getRequestRecord(baseUrl, chat.requestId);
			const stored = (await response.json()) as RequestBody;

			assert.equal(response.status, 200);
			assert.deepEqual(stored.trace, chat.trace);
			assert.deepEqual(stored.request.metrics, chat.metrics);
			assert.equal(stored.request.status, 200);
			assert.equal(stored.request.outcome, "ok");
			assert.equal(stored.request.errorCode, null);
			assert.equal(stored.request.route, "react");
			assert.equal(stored.request.routeSource, "fallback");
			assert.equal(stored.request.conversationId, chat.conversationId);
			assert.equal(stored.request.userId, "ana");
		},
		undefined,
		{ requests },
	);
});

test("POST /chat com erro de turno (404, 503, 504, 500) grava o registro sem métricas nem rastro", async (t) => {
	t.mock.method(console, "error", () => {});
	t.mock.method(console, "warn", () => {});
	const requests = createMockRequestStore();
	const cases: Array<[string, (baseUrl: string) => Promise<Response>, number, string]> = [
		["404", (b) => postChat(b, { message: "oi", conversationId: UNKNOWN_ID }), 404, "conversation_not_found"],
		["503", (b) => postChat(b, { message: "oi", strategy: "plan-and-execute" }), 503, "model_unavailable"],
		["504", (b) => postChat(b, { message: "oi", strategy: "reflection" }), 504, "timeout"],
	];

	const check = async (baseUrl: string, response: Response, status: number, errorCode: string) => {
		const { requestId } = (await response.json()) as { requestId: string };
		const stored = (await (await getRequestRecord(baseUrl, requestId)).json()) as RequestBody;
		assert.equal(stored.request.status, status);
		assert.equal(stored.request.outcome, "error");
		assert.equal(stored.request.errorCode, errorCode);
		assert.equal(stored.request.metrics, null);
		assert.equal(stored.request.route, null);
		assert.deepEqual(stored.trace, []);
	};

	await withServer(
		outcomesRegistry(),
		{ timeoutMs: 20 },
		async (baseUrl) => {
			for (const [, send, status, errorCode] of cases) {
				await check(baseUrl, await send(baseUrl), status, errorCode);
			}
		},
		undefined,
		{ requests },
	);
	await withServer(
		new Map([["react", buggyStrategy("react")]]),
		{},
		async (baseUrl) => {
			await check(baseUrl, await postChat(baseUrl, { message: "oi" }), 500, "internal_error");
		},
		undefined,
		{ requests },
	);
});

test("POST /chat com 400 ou 422 não é persistido", async () => {
	const requests = createMockRequestStore();

	await withServer(
		new Map([["react", fakeStrategy("react", fakeResult("ok"))]]),
		{},
		async (baseUrl) => {
			for (const body of [{ message: "" }, { message: "oi", strategy: "xyz" }]) {
				const { requestId } = (await (await postChat(baseUrl, body)).json()) as { requestId: string };
				assert.equal((await getRequestRecord(baseUrl, requestId)).status, 404);
			}
		},
		undefined,
		{ requests },
	);
});

test("POST /chat com falha ao persistir responde igual e o GET devolve 404", async () => {
	const registry = new Map([["react", fakeStrategy("react", fakeResult("ok"))]]);
	const send = async (requests: RequestStore) => {
		let captured: { status: number; body: Record<string, unknown>; getStatus: number } | undefined;
		await withServer(
			registry,
			{ newRequestId: () => "66666666-0000-4000-8000-000000000001" },
			async (baseUrl) => {
				const response = await postChat(baseUrl, { message: "oi" });
				const body = (await response.json()) as Record<string, unknown>;
				captured = { status: response.status, body, getStatus: (await getRequestRecord(baseUrl, String(body.requestId))).status };
			},
			undefined,
			{ requests },
		);
		return captured!;
	};

	const healthy = await send(createMockRequestStore());
	const broken = await send(createMockRequestStore({ failOnSave: true }));

	assert.equal(broken.status, healthy.status);
	const strip = ({ conversationId: _c, metrics, ...rest }: Record<string, unknown>) => ({
		...rest,
		metrics: { ...(metrics as Record<string, unknown>), latencyMs: 0 },
	});
	assert.deepEqual(strip(broken.body), strip(healthy.body));
	assert.equal(healthy.getStatus, 200);
	assert.equal(broken.getStatus, 404);
});

test("sem RequestStore, /requests não é montado", async () => {
	await withServer(new Map([["react", fakeStrategy("react", fakeResult("ok"))]]), {}, async (baseUrl) => {
		const response = await getRequestRecord(baseUrl, UNKNOWN_ID);

		assert.equal(response.status, 404);
		assert.notEqual(response.headers.get("content-type")?.includes("application/json"), true);
	});
});

// --- Estatísticas (specs/017) ---

test("GET /stats agrega os turnos do /chat gravados no RequestStore", async () => {
	const requests = createMockRequestStore();
	const registry = new Map([["react", fakeStrategy("react", fakeResult("ok"))]]);

	await withServer(
		registry,
		{},
		async (baseUrl) => {
			await postChat(baseUrl, { message: "oi" });
			await postChat(baseUrl, { message: "oi", conversationId: UNKNOWN_ID });

			const response = await fetch(`${baseUrl}/stats?since=1h`);
			const body = (await response.json()) as { total: number; errors: number; byRoute: Array<{ route: string | null; total: number }> };

			assert.equal(response.status, 200);
			assert.equal(body.total, 2);
			assert.equal(body.errors, 1);
			assert.deepEqual(
				body.byRoute.map((g) => [g.route, g.total]),
				[
					["react", 1],
					[null, 1],
				],
			);
		},
		undefined,
		{ requests },
	);
});

test("sem RequestStore, /stats não é montado", async () => {
	await withServer(new Map([["react", fakeStrategy("react", fakeResult("ok"))]]), {}, async (baseUrl) => {
		assert.equal((await fetch(`${baseUrl}/stats`)).status, 404);
	});
});

// --- Logs JSON (specs/016) ---

function captureLogger(): { lines: string[]; entries: () => Array<Record<string, unknown>>; logger: ReturnType<typeof createLogger> } {
	const lines: string[] = [];
	return {
		lines,
		entries: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
		logger: createLogger({ sink: (line) => lines.push(line) }),
	};
}

test("POST /chat 200 loga start, um chat.trace.event por evento e end, sem conteúdo", async () => {
	const { lines, entries, logger } = captureLogger();
	const marked: StrategyResult = {
		answer: "MARCADOR-RESPOSTA-789",
		trace: [
			{ type: "action", tool: "list_alerts", args: { q: "MARCADOR-ARGS-321" } },
			{ type: "observation", content: "MARCADOR-OBS-123" },
			{ type: "answer", content: "MARCADOR-RESPOSTA-789" },
		],
		metrics: { llmCalls: 2, latencyMs: 5 },
	};

	await withServer(
		new Map([["react", fakeStrategy("react", marked)]]),
		{},
		async (baseUrl) => {
			const body = (await (await postChat(baseUrl, { message: "MARCADOR-PERGUNTA-456" })).json()) as ChatBody & { requestId: string };

			const logged = entries();
			const traceLines = logged.filter((entry) => entry.event === "chat.trace.event");
			assert.equal(logged[0]?.event, "chat.request.start");
			assert.equal(logged.at(-1)?.event, "chat.request.end");
			assert.equal(logged.at(-1)?.status, 200);
			assert.equal(logged.at(-1)?.route, "react");
			assert.equal(logged.at(-1)?.llmCalls, body.metrics.llmCalls);
			assert.equal(traceLines.length, body.trace.length);
			assert.deepEqual(traceLines.map((entry) => entry.seq), body.trace.map((_, i) => i));
			assert.deepEqual(traceLines.map((entry) => entry.type), body.trace.map((event) => event.type));
			assert.ok(logged.every((entry) => entry.requestId === body.requestId));
			assert.equal(traceLines.find((entry) => entry.type === "action")?.tool, "list_alerts");
			assert.doesNotMatch(lines.join(" "), /MARCADOR/);
		},
		undefined,
		{ logger },
	);
});

test("POST /chat 503 loga model.unavailable com modelsTried e end em warn com errorCode", async () => {
	const { entries, logger } = captureLogger();

	await withServer(
		outcomesRegistry(),
		{},
		async (baseUrl) => {
			await postChat(baseUrl, { message: "oi", strategy: "plan-and-execute" });

			const logged = entries();
			assert.deepEqual(logged.find((entry) => entry.event === "model.unavailable")?.modelsTried, ["a", "b"]);
			const end = logged.find((entry) => entry.event === "chat.request.end");
			assert.equal(end?.level, "warn");
			assert.equal(end?.status, 503);
			assert.equal(end?.errorCode, "model_unavailable");
		},
		undefined,
		{ logger },
	);
});

test("POST /chat com erro inesperado loga http.unexpected_error só com o nome do erro", async () => {
	const { lines, entries, logger } = captureLogger();

	await withServer(
		new Map([["react", buggyStrategy("react", "MARCADOR-ERRO-555")]]),
		{},
		async (baseUrl) => {
			const { requestId } = (await (await postChat(baseUrl, { message: "oi" })).json()) as { requestId: string };

			const unexpected = entries().find((entry) => entry.event === "http.unexpected_error");
			assert.equal(unexpected?.errorName, "Error");
			assert.equal(unexpected?.requestId, requestId);
			assert.doesNotMatch(lines.join(" "), /MARCADOR/);
		},
		undefined,
		{ logger },
	);
});

test("POST /chat 400 loga start e end com status 400, sem eventos de rastro", async () => {
	const { entries, logger } = captureLogger();

	await withServer(
		new Map([["react", fakeStrategy("react", fakeResult("ok"))]]),
		{},
		async (baseUrl) => {
			await postChat(baseUrl, { message: "" });

			assert.deepEqual(entries().map((entry) => [entry.event, entry.status]), [
				["chat.request.start", undefined],
				["chat.request.end", 400],
			]);
		},
		undefined,
		{ logger },
	);
});

// --- CORS e /health (specs/018) ---

const WEB_ORIGIN = "http://localhost:5173";

test("GET /health responde 200 { status: ok } sem requestId", async () => {
	await withServer(new Map([["react", fakeStrategy("react", fakeResult("ok"))]]), {}, async (baseUrl) => {
		const response = await fetch(`${baseUrl}/health`);

		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), { status: "ok" });
		assert.equal(response.headers.get("x-request-id"), null);
	});
});

test("CORS: origem permitida recebe Allow-Origin e pode ler o X-Request-Id; preflight responde 204", async () => {
	await withServer(
		new Map([["react", fakeStrategy("react", fakeResult("ok"))]]),
		{},
		async (baseUrl) => {
			const chat = await fetch(`${baseUrl}/chat`, {
				method: "POST",
				headers: { "content-type": "application/json", origin: WEB_ORIGIN },
				body: JSON.stringify({ message: "oi" }),
			});
			assert.equal(chat.status, 200);
			assert.equal(chat.headers.get("access-control-allow-origin"), WEB_ORIGIN);
			assert.equal(chat.headers.get("access-control-expose-headers"), "X-Request-Id");

			const preflight = await fetch(`${baseUrl}/chat`, {
				method: "OPTIONS",
				headers: { origin: WEB_ORIGIN, "access-control-request-method": "POST" },
			});
			assert.equal(preflight.status, 204);
			assert.equal(preflight.headers.get("access-control-allow-methods"), "GET, POST, DELETE, OPTIONS");

			const stranger = await fetch(`${baseUrl}/health`, { headers: { origin: "http://evil.test" } });
			assert.equal(stranger.status, 200);
			assert.equal(stranger.headers.get("access-control-allow-origin"), null);
		},
		undefined,
		{ corsOrigins: [WEB_ORIGIN] },
	);
});

test("CORS: sem corsOrigins nenhuma origem recebe cabeçalho CORS", async () => {
	await withServer(new Map([["react", fakeStrategy("react", fakeResult("ok"))]]), {}, async (baseUrl) => {
		const response = await fetch(`${baseUrl}/health`, { headers: { origin: WEB_ORIGIN } });

		assert.equal(response.headers.get("access-control-allow-origin"), null);
	});
});

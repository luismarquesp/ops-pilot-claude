import { test } from "node:test";
import assert from "node:assert/strict";
import {
	createProductionGraph,
	dedupeFallbacks,
	fallbackEvents,
	NO_ROUTER_REASON,
	OVERRIDE_REASON,
	RESUME_REASON,
	tagTrace,
	type ProductionGraphDeps,
} from "./production-graph.js";
import { recordModelCall, trackModelCalls, type ModelCall } from "../agents/model-calls.js";
import { createFakeRouter } from "../agents/fake-router.js";
import { createFakeSummarizer } from "../agents/fake-summarizer.js";
import { ROUTE_TABLE, type Router } from "../agents/router.js";
import { routeStrategies, type RouteStrategies } from "../agents/routes.js";
import type { ReasoningStrategy, StrategyResult, Trace } from "../agents/strategy.js";
import { buildContext } from "../context/context-builder.js";
import { ConversationNotFoundError } from "../services/errors.js";
import { trackApprovals, withApprovalGate } from "../agents/approval-gate.js";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createMockConversationStore } from "../store/mock-conversation-store.js";
import type { ConversationStore } from "../store/conversation-store.js";

type SpyStrategy = ReasoningStrategy & { questions: string[] };

function spyStrategy(name: string, trace?: Trace): SpyStrategy {
	const questions: string[] = [];
	return {
		name,
		questions,
		async run(input): Promise<StrategyResult> {
			questions.push(input.question);
			return { answer: name, trace: trace ?? [{ type: "answer", content: name }], metrics: { llmCalls: 2, latencyMs: 1 } };
		},
	};
}

function spies() {
	const react = spyStrategy("react");
	const planAndExecute = spyStrategy("plan-and-execute");
	const reflection = spyStrategy("reflection");
	const strategies: RouteStrategies = { react, "plan-and-execute": planAndExecute, reflection };
	return { react, planAndExecute, reflection, strategies };
}

function graphWith(deps: Partial<ProductionGraphDeps> & Pick<ProductionGraphDeps, "strategies">) {
	return createProductionGraph({ conversations: createMockConversationStore(), ...deps });
}

async function conversationWith(store: ConversationStore, count: number): Promise<string> {
	const { id } = await store.create();
	for (let i = 1; i <= count; i += 1) {
		await store.append(id, i % 2 === 1 ? "user" : "assistant", `m${i}`);
	}
	return id;
}

test("roteado: só a estratégia escolhida roda e o rastro abre com o evento route", async () => {
	const { react, planAndExecute, strategies } = spies();
	const router = createFakeRouter({ route: "plan-and-execute", reason: "vários passos" });

	const output = await graphWith({ strategies, router }).invoke({ message: "abra um incidente por alerta", facts: [] });

	assert.equal(output.answer, "plan-and-execute");
	assert.equal(planAndExecute.questions.length, 1);
	assert.equal(react.questions.length, 0);
	assert.deepEqual(output.route, { route: "plan-and-execute", reason: "vários passos", source: "router" });
	assert.deepEqual(output.trace, [
		{ type: "route", route: "plan-and-execute", reason: "vários passos", source: "router", node: "roteador" },
		{ type: "answer", content: "plan-and-execute", node: "plan-and-execute" },
	]);
	assert.equal(output.llmCalls, 3);
});

test("o roteador recebe o prompt montado e as rotas disponíveis na ordem da tabela", async () => {
	const { strategies } = spies();
	const router = createFakeRouter({ route: "react", reason: "direto" });

	const output = await graphWith({ strategies, router }).invoke({ message: "lista os alertas", facts: [] });

	assert.equal(router.calls.length, 1);
	assert.equal(router.calls[0]?.prompt, output.built.prompt);
	assert.ok(output.built.prompt.includes("lista os alertas"));
	assert.deepEqual(router.calls[0]?.routes, [...ROUTE_TABLE]);
});

test("a estratégia recebe o mesmo prompt que o buildContext monta (FR-002)", async () => {
	const { react, strategies } = spies();
	const conversations = createMockConversationStore();
	const conversationId = await conversationWith(conversations, 4);
	const facts = [{ fact: "cuida do checkout", score: 0.8 }];

	await graphWith({ strategies, conversations, router: createFakeRouter({ route: "react", reason: "x" }) }).invoke({
		message: "e agora?",
		conversationId,
		facts,
	});

	const history = (await conversations.messagesSince(conversationId, 0)).map(({ role, content }) => ({ role, content }));
	assert.equal(react.questions[0], buildContext({ question: "e agora?", facts, history }).prompt);
});

test("roteador que falha cai em react com source fallback e loga só o nome do erro", async (t) => {
	const warn = t.mock.method(console, "warn", () => {});
	const { react, strategies } = spies();

	const output = await graphWith({ strategies, router: createFakeRouter(new TypeError("conteúdo sensível")) }).invoke({
		message: "oi",
		facts: [],
	});

	assert.equal(react.questions.length, 1);
	assert.equal(output.route.source, "fallback");
	assert.equal(output.route.route, "react");
	assert.match(output.route.reason, /TypeError/);
	assert.equal(output.llmCalls, 3);
	assert.equal(warn.mock.callCount(), 1);
	assert.doesNotMatch(warn.mock.calls[0]?.arguments.join(" ") ?? "", /sensível/);
});

test("saída inválida do roteador cai em react com fallback", async (t) => {
	t.mock.method(console, "warn", () => {});
	const { strategies } = spies();

	const output = await graphWith({ strategies, router: createFakeRouter({ route: "foo", reason: "x" }) }).invoke({
		message: "oi",
		facts: [],
	});

	assert.deepEqual(
		{ route: output.route.route, source: output.route.source },
		{ route: "react", source: "fallback" },
	);
	assert.match(output.route.reason, /InvalidRouteDecisionError/);
});

test("rota indisponível no turno cai em react com fallback", async (t) => {
	t.mock.method(console, "warn", () => {});
	const react = spyStrategy("react");

	const output = await graphWith({
		strategies: { react },
		router: createFakeRouter({ route: "plan-and-execute", reason: "x" }),
	}).invoke({ message: "oi", facts: [] });

	assert.equal(output.route.source, "fallback");
	assert.equal(react.questions.length, 1);
});

test("sem router nas deps: fallback para react sem log e sem chamada ao modelo", async (t) => {
	const warn = t.mock.method(console, "warn", () => {});
	const { strategies } = spies();

	const output = await graphWith({ strategies }).invoke({ message: "oi", facts: [] });

	assert.deepEqual(output.route, { route: "react", reason: NO_ROUTER_REASON, source: "fallback" });
	assert.equal(output.llmCalls, 2);
	assert.equal(warn.mock.callCount(), 0);
});

test("turno que gera resumo: summarize (contexto) vem antes do route (roteador)", async () => {
	const { strategies } = spies();
	const conversations = createMockConversationStore();
	const conversationId = await conversationWith(conversations, 16);

	const output = await graphWith({
		strategies,
		conversations,
		summarizer: createFakeSummarizer(),
		router: createFakeRouter({ route: "react", reason: "x" }),
	}).invoke({ message: "oi", conversationId, facts: [] });

	assert.deepEqual(
		output.trace.map((event) => [event.type, event.node]),
		[
			["summarize", "contexto"],
			["route", "roteador"],
			["answer", "react"],
		],
	);
});

test("ConversationNotFoundError atravessa o grafo com a classe original", async () => {
	const { strategies } = spies();

	await assert.rejects(
		graphWith({ strategies }).invoke({ message: "oi", conversationId: "00000000-0000-4000-8000-000000000000", facts: [] }),
		ConversationNotFoundError,
	);
});

test("erro da estratégia propaga como é", async () => {
	const boom = new Error("boom");
	const failing: ReasoningStrategy = {
		name: "react",
		async run(): Promise<StrategyResult> {
			throw boom;
		},
	};

	await assert.rejects(graphWith({ strategies: { react: failing } }).invoke({ message: "oi", facts: [] }), (error) => error === boom);
});

test("override: o roteador não é chamado e o evento sai com source override", async () => {
	const { planAndExecute, strategies } = spies();
	const router = createFakeRouter({ route: "react", reason: "x" });

	const output = await graphWith({ strategies, router }).invoke({ message: "oi", facts: [], override: "plan-and-execute" });

	assert.equal(router.calls.length, 0);
	assert.equal(planAndExecute.questions.length, 1);
	assert.deepEqual(output.route, { route: "plan-and-execute", reason: OVERRIDE_REASON, source: "override" });
	assert.equal(output.llmCalls, 2);
});

test("override para reflection roda a estratégia reflection", async () => {
	const { reflection, strategies } = spies();

	const output = await graphWith({ strategies }).invoke({ message: "oi", facts: [], override: "reflection" });

	assert.equal(reflection.questions.length, 1);
	assert.equal(output.answer, "reflection");
});

test("tagTrace adiciona node sem mutar a entrada", () => {
	const trace = [{ type: "thought" as const, content: "x" }];

	const tagged = tagTrace(trace, "react");

	assert.deepEqual(tagged, [{ type: "thought", content: "x", node: "react" }]);
	assert.deepEqual(trace, [{ type: "thought", content: "x" }]);
});

test("rota reflection: todo evento tem node, inclusive a crítica, e nenhum sai do nó resposta", async () => {
	const react = spyStrategy("react", [
		{ type: "thought", content: "vou olhar" },
		{ type: "action", tool: "list_alerts", args: {} },
		{ type: "observation", content: "[]" },
		{ type: "answer", content: "nada disparando" },
	]);
	const strategies = routeStrategies(new Map([["react", react]]), { reflectionOptions: { critic: async () => ({ approved: true }) } });
	const conversations = createMockConversationStore();
	const conversationId = await conversationWith(conversations, 16);

	const output = await graphWith({
		strategies,
		conversations,
		summarizer: createFakeSummarizer(),
		router: createFakeRouter({ route: "reflection", reason: "diagnóstico" }),
	}).invoke({ message: "diagnostica", conversationId, facts: [] });

	assert.ok(output.trace.every((event) => typeof event.node === "string"));
	assert.equal(output.trace[0]?.node, "contexto");
	assert.equal(output.trace[1]?.node, "roteador");
	const strategyEvents = output.trace.slice(2);
	assert.deepEqual(
		strategyEvents.map((event) => event.type),
		["thought", "action", "observation", "answer", "critique"],
	);
	assert.ok(strategyEvents.every((event) => event.node === "reflection"));
	assert.ok(!output.trace.some((event) => event.node === "resposta"));
});

// --- Resiliência de modelo (specs/015) ---

const switchAB = { from: "a", to: "b", reason: "RateLimitError" };

/** Estratégia falsa que registra chamadas ao modelo como o `withResilience` faria. */
function recordingStrategy(name: string, calls: ModelCall[]): ReasoningStrategy {
	return {
		name,
		async run(): Promise<StrategyResult> {
			calls.forEach(recordModelCall);
			return { answer: name, trace: [{ type: "answer", content: name }], metrics: { llmCalls: calls.length, latencyMs: 1 } };
		},
	};
}

/** Roteador falso que registra chamadas ao modelo antes de decidir. */
function recordingRouter(calls: ModelCall[]): Router {
	return async () => {
		calls.forEach(recordModelCall);
		return { route: "react", reason: "direto" };
	};
}

test("sem troca de modelo: nenhum evento fallback e modelUsed da última chamada da estratégia", async () => {
	const { value: output } = await trackModelCalls(() =>
		graphWith({
			strategies: { react: recordingStrategy("react", [{ modelUsed: "a", switches: [] }, { modelUsed: "a2", switches: [] }]) },
		}).invoke({ message: "oi", facts: [] }),
	);

	assert.equal(output.modelUsed, "a2");
	assert.ok(output.trace.every((event) => event.type !== "fallback"));
});

test("troca na estratégia vira evento fallback com o node da rota, antes dos eventos dela", async () => {
	const { value: output } = await trackModelCalls(() =>
		graphWith({ strategies: { react: recordingStrategy("react", [{ modelUsed: "b", switches: [switchAB] }]) } }).invoke({
			message: "oi",
			facts: [],
		}),
	);

	assert.equal(output.modelUsed, "b");
	assert.deepEqual(
		output.trace.map((event) => [event.type, event.node]),
		[
			["route", "roteador"],
			["fallback", "react"],
			["answer", "react"],
		],
	);
	assert.deepEqual(output.trace[1], { type: "fallback", ...switchAB, node: "react" });
});

test("troca no roteador vira evento com node roteador, antes do route", async () => {
	const { value: output } = await trackModelCalls(() =>
		graphWith({
			strategies: { react: recordingStrategy("react", []) },
			router: recordingRouter([{ modelUsed: "b", switches: [switchAB] }]),
		}).invoke({ message: "oi", facts: [] }),
	);

	assert.deepEqual(
		output.trace.slice(0, 2).map((event) => [event.type, event.node]),
		[
			["fallback", "roteador"],
			["route", "roteador"],
		],
	);
});

test("a mesma troca no roteador e na estratégia aparece uma vez só (a primeira)", async () => {
	const { value: output } = await trackModelCalls(() =>
		graphWith({
			strategies: { react: recordingStrategy("react", [{ modelUsed: "b", switches: [switchAB] }]) },
			router: recordingRouter([{ modelUsed: "b", switches: [switchAB] }]),
		}).invoke({ message: "oi", facts: [] }),
	);

	const fallbacks = output.trace.filter((event) => event.type === "fallback");
	assert.equal(fallbacks.length, 1);
	assert.equal(fallbacks[0]?.node, "roteador");
});

test("estratégia que não chamou o modelo deixa modelUsed null", async () => {
	const { value: output } = await trackModelCalls(() =>
		graphWith({ strategies: { react: recordingStrategy("react", []) } }).invoke({ message: "oi", facts: [] }),
	);

	assert.equal(output.modelUsed, null);
});

test("fallbackEvents e dedupeFallbacks são puros", () => {
	const switchBC = { from: "b", to: "c", reason: "TimeoutError" };
	assert.deepEqual(fallbackEvents([{ modelUsed: "c", switches: [switchAB, switchBC] }, { modelUsed: "a", switches: [] }]), [
		{ type: "fallback", ...switchAB },
		{ type: "fallback", ...switchBC },
	]);

	const trace = [
		{ type: "fallback" as const, ...switchAB, node: "roteador" as const },
		{ type: "answer" as const, content: "x", node: "react" as const },
		{ type: "fallback" as const, ...switchAB, reason: "Outro", node: "react" as const },
		{ type: "fallback" as const, ...switchBC, node: "react" as const },
	];
	assert.deepEqual(
		dedupeFallbacks(trace).map((event) => [event.type, event.node]),
		[
			["fallback", "roteador"],
			["answer", "react"],
			["fallback", "react"],
		],
	);
	assert.equal(trace.length, 4);
});

// --- Aprovação (specs/018) ---

function gatedResolve() {
	const executed: unknown[] = [];
	const resolve = withApprovalGate(
		tool(
			async (input) => {
				executed.push(input);
				return "resolvido";
			},
			{ name: "resolve_incident", description: "resolve", schema: z.object({ id: z.number() }) },
		),
	);
	return { resolve, executed };
}

/** Estratégia que chama a tool sensível e segue produzindo eventos depois dela. */
function toolCallingStrategy(name: string, callTool: () => Promise<unknown>): SpyStrategy {
	const questions: string[] = [];
	return {
		name,
		questions,
		async run(input): Promise<StrategyResult> {
			questions.push(input.question);
			const observation = String(await callTool());
			return {
				answer: "a ação depende de aprovação",
				trace: [
					{ type: "action", tool: "resolve_incident", args: { id: 3 } },
					{ type: "observation", content: observation },
					{ type: "answer", content: "a ação depende de aprovação" },
				],
				metrics: { llmCalls: 2, latencyMs: 1 },
			};
		},
	};
}

test("ação sensível pausa: rastro ganha o evento approval depois do action e perde o resto", async () => {
	const { resolve, executed } = gatedResolve();
	const react = toolCallingStrategy("react", () => resolve.invoke({ id: 3 }));
	const { strategies } = spies();

	const { value: output, pending } = await trackApprovals(
		() => graphWith({ strategies: { ...strategies, react } }).invoke({ message: "resolva o 3", facts: [] }),
		{ newId: () => "ap-1" },
	);

	assert.equal(executed.length, 0);
	assert.deepEqual(pending, { id: "ap-1", tool: "resolve_incident", args: { id: 3 } });
	assert.deepEqual(output.pending, pending);
	assert.deepEqual(output.trace.slice(-2), [
		{ type: "action", tool: "resolve_incident", args: { id: 3 }, node: "react" },
		{ type: "approval", approvalId: "ap-1", tool: "resolve_incident", args: { id: 3 }, summary: "Resolver o incidente #3", node: "react" },
	]);
});

test("retomada: rota guardada com source resume, sem chamar o roteador; decisão abre o rastro e entra no prompt", async () => {
	const { react, strategies } = spies();
	const router = createFakeRouter({ route: "plan-and-execute", reason: "x" });
	const decisions = "Decisões do plantonista neste turno:\n- Resolver o incidente #3: negada, não executada";

	const output = await graphWith({ strategies, router }).invoke({
		message: "resolva o 3",
		facts: [],
		resume: { route: "react" },
		decisions,
		leading: [{ type: "decision", approvalId: "ap-1", decision: "denied" }],
	});

	assert.equal(router.calls.length, 0);
	assert.deepEqual(output.route, { route: "react", reason: RESUME_REASON, source: "resume" });
	assert.deepEqual(output.trace.slice(0, 2), [
		{ type: "decision", approvalId: "ap-1", decision: "denied", node: "contexto" },
		{ type: "route", route: "react", reason: RESUME_REASON, source: "resume", node: "roteador" },
	]);
	assert.ok(react.questions[0]?.endsWith(`${decisions}\n\nresolva o 3`));
	assert.equal(output.pending, undefined);
});

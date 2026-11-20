/**
 * Grafo unificado de produção (specs/014, contracts/production-graph.md): todo
 * turno do `/chat` passa por contexto → roteador → estratégia → resposta.
 *
 * - `contexto`: resumo + janela (specs/012) e orçamento por seção (specs/013);
 *   o prompt das estratégias é o mesmo de antes (FR-002).
 * - `roteador`: override da requisição, decisão estruturada do LLM ou
 *   fallback para `react` — nunca derruba o turno (FR-009).
 * - `react` / `plan-and-execute` / `reflection`: a estratégia da rota.
 * - `resposta`: consolida resposta, rastro e métricas; não emite eventos.
 *
 * Todo evento do rastro sai com `node` = nó que o produziu (FR-010). Os nós
 * não podem ter o nome de um canal do estado (research.md §2).
 *
 * Resiliência de modelo (specs/015, research.md §5): cada nó converte as
 * trocas de modelo das chamadas feitas nele em eventos `fallback`, no início
 * dos seus eventos; o nó de estratégia define `modelUsed`; `resposta` remove
 * as trocas repetidas pelo par origem → destino.
 */
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import {
	InvalidRouteDecisionError,
	logRouteFailure,
	parseRouteDecision,
	ROUTES,
	type Route,
	type RouteDecision,
	type RouteEvent,
	type Router,
} from "../agents/router.js";
import { availableRoutes, type RouteStrategies } from "../agents/routes.js";
import { modelCallCount, modelCallsSince, type ModelCall } from "../agents/model-calls.js";
import type { FallbackEvent } from "../agents/resilience.js";
import type { StrategyResult, TraceEvent } from "../agents/strategy.js";
import { logSummaryFailure, type Summarizer } from "../agents/summarizer.js";
import { buildContext, type BudgetFact, type BuiltContext, type ContextBudget } from "../context/context-builder.js";
import { loadConversationContext, type ConversationContext } from "../services/history-service.js";
import { insertApprovalEvent, type PendingCall } from "../agents/approvals.js";
import { currentPendingCall } from "../agents/approval-gate.js";
import type { ConversationStore } from "../store/conversation-store.js";

export type NodeName = "contexto" | "roteador" | Route | "resposta";

export type { FallbackEvent } from "../agents/resilience.js";

export type GraphTraceEvent = (TraceEvent | RouteEvent | FallbackEvent) & { node: NodeName };

export type GraphTrace = readonly GraphTraceEvent[];

/** Função pura: marca os eventos com o nó que os produziu, sem mutar a entrada. */
export function tagTrace(trace: readonly (TraceEvent | RouteEvent | FallbackEvent)[], node: NodeName): GraphTraceEvent[] {
	return trace.map((event) => ({ ...event, node }));
}

/** Função pura: um evento `fallback` por troca de modelo, na ordem das chamadas. */
export function fallbackEvents(calls: readonly ModelCall[]): FallbackEvent[] {
	return calls.flatMap((call) => call.switches.map((change) => ({ type: "fallback" as const, ...change })));
}

/** Função pura: mantém só o primeiro evento `fallback` de cada par origem → destino (FR-008). */
export function dedupeFallbacks(trace: readonly GraphTraceEvent[]): GraphTraceEvent[] {
	const seen = new Set<string>();
	return trace.filter((event) => {
		if (event.type !== "fallback") {
			return true;
		}
		const pair = `${event.from} → ${event.to}`;
		if (seen.has(pair)) {
			return false;
		}
		seen.add(pair);
		return true;
	});
}

/** Roda `fn` e devolve também os eventos `fallback` das chamadas ao modelo feitas nela. */
async function observeModelCalls<T>(node: NodeName, fn: () => Promise<T>): Promise<{ value: T; calls: ModelCall[]; fallbacks: GraphTraceEvent[] }> {
	const mark = modelCallCount();
	const value = await fn();
	const calls = modelCallsSince(mark);
	return { value, calls, fallbacks: tagTrace(fallbackEvents(calls), node) };
}

export interface ProductionGraphDeps {
	strategies: RouteStrategies;
	/** Ausente → toda decisão é fallback para `react`, sem chamada ao modelo. */
	router?: Router;
	conversations: ConversationStore;
	summarizer?: Summarizer;
	budget?: ContextBudget;
}

export interface ProductionInput {
	message: string;
	conversationId?: string;
	facts: BudgetFact[];
	/** `strategy` da requisição (specs/014, US2): o roteador não chama o modelo. */
	override?: Route;
	/** Turno retomado depois de uma decisão (specs/018): rota guardada, `source: "resume"`. */
	resume?: { route: Route };
	/** Seção de decisões do plantonista para o prompt (`ledgerPromptSection`). */
	decisions?: string;
	/** Eventos que abrem o rastro, no nó `contexto` (o `decision` da retomada). */
	leading?: TraceEvent[];
}

export interface ProductionOutput {
	answer: string;
	trace: GraphTraceEvent[];
	llmCalls: number;
	latencyMs: number;
	built: BuiltContext;
	route: RouteDecision;
	/** Modelo da última chamada da estratégia (specs/015); `null` se ela não chamou o modelo. */
	modelUsed: string | null;
	/** Ação sensível que pausou o turno (specs/018); a resposta deste turno não vale. */
	pending?: PendingCall;
}

export const OVERRIDE_REASON = "Estratégia definida na requisição.";
export const NO_ROUTER_REASON = "Roteador não configurado; seguindo com react.";
export const RESUME_REASON = "Retomada após a decisão do plantonista, na rota do turno pausado.";

const fallback = (reason: string): RouteDecision => ({ route: "react", reason, source: "fallback" });

const errorName = (error: unknown): string => (error instanceof Error ? error.name : typeof error);

const ProductionState = Annotation.Root({
	input: Annotation<ProductionInput>(),
	prepared: Annotation<BuiltContext>(),
	decision: Annotation<RouteDecision>(),
	result: Annotation<StrategyResult>(),
	modelUsed: Annotation<string | null>(),
	pending: Annotation<PendingCall | undefined>(),
	trace: Annotation<GraphTraceEvent[]>({ reducer: (current, update) => current.concat(update), default: () => [] }),
	llmCalls: Annotation<number>({ reducer: (current, update) => current + update, default: () => 0 }),
	final: Annotation<ProductionOutput>(),
});

type ProductionStateType = typeof ProductionState.State;

export function createProductionGraph(deps: ProductionGraphDeps): { invoke(input: ProductionInput): Promise<ProductionOutput> } {
	const { strategies, router, conversations } = deps;
	const routes = availableRoutes(strategies);

	async function contexto(state: ProductionStateType) {
		const { message, conversationId, facts, decisions, leading = [] } = state.input;
		const { value: context, fallbacks } = await observeModelCalls(
			"contexto",
			async (): Promise<ConversationContext> =>
				conversationId
					? loadConversationContext(conversationId, { conversations, summarizer: deps.summarizer, log: logSummaryFailure })
					: { recent: [] },
		);
		const built = buildContext({ question: message, facts, summary: context.summary, history: context.recent, decisions }, deps.budget);
		return {
			prepared: built,
			trace: [...tagTrace(leading, "contexto"), ...fallbacks, ...(context.event ? tagTrace([context.event], "contexto") : [])],
		};
	}

	async function decide(override: Route | undefined, prompt: string, resume?: { route: Route }): Promise<{ decision: RouteDecision; llmCalls: number }> {
		if (resume) {
			if (!strategies[resume.route]) {
				throw new Error(`Rota indisponível: ${resume.route}`);
			}
			return { decision: { route: resume.route, reason: RESUME_REASON, source: "resume" }, llmCalls: 0 };
		}
		if (override) {
			if (!strategies[override]) {
				throw new Error(`Rota indisponível: ${override}`);
			}
			return { decision: { route: override, reason: OVERRIDE_REASON, source: "override" }, llmCalls: 0 };
		}
		if (!router) {
			return { decision: fallback(NO_ROUTER_REASON), llmCalls: 0 };
		}

		let failure: unknown;
		try {
			const parsed = parseRouteDecision(await router({ prompt, routes }), routes);
			if (parsed) {
				return { decision: { ...parsed, source: "router" }, llmCalls: 1 };
			}
			failure = new InvalidRouteDecisionError();
		} catch (error) {
			failure = error;
		}
		logRouteFailure(failure);
		return { decision: fallback(`Roteador indisponível (${errorName(failure)}); seguindo com react.`), llmCalls: 1 };
	}

	async function roteador(state: ProductionStateType) {
		const { value, fallbacks } = await observeModelCalls("roteador", () => decide(state.input.override, state.prepared.prompt, state.input.resume));
		const { decision, llmCalls } = value;
		const event: RouteEvent = { type: "route", ...decision };
		return { decision, llmCalls, trace: [...fallbacks, ...tagTrace([event], "roteador")] };
	}

	function strategyNode(route: Route) {
		return async (state: ProductionStateType) => {
			const strategy = strategies[route];
			if (!strategy) {
				throw new Error(`Estratégia ausente para a rota ${route}`);
			}
			const { value: result, calls, fallbacks } = await observeModelCalls(route, () =>
				strategy.run({ question: state.prepared.prompt }),
			);
			// Ação sensível interceptada (specs/018): o rastro termina no evento approval.
			const pending = currentPendingCall();
			const trace = pending ? insertApprovalEvent(result.trace, pending) : result.trace;
			return {
				result,
				pending,
				llmCalls: result.metrics.llmCalls,
				modelUsed: calls.at(-1)?.modelUsed ?? null,
				trace: [...fallbacks, ...tagTrace(trace, route)],
			};
		};
	}

	function resposta(state: ProductionStateType) {
		const final: ProductionOutput = {
			answer: state.result.answer,
			trace: dedupeFallbacks(state.trace),
			llmCalls: state.llmCalls,
			latencyMs: state.result.metrics.latencyMs,
			built: state.prepared,
			route: state.decision,
			modelUsed: state.modelUsed ?? null,
			...(state.pending ? { pending: state.pending } : {}),
		};
		return { final };
	}

	const graph = new StateGraph(ProductionState)
		.addNode("contexto", contexto)
		.addNode("roteador", roteador)
		.addNode("react", strategyNode("react"))
		.addNode("plan-and-execute", strategyNode("plan-and-execute"))
		.addNode("reflection", strategyNode("reflection"))
		.addNode("resposta", resposta)
		.addEdge(START, "contexto")
		.addEdge("contexto", "roteador")
		.addConditionalEdges("roteador", (state) => state.decision.route, [...ROUTES])
		.addEdge("react", "resposta")
		.addEdge("plan-and-execute", "resposta")
		.addEdge("reflection", "resposta")
		.addEdge("resposta", END)
		.compile();

	return {
		async invoke(input) {
			const state = await graph.invoke({ input });
			return state.final;
		},
	};
}

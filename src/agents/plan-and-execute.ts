import { Annotation, END, GraphRecursionError, START, StateGraph } from "@langchain/langgraph";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { createModel } from "./model.js";
import {
	DEFAULT_MAX_ITERATIONS,
	type ReasoningStrategy,
	type StrategyResult,
	type TraceEvent,
} from "./strategy.js";

/** Teto rígido de passos do Plan-and-Execute (FR-012). */
export const MAX_STEPS = 8;

/**
 * Regra pura de corte: nunca continua além de MAX_STEPS passos executados,
 * mesmo que o replanejador decida "ajustar"/"seguir" (checagem estrutural do
 * grafo, não apenas instrução de prompt — research.md §2).
 */
export function shouldContinue(stepsExecuted: number, remainingSteps: readonly string[]): boolean {
	if (stepsExecuted >= MAX_STEPS) {
		return false;
	}
	return remainingSteps.length > 0;
}

const PLANNER_PROMPT =
	"Você é o planejador do OpsPilot, um copiloto de plantão. Dada a pergunta do " +
	"plantonista, produza uma lista curta e ordenada de passos, executáveis com as " +
	"ferramentas disponíveis (list_alerts, open_incident, resolve_incident), para " +
	"responder à pergunta.";

const EXECUTOR_PROMPT =
	"Você é o executor do OpsPilot. Execute apenas o passo atual do plano, usando uma " +
	"ferramenta quando necessário, e relate o resultado desse passo.";

const REPLANNER_PROMPT =
	"Você é o replanejador do OpsPilot. Avalie os passos já concluídos e o plano " +
	'restante, e decida uma entre três ações: "ajustar" o plano (retorne a lista ' +
	'atualizada de passos em "plan"), "seguir" com o plano atual sem mudanças, ou ' +
	'"encerrar" com a resposta final em "answer" quando não restar mais trabalho.';

const planSchema = z.object({
	steps: z.array(z.string()).describe("Passos curtos, ordenados, executáveis com as ferramentas disponíveis"),
});

const replanSchema = z.object({
	decision: z.enum(["ajustar", "seguir", "encerrar"]),
	plan: z.array(z.string()).optional(),
	answer: z.string().optional(),
});

/** Estado do grafo (nomes conforme referência: input/plan/done/answer). */
const PEState = Annotation.Root({
	input: Annotation<string>(),
	plan: Annotation<string[]>({ reducer: (_current, update) => update, default: () => [] }),
	done: Annotation<[string, string][]>({
		reducer: (current, update) => current.concat(update),
		default: () => [],
	}),
	answer: Annotation<string | undefined>({ reducer: (_current, update) => update, default: () => undefined }),
	// Campos extras para satisfazer o contrato ReasoningStrategy (trace + metrics).
	trace: Annotation<TraceEvent[]>({ reducer: (current, update) => current.concat(update), default: () => [] }),
	llmCalls: Annotation<number>({ reducer: (current, update) => current + update, default: () => 0 }),
});

type PEStateType = typeof PEState.State;

export interface PlanAndExecuteOptions {
	/**
	 * Quando `false`, o nó replanner nunca chama o LLM: apenas segue o plano
	 * original passo a passo até esgotar ou atingir o teto, sem revisar nada
	 * no meio do caminho. Usado por `src/bench.ts` (flag `--no-replanner`)
	 * para comparar o valor de replanejar contra um baseline "burro".
	 * Default: `true`.
	 */
	useReplanner?: boolean;
}

/** Sintetiza uma resposta final a partir dos passos já executados, sem LLM (modo sem replanner). */
function synthesizeAnswer(done: readonly [string, string][]): string {
	if (done.length === 0) {
		return "Nenhum passo foi executado.";
	}
	return done.map(([step, result]) => `${step}: ${result}`).join("\n");
}

/** Estratégia Plan-and-Execute (FR-011/FR-012): grafo planner → executor → replanner. */
export function createPlanAndExecuteStrategy(
	tools: StructuredToolInterface[],
	opts: PlanAndExecuteOptions = {},
): ReasoningStrategy {
	const useReplanner = opts.useReplanner ?? true;
	const toolByName = new Map(tools.map((toolInstance) => [toolInstance.name, toolInstance]));

	async function planner(state: PEStateType): Promise<Partial<PEStateType>> {
		const plan = await createModel((model) => model.withStructuredOutput(planSchema))
			.invoke([
				["system", PLANNER_PROMPT],
				["user", state.input],
			]);

		return {
			plan: plan.steps,
			trace: [{ type: "plan", steps: plan.steps }],
			llmCalls: 1,
		};
	}

	/** Executor resolve o passo atual com as tools e empurra [passo, resultado] para `done`. */
	async function executor(state: PEStateType): Promise<Partial<PEStateType>> {
		const [step, ...rest] = state.plan;
		if (step === undefined) {
			return {};
		}

		const model = createModel((chat) => chat.bindTools(tools));
		const aiMessage = await model.invoke([
			["system", EXECUTOR_PROMPT],
			["user", `Pergunta original: ${state.input}\nPasso atual: ${step}`],
		]);

		const events: TraceEvent[] = [];
		const text = typeof aiMessage.content === "string" ? aiMessage.content : JSON.stringify(aiMessage.content);
		if (text.trim().length > 0) {
			events.push({ type: "thought", content: text });
		}

		let result = text.trim().length > 0 ? text : "(sem resultado)";
		for (const call of aiMessage.tool_calls ?? []) {
			events.push({ type: "action", tool: call.name, args: call.args });
			const toolInstance = toolByName.get(call.name);
			result = toolInstance
				? String(await toolInstance.invoke(call.args as never))
				: `Ferramenta desconhecida: ${call.name}`;
			events.push({ type: "observation", content: result });
		}

		return {
			plan: rest,
			done: [[step, result]],
			trace: events,
			llmCalls: 1,
		};
	}

	/** Replanner decide: ajustar o plano, seguir sem mudanças, ou encerrar com resposta final. */
	async function replanner(state: PEStateType): Promise<Partial<PEStateType>> {
		if (!useReplanner) {
			// Sem replanner: nenhuma chamada de LLM aqui — só encerra quando o
			// plano original acaba ou o teto de passos é atingido (route() abaixo
			// decide isso mesmo sem `answer` definido); ao encerrar, sintetiza a
			// resposta a partir dos passos já executados.
			if (!shouldContinue(state.done.length, state.plan)) {
				const answer = synthesizeAnswer(state.done);
				return {
					answer,
					trace: [
						{ type: "critique", content: "Sem replanner: plano concluído ou teto de passos atingido." },
						{ type: "answer", content: answer },
					],
				};
			}
			return {};
		}

		const summary = state.done.map(([step, result]) => `- ${step} -> ${result}`).join("\n") || "(nenhum)";

		const result = await createModel((model) => model.withStructuredOutput(replanSchema))
			.invoke([
				["system", REPLANNER_PROMPT],
				[
					"user",
					`Pergunta original: ${state.input}\n` +
						`Passos concluídos:\n${summary}\n` +
						`Plano restante: ${state.plan.join("; ") || "(nenhum)"}`,
				],
			]);

		if (result.decision === "encerrar") {
			const answer = result.answer ?? "";
			return {
				plan: [],
				answer,
				trace: [
					{ type: "critique", content: "Replanejador decidiu encerrar: não resta mais trabalho." },
					{ type: "answer", content: answer },
				],
				llmCalls: 1,
			};
		}

		if (result.decision === "ajustar") {
			const adjustedPlan = result.plan ?? state.plan;
			return {
				plan: adjustedPlan,
				trace: [{ type: "critique", content: `Replanejador ajustou o plano: ${adjustedPlan.join("; ")}` }],
				llmCalls: 1,
			};
		}

		return {
			trace: [{ type: "critique", content: "Replanejador decidiu seguir com o plano atual." }],
			llmCalls: 1,
		};
	}

	function route(state: PEStateType): "executor" | typeof END {
		if (state.answer !== undefined) {
			return END;
		}
		return shouldContinue(state.done.length, state.plan) ? "executor" : END;
	}

	const graph = new StateGraph(PEState)
		.addNode("planner", planner)
		.addNode("executor", executor)
		.addNode("replanner", replanner)
		.addEdge(START, "planner")
		.addEdge("planner", "executor")
		.addEdge("executor", "replanner")
		.addConditionalEdges("replanner", route, { executor: "executor", [END]: END })
		.compile();

	return {
		name: "plan-and-execute",
		async run(input): Promise<StrategyResult> {
			const started = Date.now();
			const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS;

			let finalState: PEStateType = {
				input: input.question,
				plan: [],
				done: [],
				answer: undefined,
				trace: [],
				llmCalls: 0,
			};

			try {
				finalState = (await graph.invoke(
					{ input: input.question },
					{ recursionLimit: Math.max(maxIterations * 3, 10) },
				)) as PEStateType;
			} catch (error) {
				if (!(error instanceof GraphRecursionError)) {
					throw error;
				}
			}

			const answer = finalState.answer ?? "Limite de passos atingido antes de uma resposta final.";

			return {
				answer,
				trace: finalState.trace,
				metrics: { llmCalls: finalState.llmCalls, latencyMs: Date.now() - started },
			};
		},
	};
}

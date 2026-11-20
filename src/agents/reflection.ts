import { z } from "zod";
import { createModel } from "./model.js";
import type { ReasoningStrategy, StrategyInput, StrategyResult, Trace, TraceEvent } from "./strategy.js";

/** Default de rodadas de crítica quando `maxReflection` não é informado (research.md §3). */
export const DEFAULT_MAX_REFLECTION = 2;

export interface CriticVerdict {
	approved: boolean;
	feedback?: string;
}

export type Critic = (input: {
	question: string;
	answer: string;
	observations: string[];
}) => Promise<CriticVerdict>;

export interface ReflectionOptions {
	maxReflection?: number;
	/** Injetável — usado pelos testes para substituir o crítico real por um dublê (research.md §1). */
	critic?: Critic;
}

const verdictSchema = z.object({
	approved: z.boolean(),
	feedback: z.string().optional().describe("Se reprovado: o que corrigir, de forma específica e acionável"),
});

const CRITIC_PROMPT =
	"Você é o crítico do OpsPilot. Avalie a resposta APENAS contra as observações do " +
	"rastro e o pedido original — nunca contra conhecimento externo. Aprove quando a " +
	"resposta for sustentada pelo que foi observado; caso contrário, reprove e explique, " +
	"de forma específica e acionável, o que precisa ser corrigido.";

/** Extrai o conteúdo dos eventos de observação do rastro, em ordem (research.md §5). */
function observationsOf(trace: Trace): string[] {
	return trace
		.filter((event): event is Extract<TraceEvent, { type: "observation" }> => event.type === "observation")
		.map((event) => event.content);
}

/** Crítico padrão: mesmo modelo do núcleo de raciocínio, saída estruturada (FR-003). */
const defaultCritic: Critic = async ({ question, answer, observations }) => {
	return createModel((model) => model.withStructuredOutput(verdictSchema))
		.invoke([
			["system", CRITIC_PROMPT],
			[
				"user",
				`Pedido: ${question}\nObservações: ${observations.join("; ") || "(nenhuma)"}\nResposta: ${answer}`,
			],
		]);
};

function retryQuestion(originalQuestion: string, previousAnswer: string, feedback: string | undefined): string {
	return (
		`Pedido original: ${originalQuestion}\n` +
		`Sua resposta anterior foi: ${previousAnswer}\n` +
		`Ela foi reprovada pelo crítico. Feedback: ${feedback ?? "(sem detalhes)"}\n` +
		"Produza uma nova resposta que resolva essa crítica."
	);
}

/**
 * Decorador de reflexão (FR-001 a FR-010): envolve qualquer `ReasoningStrategy` com
 * um ciclo gerar → criticar → (se reprovado) regenerar, até aprovar ou atingir
 * `maxReflection` rodadas (padrão 2). Ver contracts/reflection.md.
 */
export function withReflection(strategy: ReasoningStrategy, opts: ReflectionOptions = {}): ReasoningStrategy {
	const maxReflection = opts.maxReflection ?? DEFAULT_MAX_REFLECTION;
	const critic = opts.critic ?? defaultCritic;

	return {
		name: `reflect:${strategy.name}`,
		async run(input: StrategyInput): Promise<StrategyResult> {
			const started = Date.now();
			let trace: TraceEvent[] = [];
			let llmCalls = 0;
			let currentInput = input;
			let result: StrategyResult;
			let round = 0;

			for (;;) {
				result = await strategy.run(currentInput);
				trace = trace.concat(result.trace);
				llmCalls += result.metrics.llmCalls;

				// Teto de rodadas: nunca critica além de `maxReflection` (research.md §3).
				if (round >= maxReflection) {
					break;
				}

				let verdict: CriticVerdict;
				try {
					verdict = await critic({
						question: input.question,
						answer: result.answer,
						observations: observationsOf(result.trace),
					});
				} catch (error) {
					// Falha do próprio crítico nunca propaga (research.md §4) — encerra
					// com a última resposta válida, registrando a falha no rastro.
					trace = trace.concat([
						{
							type: "critique",
							content: `Falha ao avaliar a resposta: ${error instanceof Error ? error.message : String(error)}`,
						},
					]);
					break;
				}
				llmCalls += 1;

				trace = trace.concat([
					{
						type: "critique",
						content: verdict.approved
							? "Aprovado pelo crítico."
							: `Reprovado pelo crítico: ${verdict.feedback ?? "(sem detalhes)"}`,
					},
				]);

				if (verdict.approved) {
					break;
				}

				round += 1;
				currentInput = {
					...input,
					question: retryQuestion(input.question, result.answer, verdict.feedback),
				};
			}

			return {
				answer: result.answer,
				trace,
				metrics: { llmCalls, latencyMs: Date.now() - started },
			};
		},
	};
}

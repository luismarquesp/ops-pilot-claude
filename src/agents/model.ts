import { ChatOpenAI } from "@langchain/openai";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import type { AIMessageChunk } from "@langchain/core/messages";
import type { Runnable } from "@langchain/core/runnables";
import { usageCallbacks } from "../context/usage-tracker.js";
import { withResilience } from "./resilience.js";

export { MODEL_ATTEMPTS } from "./resilience.js";

/** Modelo principal + reservas, na ordem em que são tentados (specs/015, data-model.md). */
export interface ModelChain {
	primary: string;
	fallbacks: string[];
}

/**
 * Função pura (specs/015, FR-004): `OPEN_ROUTER_MODEL` é o principal;
 * `OPENROUTER_MODEL_FALLBACK` traz as reservas separadas por vírgula — com trim,
 * sem vazios, sem repetidos e sem o próprio principal.
 */
export function parseModelChain(env: Readonly<Record<string, string | undefined>>): ModelChain {
	const primary = env.OPEN_ROUTER_MODEL ?? "";
	const fallbacks = (env.OPENROUTER_MODEL_FALLBACK ?? "")
		.split(",")
		.map((id) => id.trim())
		.filter((id) => id.length > 0 && id !== primary);
	return { primary, fallbacks: [...new Set(fallbacks)] };
}

/**
 * Um modelo da cadeia: OpenRouter, temperatura 0, sem retry interno do cliente
 * (`maxRetries: 0`) — quem reinsiste é o `withRetry` da resiliência (research.md §3).
 *
 * Criado dentro de `trackUsage` (specs/011), soma o uso real de cada chamada
 * no turno corrente; criado fora do escopo do turno, não é contado.
 */
export function createChatModel(id: string): ChatOpenAI {
	return new ChatOpenAI({
		model: id,
		apiKey: process.env.OPENROUTER_API_KEY ?? "",
		configuration: { baseURL: "https://openrouter.ai/api/v1" },
		temperature: 0,
		maxRetries: 0,
		callbacks: usageCallbacks(),
	});
}

/**
 * Fábrica única do modelo de linguagem (FR-005; specs/015): `build` compõe cada
 * modelo da cadeia (`withStructuredOutput`, `bindTools`…) antes da resiliência —
 * principal e reservas com o mesmo esquema e as mesmas tools. Cada modelo tem
 * `MODEL_ATTEMPTS` tentativas; esgotada a cadeia, `ModelUnavailableError`.
 */
export function createModel<O = AIMessageChunk>(
	build: (model: ChatOpenAI) => Runnable<BaseLanguageModelInput, O> = (model) => model as unknown as Runnable<BaseLanguageModelInput, O>,
	chain: ModelChain = parseModelChain(process.env),
): Runnable<BaseLanguageModelInput, O> {
	return withResilience(
		[chain.primary, ...chain.fallbacks].map((id) => ({ id, runnable: build(createChatModel(id)) })),
	);
}

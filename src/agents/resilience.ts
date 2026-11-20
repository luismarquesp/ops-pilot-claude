/**
 * Política de resiliência das chamadas ao modelo (specs/015, research.md §1–§4,
 * contracts/model-factory.md): cada modelo da cadeia roda com `withRetry`
 * (`MODEL_ATTEMPTS` tentativas) e as reservas entram, na ordem, via
 * `withFallbacks`. Cada modelo é envolvido por `track`, que anota as tentativas
 * num escopo próprio da chamada; daí saem `modelUsed`, as trocas e, se nada
 * responder, o `ModelUnavailableError`.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { RunnableLambda, type Runnable, type RunnableConfig } from "@langchain/core/runnables";
import { recordModelCall, type ModelSwitch } from "./model-calls.js";
import { ModelUnavailableError } from "../services/errors.js";

export type { ModelSwitch } from "./model-calls.js";

/** Tentativas por modelo, principal e cada reserva (decisão de 2026-10-21). */
export const MODEL_ATTEMPTS = 2;

export interface ModelAttempt {
	model: string;
	ok: boolean;
	/** Só o nome do erro — a mensagem do provedor pode ecoar o pedido (FR-012). */
	error?: string;
}

export interface ModelCallOutcome {
	modelUsed: string | null;
	switches: ModelSwitch[];
	modelsTried: string[];
}

/** Evento do rastro quando uma chamada troca de modelo (FR-008). */
export type FallbackEvent = { type: "fallback" } & ModelSwitch;

export interface ResilienceEntry<I, O> {
	id: string;
	runnable: Runnable<I, O>;
}

const errorName = (error: unknown): string => (error instanceof Error ? error.name : typeof error);

/** Função pura: resume as tentativas de uma chamada, na ordem em que aconteceram. */
export function summarizeAttempts(attempts: readonly ModelAttempt[]): ModelCallOutcome {
	const switches: ModelSwitch[] = [];
	for (let index = 1; index < attempts.length; index += 1) {
		const previous = attempts[index - 1];
		const current = attempts[index];
		if (previous && current && current.model !== previous.model) {
			switches.push({ from: previous.model, to: current.model, reason: previous.error ?? "Error" });
		}
	}
	return {
		modelUsed: attempts.find((attempt) => attempt.ok)?.model ?? null,
		switches,
		modelsTried: [...new Set(attempts.map((attempt) => attempt.model))],
	};
}

/** Loga a troca só com ids e o nome do erro (FR-012). */
export function logModelFallback(change: ModelSwitch): void {
	console.warn("[model] fallback", change.from, "→", `${change.to}:`, change.reason);
}

/** Tentativas da chamada corrente — um escopo por `invoke` do runnable resiliente. */
const attemptsScope = new AsyncLocalStorage<ModelAttempt[]>();

function track<I, O>(id: string, runnable: Runnable<I, O>): Runnable<I, O> {
	return RunnableLambda.from(async (input: I, config?: RunnableConfig): Promise<O> => {
		try {
			const output = await runnable.invoke(input, config);
			attemptsScope.getStore()?.push({ model: id, ok: true });
			return output;
		} catch (error) {
			attemptsScope.getStore()?.push({ model: id, ok: false, error: errorName(error) });
			throw error;
		}
	}) as unknown as Runnable<I, O>;
}

/**
 * Cadeia resiliente: `entries[0]` é o principal, o resto são reservas na ordem.
 * Sucesso → registra `{ modelUsed, switches }` no turno (fora de escopo, nada).
 * Todos falharam → `ModelUnavailableError` com os modelos tentados.
 */
export function withResilience<I, O>(
	entries: ReadonlyArray<ResilienceEntry<I, O>>,
	opts: { attempts?: number } = {},
): Runnable<I, O> {
	const attempts = opts.attempts ?? MODEL_ATTEMPTS;
	const [primary, ...reserves] = entries.map(({ id, runnable }) => track(id, runnable).withRetry({ stopAfterAttempt: attempts }));
	if (!primary) {
		throw new Error("withResilience exige ao menos um modelo");
	}
	const chain = reserves.length > 0 ? primary.withFallbacks({ fallbacks: reserves }) : primary;

	return RunnableLambda.from(async (input: I, config?: RunnableConfig): Promise<O> => {
		const tried: ModelAttempt[] = [];
		try {
			const output = await attemptsScope.run(tried, () => chain.invoke(input, config));
			const outcome = summarizeAttempts(tried);
			outcome.switches.forEach(logModelFallback);
			recordModelCall({ modelUsed: outcome.modelUsed, switches: outcome.switches });
			return output;
		} catch (error) {
			const outcome = summarizeAttempts(tried);
			if (tried.length > 0 && outcome.modelUsed === null) {
				throw new ModelUnavailableError(outcome.modelsTried);
			}
			throw error;
		}
	}) as unknown as Runnable<I, O>;
}

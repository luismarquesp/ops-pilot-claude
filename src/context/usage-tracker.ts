import { AsyncLocalStorage } from "node:async_hooks";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { LLMResult } from "@langchain/core/outputs";
import { usageFromLLMResult, type TokenUsage } from "./tokens.js";

/** Acumulador do turno corrente (specs/011, research.md §3). */
const scope = new AsyncLocalStorage<TokenUsage[]>();

/**
 * Roda `fn` num escopo de uso novo e devolve o uso registrado nele. Escopos
 * concorrentes são isolados; o que roda depois de `fn` (ex.: o refletor de
 * aprendizado) fica fora da contagem.
 */
export async function trackUsage<T>(fn: () => Promise<T>): Promise<{ value: T; usage: TokenUsage[] }> {
	const usage: TokenUsage[] = [];
	const value = await scope.run(usage, fn);
	return { value, usage };
}

/** Registra uma chamada no escopo atual; fora de `trackUsage` não faz nada. */
export function recordUsage(usage: TokenUsage): void {
	scope.getStore()?.push(usage);
}

/**
 * Callback do LangChain que soma o uso de cada chamada num acumulador fixo.
 * `_awaitHandler` faz o LangChain esperar o `handleLLMEnd` antes de devolver
 * a chamada, para o uso estar completo quando a estratégia termina (research.md §4).
 */
class UsageCallbackHandler extends BaseCallbackHandler {
	name = "opspilot_usage";

	constructor(private readonly usage: TokenUsage[]) {
		super({ _awaitHandler: true });
	}

	override handleLLMEnd(output: LLMResult): void {
		try {
			const call = usageFromLLMResult(output);
			if (call) {
				this.usage.push(call);
			}
		} catch {
			// Ler o uso nunca derruba o turno (FR-008).
		}
	}
}

/**
 * Callbacks para o modelo criado agora. O acumulador é capturado na criação,
 * não no disparo do callback — assim a contagem não depende do contexto em que
 * o LangChain executa os handlers. Fora de escopo → `undefined`.
 */
export function usageCallbacks(): BaseCallbackHandler[] | undefined {
	const usage = scope.getStore();
	return usage ? [new UsageCallbackHandler(usage)] : undefined;
}

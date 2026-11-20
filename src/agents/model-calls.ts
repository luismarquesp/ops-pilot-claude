/**
 * Chamadas ao modelo do turno corrente (specs/015, research.md §5), no mesmo
 * molde do `usage-tracker` (specs/011): cada chamada resiliente bem-sucedida
 * registra qual modelo respondeu e as trocas de modelo que precisou fazer. O
 * grafo de produção lê esse registro por nó para montar os eventos `fallback`
 * e `metrics.modelUsed`.
 */
import { AsyncLocalStorage } from "node:async_hooks";

/** Troca de um modelo para o seguinte da cadeia; `reason` = só o nome do erro. */
export interface ModelSwitch {
	from: string;
	to: string;
	reason: string;
}

export interface ModelCall {
	/** Modelo que respondeu; `null` não ocorre em chamadas registradas, mas o tipo aceita para composição. */
	modelUsed: string | null;
	switches: ModelSwitch[];
}

const scope = new AsyncLocalStorage<ModelCall[]>();

/** Roda `fn` num escopo novo e devolve as chamadas registradas nele. */
export async function trackModelCalls<T>(fn: () => Promise<T>): Promise<{ value: T; calls: ModelCall[] }> {
	const calls: ModelCall[] = [];
	const value = await scope.run(calls, fn);
	return { value, calls };
}

/** Registra uma chamada no escopo atual; fora de `trackModelCalls` não faz nada. */
export function recordModelCall(call: ModelCall): void {
	scope.getStore()?.push(call);
}

/** Quantas chamadas o escopo atual já tem — marca para `modelCallsSince`. 0 fora de escopo. */
export function modelCallCount(): number {
	return scope.getStore()?.length ?? 0;
}

/** Chamadas registradas depois de `mark`; `[]` fora de escopo. */
export function modelCallsSince(mark: number): ModelCall[] {
	return scope.getStore()?.slice(mark) ?? [];
}

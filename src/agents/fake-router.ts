import type { Router, RouteSpec } from "./router.js";

export interface FakeRouterCall {
	prompt: string;
	routes: readonly RouteSpec[];
}

export type FakeRouter = Router & { calls: FakeRouterCall[] };

/**
 * Roteador falso e determinístico para os testes (specs/014, FR-014): devolve
 * sempre `result` (ou rejeita, se for `Error`) e registra cada chamada.
 * `result` é cru de propósito — permite simular saída fora do contrato.
 */
export function createFakeRouter(result: unknown): FakeRouter {
	const calls: FakeRouterCall[] = [];
	const router = async (input: FakeRouterCall): Promise<unknown> => {
		calls.push({ prompt: input.prompt, routes: [...input.routes] });
		if (result instanceof Error) {
			throw result;
		}
		return result;
	};
	return Object.assign(router, { calls });
}

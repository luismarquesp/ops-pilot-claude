/**
 * Roteador do grafo de produção (specs/014, contracts/production-graph.md):
 * escolhe, por turno, qual estratégia de raciocínio atende a pergunta.
 * `ROUTE_TABLE` é a fonte única das rotas — gera a tabela do prompt e o enum
 * da decisão estruturada, para os dois nunca divergirem (FR-004).
 */
import { z } from "zod";
import { createModel } from "./model.js";

export const ROUTES = ["react", "plan-and-execute", "reflection"] as const;

export type Route = (typeof ROUTES)[number];

export interface RouteSpec {
	name: Route;
	/** Critério de uso — vira a linha da tabela do prompt. */
	when: string;
}

export const ROUTE_TABLE: readonly RouteSpec[] = [
	{
		name: "react",
		when: "consulta ou ação única e direta: listar alertas/incidentes, abrir ou resolver um incidente, ler o runbook de um serviço",
	},
	{
		name: "plan-and-execute",
		when: "tarefa com vários passos dependentes ou repetida sobre vários itens (ex.: para cada alerta crítico, abrir um incidente)",
	},
	{
		name: "reflection",
		when: "resposta que precisa ser conferida com cuidado: diagnóstico, recomendação, resumo para terceiros, pedido explícito para revisar",
	},
];

/** `resume`: turno retomado depois de uma decisão de aprovação, na rota guardada (specs/018). */
export type RouteSource = "router" | "override" | "fallback" | "resume";

export interface RouteDecision {
	route: Route;
	reason: string;
	source: RouteSource;
}

/** Evento do rastro com a decisão do turno (FR-008). */
export type RouteEvent = { type: "route"; route: Route; reason: string; source: RouteSource };

/** Saída crua do roteador — sempre revalidada por `parseRouteDecision` (research.md §5). */
export type Router = (input: { prompt: string; routes: readonly RouteSpec[] }) => Promise<unknown>;

/** Função pura: instruções do roteador com a tabela das rotas recebidas. */
export function routerSystemPrompt(routes: readonly RouteSpec[]): string {
	const table = ["| rota | quando usar |", "|------|-------------|", ...routes.map((spec) => `| ${spec.name} | ${spec.when} |`)];
	return [
		"Você é o roteador do OpsPilot, um copiloto de plantão. Leia o pedido do plantonista " +
			"(com o contexto da conversa, se houver) e escolha exatamente uma rota da tabela abaixo. " +
			"Justifique a escolha em uma frase curta.",
		"",
		...table,
	].join("\n");
}

export function routeDecisionSchema(routes: readonly RouteSpec[]) {
	const names = routes.map((spec) => spec.name) as [Route, ...Route[]];
	return z.object({
		route: z.enum(names).describe("Rota escolhida, exatamente como na tabela"),
		reason: z.string().trim().min(1).describe("Uma frase curta justificando a escolha"),
	});
}

/** Saída do roteador fora do contrato (rota inexistente, indisponível ou sem `reason`). */
export class InvalidRouteDecisionError extends Error {
	override name = "InvalidRouteDecisionError";

	constructor() {
		super("Decisão de rota fora do contrato");
	}
}

/** Função pura: valida a saída do roteador contra as rotas disponíveis; `null` se fora do contrato. */
export function parseRouteDecision(raw: unknown, routes: readonly RouteSpec[]): { route: Route; reason: string } | null {
	if (routes.length === 0) {
		return null;
	}
	const parsed = routeDecisionSchema(routes).safeParse(raw);
	return parsed.success ? parsed.data : null;
}

/** Roteador real: mesmo modelo do núcleo, saída estruturada (FR-003). */
export const defaultRouter: Router = async ({ prompt, routes }) => {
	return createModel((model) => model.withStructuredOutput(routeDecisionSchema(routes)))
		.invoke([
			["system", routerSystemPrompt(routes)],
			["user", prompt],
		]);
};

/** Loga a falha só pelo nome do erro — nada do conteúdo do pedido (FR-009). */
export function logRouteFailure(error: unknown): void {
	console.warn("[router] falha ao rotear:", error instanceof Error ? error.name : typeof error);
}

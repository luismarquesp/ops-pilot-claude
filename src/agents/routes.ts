/**
 * Estratégias por rota do grafo de produção (specs/014, research.md §6).
 * `reflection` é sempre o `react` base com reflexão; `reflect: true` embrulha
 * as demais rotas, nunca a `reflection` de novo (FR-012).
 */
import { withReflection, type ReflectionOptions } from "./reflection.js";
import { ROUTE_TABLE, type Route, type RouteSpec } from "./router.js";
import type { ReasoningStrategy } from "./strategy.js";

export type RouteStrategies = Partial<Record<Route, ReasoningStrategy>>;

export interface RouteStrategiesOptions {
	reflect?: boolean;
	reflectionOptions?: ReflectionOptions;
}

export function routeStrategies(
	registry: ReadonlyMap<string, ReasoningStrategy>,
	opts: RouteStrategiesOptions = {},
): RouteStrategies {
	const wrap = (strategy: ReasoningStrategy) => (opts.reflect ? withReflection(strategy, opts.reflectionOptions) : strategy);
	const react = registry.get("react");
	const planAndExecute = registry.get("plan-and-execute");

	const strategies: RouteStrategies = {};
	if (react) {
		strategies.react = wrap(react);
		strategies.reflection = withReflection(react, opts.reflectionOptions);
	}
	if (planAndExecute) {
		strategies["plan-and-execute"] = wrap(planAndExecute);
	}
	return strategies;
}

/** Função pura: rotas presentes, na ordem de `ROUTE_TABLE`. */
export function availableRoutes(strategies: RouteStrategies): RouteSpec[] {
	return ROUTE_TABLE.filter((spec) => strategies[spec.name] !== undefined);
}

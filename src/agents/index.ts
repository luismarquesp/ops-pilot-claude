import type { StructuredToolInterface } from "@langchain/core/tools";
import { createReactStrategy } from "./react.js";
import { createPlanAndExecuteStrategy } from "./plan-and-execute.js";
import type { ReasoningStrategy } from "./strategy.js";
import { isSensitiveTool } from "./approvals.js";
import { withApprovalGate } from "./approval-gate.js";

/**
 * Registro único de estratégias (FR-008): nome → `ReasoningStrategy`. Não inclui
 * entradas "refletidas" — `withReflection` é aplicado em runtime pelo Controller
 * sobre a estratégia já resolvida (FR-009, contracts/strategy-registry.md).
 */
export function createStrategyRegistry(rawTools: StructuredToolInterface[]): Map<string, ReasoningStrategy> {
	// Ações sensíveis passam pelo portão de aprovação (specs/018); fora de um turno do /chat, executam direto.
	const tools = rawTools.map((t) => (isSensitiveTool(t.name) ? withApprovalGate(t) : t));
	const strategies: ReasoningStrategy[] = [createReactStrategy(tools), createPlanAndExecuteStrategy(tools)];
	return new Map(strategies.map((strategy) => [strategy.name, strategy]));
}

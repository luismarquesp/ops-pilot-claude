/** Contrato comum de estratégia de raciocínio (FR-001..FR-004). Ver
 * specs/001-reasoning-core/contracts/reasoning-strategy.md */

export type TraceEvent =
	| { type: "thought"; content: string }
	| { type: "action"; tool: string; args: unknown }
	| { type: "observation"; content: string }
	| { type: "plan"; steps: string[] }
	| { type: "critique"; content: string }
	| { type: "answer"; content: string }
	/** Turno que gerou um resumo novo do histórico (specs/012); `content` = o resumo. */
	| { type: "summarize"; content: string; messagesSummarized: number }
	/** Turno pausado antes de uma ação sensível (specs/018); `summary` em linguagem humana. */
	| { type: "approval"; approvalId: string; tool: string; args: unknown; summary: string }
	/** Decisão do plantonista que retomou o turno (specs/018); `result` = saída da ação aprovada. */
	| { type: "decision"; approvalId: string; decision: "approved" | "denied" | "expired"; result?: string };

export type Trace = readonly TraceEvent[];

export interface Metrics {
	llmCalls: number;
	latencyMs: number;
}

export interface StrategyInput {
	question: string;
	maxIterations?: number;
}

export interface StrategyResult {
	answer: string;
	trace: Trace;
	metrics: Metrics;
}

export interface ReasoningStrategy {
	readonly name: string;
	run(input: StrategyInput): Promise<StrategyResult>;
}

/** Default de iterações/passos quando `maxIterations` não é informado (research.md §5). */
export const DEFAULT_MAX_ITERATIONS = 8;

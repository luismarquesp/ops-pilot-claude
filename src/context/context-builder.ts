import { z } from "zod";
import { formatQuestionWithHistory, formatSummaryBlock, type HistoryMessage } from "../agents/history.js";
import { formatQuestionWithMemory } from "../memory/memory-prompt.js";
import { contextBreakdown, type ContextBreakdown } from "./breakdown.js";
import { estimateTokens } from "./tokens.js";

/**
 * Tetos por seção em tokens estimados (`ceil(chars/4)`) do bloco inteiro que a
 * seção acrescenta ao prompt, cabeçalho incluído (specs/013, research.md §2).
 */
export interface ContextBudget {
	summary: number;
	window: number;
	memory: number;
}

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = { summary: 200, window: 1200, memory: 300 };

/** Fato lembrado com a relevância devolvida pelo `recall` (specs/008). */
export type BudgetFact = { fact: string; score: number };

/** O que já foi carregado para o turno; o builder não faz I/O. */
export interface ContextInput {
	/** Mensagem do usuário: nunca medida contra teto, nunca alterada (FR-002). */
	question: string;
	/** Ordem por relevância desc, como o `recall` devolve. */
	facts: readonly BudgetFact[];
	summary?: string;
	/** Mais antiga primeiro. */
	history: readonly HistoryMessage[];
	/**
	 * Decisões do plantonista no turno retomado (specs/018, `ledgerPromptSection`):
	 * entram logo antes da pergunta e, como ela, nunca são cortadas.
	 */
	decisions?: string;
}

/** Quanto o orçamento removeu no turno (specs/013, FR-011). */
export interface ContextTrimReport {
	historyMessages: number;
	memoryFacts: number;
	summaryTruncated: boolean;
}

export interface BuiltContext {
	prompt: string;
	facts: BudgetFact[];
	summary?: string;
	history: HistoryMessage[];
	trimmed: ContextTrimReport;
	breakdown: ContextBreakdown;
}

/** Seção orçada: itens, teto, como vira texto e qual item sai primeiro. */
interface Section<T> {
	items: readonly T[];
	budget: number;
	render(items: readonly T[]): string;
	/** Índice do próximo item a cortar. */
	cut(items: readonly T[]): number;
}

const oldestFirst = (): number => 0;

const newestFirst = (items: readonly unknown[]): number => items.length - 1;

/** Menor score; empate → o que vem por último (research.md §4). */
function lowestScoreFirst(items: readonly BudgetFact[]): number {
	let lowest = 0;
	items.forEach((item, index) => {
		if (item.score <= items[lowest]!.score) {
			lowest = index;
		}
	});
	return lowest;
}

/** Função pura: remove itens inteiros, na ordem da regra de corte, até o bloco caber no teto. */
function fitToBudget<T>(section: Section<T>): T[] {
	const kept = [...section.items];
	while (kept.length > 0 && estimateTokens(section.render(kept)) > section.budget) {
		kept.splice(section.cut(kept), 1);
	}
	return kept;
}

/**
 * Resumo (research.md §5): cai linha a linha a partir do fim; se nem a primeira
 * linha cabe, corte seco no maior prefixo que faz o bloco caber.
 */
function fitSummary(summary: string | undefined, budget: number): string | undefined {
	if (!summary) {
		return undefined;
	}
	const lines = fitToBudget({
		items: summary.split("\n"),
		budget,
		render: (kept) => formatSummaryBlock(kept.join("\n")),
		cut: newestFirst,
	});
	if (lines.length > 0) {
		return lines.join("\n");
	}
	const overhead = formatSummaryBlock(summary).length - summary.length;
	const prefix = summary.slice(0, Math.max(0, budget * 4 - overhead)).trimEnd();
	return prefix.length > 0 ? prefix : undefined;
}

/** Ordem fatos → resumo → histórico → pergunta (specs/012), com os formatadores de sempre (FR-009). */
function assemble(question: string, facts: BudgetFact[], summary: string | undefined, history: HistoryMessage[]): string {
	return formatQuestionWithMemory(facts, formatQuestionWithHistory(history, question, summary));
}

/**
 * Função pura (specs/013, research.md §1–§5): monta o prompt do turno para
 * qualquer estratégia aplicando o teto de cada seção — janela perde as
 * mensagens mais antigas, memória os fatos de menor score, resumo o seu fim.
 * A pergunta e as instruções de sistema (dentro das estratégias) ficam fora do
 * orçamento. Abaixo dos tetos, o prompt é o mesmo da composição anterior.
 */
export function buildContext(input: ContextInput, budget: ContextBudget = DEFAULT_CONTEXT_BUDGET): BuiltContext {
	const facts = fitToBudget({
		items: input.facts,
		budget: budget.memory,
		render: (kept) => formatQuestionWithMemory(kept, ""),
		cut: lowestScoreFirst,
	});
	const summary = fitSummary(input.summary, budget.summary);
	const history = fitToBudget({
		items: input.history,
		budget: budget.window,
		render: (kept) => formatQuestionWithHistory(kept, ""),
		cut: oldestFirst,
	});

	return {
		prompt: assemble(input.decisions ? `${input.decisions}

${input.question}` : input.question, facts, summary, history),
		facts,
		summary,
		history,
		trimmed: {
			historyMessages: input.history.length - history.length,
			memoryFacts: input.facts.length - facts.length,
			summaryTruncated: Boolean(input.summary) && summary !== input.summary,
		},
		breakdown: contextBreakdown(input.question, history, facts, summary),
	};
}

const BUDGET_ENV: Record<keyof ContextBudget, string> = {
	summary: "CONTEXT_BUDGET_SUMMARY",
	window: "CONTEXT_BUDGET_WINDOW",
	memory: "CONTEXT_BUDGET_MEMORY",
};

const budgetValueSchema = z.coerce.number().int().min(0);

/**
 * Função pura (specs/013, research.md §6): lê os tetos de `CONTEXT_BUDGET_*`
 * validando com zod. Ausente ou vazio → padrão; inválido → padrão e o nome da
 * variável em `invalid` (nunca o valor), para a borda logar.
 */
export function parseContextBudget(env: Readonly<Record<string, string | undefined>>): { budget: ContextBudget; invalid: string[] } {
	const budget = { ...DEFAULT_CONTEXT_BUDGET };
	const invalid: string[] = [];
	for (const key of Object.keys(BUDGET_ENV) as (keyof ContextBudget)[]) {
		const name = BUDGET_ENV[key];
		const raw = env[name]?.trim();
		if (!raw) {
			continue;
		}
		const parsed = budgetValueSchema.safeParse(raw);
		if (parsed.success) {
			budget[key] = parsed.data;
		} else {
			invalid.push(name);
		}
	}
	return { budget, invalid };
}

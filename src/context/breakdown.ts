import { formatQuestionWithHistory, formatSummaryBlock, type HistoryMessage } from "../agents/history.js";
import { formatQuestionWithMemory, type PromptFact } from "../memory/memory-prompt.js";
import { estimateTokens } from "./tokens.js";

/** Estimativa por fonte do prompt montado pelo serviço de chat (specs/011, data-model.md). */
export interface ContextBreakdown {
	question: number;
	history: number;
	memory: number;
	/** Resumo da conversa (specs/012); 0 sem resumo. */
	summary: number;
	total: number;
}

/**
 * Função pura (research.md §6; specs/012 research.md §8–§9): estima o texto que
 * cada fonte acrescenta ao prompt. Os formatadores com pergunta vazia devolvem
 * exatamente o prefixo de cada camada, e o prompt inteiro é
 * `prefixoMemória + blocoResumo + prefixoHistórico + pergunta` — as fatias não
 * se sobrepõem. Instruções de sistema, schemas de tools e mensagens
 * intermediárias do agente ficam de fora.
 */
export function contextBreakdown(
	question: string,
	history: readonly HistoryMessage[],
	facts: readonly PromptFact[],
	summary?: string,
): ContextBreakdown {
	const breakdown = {
		question: estimateTokens(question),
		history: estimateTokens(formatQuestionWithHistory(history, "")),
		memory: estimateTokens(formatQuestionWithMemory(facts, "")),
		summary: estimateTokens(formatSummaryBlock(summary)),
	};
	return { ...breakdown, total: breakdown.question + breakdown.history + breakdown.memory + breakdown.summary };
}

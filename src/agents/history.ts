import type { ConversationMessage } from "../store/conversation-store.js";

/** Janela de mensagens recentes levadas por extenso (specs/012, research.md §3 — antes 12, specs/007). */
export const RECENT_WINDOW = 8;

/** Quantas mensagens pendentes (fora da janela, não resumidas) disparam um novo resumo (specs/012). */
export const SUMMARY_BATCH = 8;

export type HistoryMessage = Pick<ConversationMessage, "role" | "content">;

const SPEAKER: Record<HistoryMessage["role"], string> = {
	user: "Plantonista",
	assistant: "OpsPilot",
};

export interface HistoryPlan<T> {
	toSummarize: T[];
	recent: T[];
}

/**
 * Função pura (specs/012, research.md §3): decide o que resumir. Com pelo
 * menos `batch` mensagens fora da janela, resume **todas** elas (uma conversa
 * antiga vira um resumo só) e mantém as `window` mais recentes; senão, nada é
 * resumido e todas seguem por extenso.
 */
export function planHistory<T>(
	unsummarized: readonly T[],
	opts: { window: number; batch: number } = { window: RECENT_WINDOW, batch: SUMMARY_BATCH },
): HistoryPlan<T> {
	const pending = unsummarized.length - opts.window;
	if (pending < opts.batch) {
		return { toSummarize: [], recent: [...unsummarized] };
	}
	return { toSummarize: unsummarized.slice(0, pending), recent: unsummarized.slice(pending) };
}

/** Função pura (research.md §8): bloco do resumo no prompt; vazio sem resumo. */
export function formatSummaryBlock(summary?: string): string {
	return summary ? `Resumo da conversa até aqui:\n${summary}\n\n` : "";
}

/** Linhas `Plantonista: ...`/`OpsPilot: ...`, mais antiga primeiro. */
export function formatTranscript(history: readonly HistoryMessage[]): string {
	return history.map((message) => `${SPEAKER[message.role]}: ${message.content}`).join("\n");
}

/**
 * Função pura (research.md §3, specs/007): prefixa a pergunta com o resumo da
 * conversa (specs/012) e o histórico recente, mais antigo primeiro. Sem resumo
 * e sem histórico → pergunta inalterada (SC-005). Usada pelo `buildContext`
 * (specs/013) depois dos cortes de orçamento.
 */
export function formatQuestionWithHistory(history: readonly HistoryMessage[], question: string, summary?: string): string {
	const withRecent =
		history.length === 0
			? question
			: `Histórico recente desta conversa (mais antigo primeiro):\n${formatTranscript(history)}\n\nPergunta atual: ${question}`;
	return formatSummaryBlock(summary) + withRecent;
}

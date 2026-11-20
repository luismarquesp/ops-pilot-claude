import { planHistory, RECENT_WINDOW, type HistoryMessage } from "../agents/history.js";
import type { Summarizer } from "../agents/summarizer.js";
import type { TraceEvent } from "../agents/strategy.js";
import type { ConversationStore, StoredMessage } from "../store/conversation-store.js";

/** Evento do rastro no turno que gerou um resumo novo (specs/012, data-model.md). */
export type SummarizeEvent = Extract<TraceEvent, { type: "summarize" }>;

/** Contexto de conversa de um turno: resumo vigente + mensagens por extenso. */
export interface ConversationContext {
	summary?: string;
	recent: HistoryMessage[];
	/** Só no turno em que um resumo novo foi gravado. */
	event?: SummarizeEvent;
}

export interface ConversationContextDeps {
	conversations: ConversationStore;
	/** Ausente → nunca resume: resumo guardado + as `RECENT_WINDOW` mais recentes (research.md §10). */
	summarizer?: Summarizer;
	/** Falha do resumidor (research.md §7); nunca recebe conteúdo da conversa. */
	log?: (error: unknown) => void;
}

const toHistory = ({ role, content }: StoredMessage): HistoryMessage => ({ role, content });

/**
 * Service do contexto de conversa (specs/012, research.md §5–§7): lê o resumo
 * e as mensagens ainda não resumidas; quando `planHistory` manda, chama o
 * resumidor com o resumo anterior + pendentes e grava o resultado. Falha ou
 * texto vazio não derruba o turno: nada é gravado e tudo segue por extenso.
 * `ConversationNotFoundError` do store propaga.
 */
export async function loadConversationContext(conversationId: string, deps: ConversationContextDeps): Promise<ConversationContext> {
	const { conversations, summarizer } = deps;
	const stored = await conversations.getSummary(conversationId);
	const unsummarized = await conversations.messagesSince(conversationId, stored?.coveredUntil ?? 0);
	const previous = stored?.summary;

	if (!summarizer) {
		return { summary: previous, recent: unsummarized.slice(-RECENT_WINDOW).map(toHistory) };
	}

	const { toSummarize, recent } = planHistory(unsummarized);
	const last = toSummarize.at(-1);
	if (!last) {
		return { summary: previous, recent: recent.map(toHistory) };
	}

	let summary: string;
	try {
		summary = (await summarizer({ previous, messages: toSummarize.map(toHistory) })).trim();
		if (summary.length === 0) {
			throw new Error("Resumidor devolveu texto vazio");
		}
	} catch (error) {
		deps.log?.(error);
		return { summary: previous, recent: unsummarized.map(toHistory) };
	}

	const saved = await conversations.saveSummary(conversationId, {
		summary,
		coveredUntil: last.seq,
		messagesCovered: (stored?.messagesCovered ?? 0) + toSummarize.length,
	});
	const event: SummarizeEvent | undefined = saved
		? { type: "summarize", content: summary, messagesSummarized: toSummarize.length }
		: undefined;
	return { summary, recent: recent.map(toHistory), event };
}

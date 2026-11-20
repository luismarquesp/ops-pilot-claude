/**
 * Resumidor de histórico (specs/012, contracts/summarizer.md): comprime as
 * mensagens que saíram da janela recente, mesclando com o resumo anterior.
 */
import { createModel } from "./model.js";
import { formatTranscript, type HistoryMessage } from "./history.js";

export interface SummarizerInput {
	/** Resumo anterior, se houver — o novo resumo o incorpora. */
	previous?: string;
	/** Mensagens pendentes, mais antiga primeiro; nunca a conversa inteira. */
	messages: readonly HistoryMessage[];
}

export type Summarizer = (input: SummarizerInput) => Promise<string>;

export const SUMMARIZER_PROMPT =
	"Comprima o trecho de conversa a seguir em no máximo 150 tokens, preservando obrigatoriamente: " +
	"decisões tomadas, fatos estabelecidos (nomes, datas, preferências), incidentes abertos/resolvidos " +
	"e pendências abertas. Descarte cumprimentos e conversa social. Se houver um resumo anterior, " +
	"incorpore-o. Responda só o resumo, em tópicos telegráficos.";

/** Função pura: mensagens enviadas ao modelo (system + user). */
export function summarizerMessages(input: SummarizerInput): Array<["system" | "user", string]> {
	const previous = input.previous ? `Resumo anterior:\n${input.previous}` : "Resumo anterior: (nenhum)";
	return [
		["system", SUMMARIZER_PROMPT],
		["user", `${previous}\n\nTrecho da conversa:\n${formatTranscript(input.messages)}`],
	];
}

/** Resumidor real: mesmo modelo do núcleo, texto livre (research.md §4). */
export const defaultSummarizer: Summarizer = async (input) => {
	const message = await createModel().invoke(summarizerMessages(input));
	const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content);
	return content.trim();
};

/** Loga a falha só pelo nome do erro — nada do conteúdo da conversa (research.md §7). */
export function logSummaryFailure(error: unknown): void {
	console.warn("[summary] falha ao resumir:", error instanceof Error ? error.name : typeof error);
}

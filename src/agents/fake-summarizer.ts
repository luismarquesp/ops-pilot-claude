import type { Summarizer, SummarizerInput } from "./summarizer.js";

export type FakeSummarizer = Summarizer & { calls: SummarizerInput[] };

/**
 * Resumidor falso e determinístico para os testes (specs/012, research.md §12):
 * `[anterior | ]conteúdos,separados,por,vírgula`. Registra cada chamada; com
 * `fail` rejeita, com `empty` devolve "".
 */
export function createFakeSummarizer(opts: { fail?: boolean; empty?: boolean } = {}): FakeSummarizer {
	const calls: SummarizerInput[] = [];
	const summarizer = async (input: SummarizerInput): Promise<string> => {
		calls.push({ previous: input.previous, messages: [...input.messages] });
		if (opts.fail) {
			throw new Error("fake summarizer");
		}
		if (opts.empty) {
			return "";
		}
		const merged = input.messages.map((message) => message.content).join(",");
		return input.previous ? `${input.previous} | ${merged}` : merged;
	};
	return Object.assign(summarizer, { calls });
}

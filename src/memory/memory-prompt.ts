import type { RecalledMemory } from "./memory-store.js";

export type PromptFact = Pick<RecalledMemory, "fact">;

/**
 * Função pura (specs/008, research.md §6): prefixa a pergunta com os fatos
 * lembrados. Sem ids desde specs/009 (research.md §7) — esquecer é por
 * descrição, via `forget_preference`. Sem fatos → pergunta inalterada (FR-008).
 * Usada pelo `buildContext` (specs/013) depois dos cortes de orçamento.
 */
export function formatQuestionWithMemory(facts: readonly PromptFact[], question: string): string {
	if (facts.length === 0) {
		return question;
	}
	const lines = facts.map((memory) => `- ${memory.fact}`);
	return `Fatos lembrados sobre este usuário (mais relevante primeiro):\n${lines.join("\n")}\n\n${question}`;
}

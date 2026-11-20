import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import type { MemoryStore } from "./memory-store.js";

/** Texto de um fato: 1..500 caracteres após o trim. Usado por `remember_fact` e `POST /memories` (specs/010). */
export const factSchema = z.string().trim().min(1).max(500);

/**
 * Tools de memória do agente (specs/008; `forget_preference` desde specs/009,
 * contracts/memory-tools.md). O `userId` do turno fica preso na closure —
 * nenhuma tool o recebe como argumento, então o LLM não consegue ler ou
 * alterar fatos de outro usuário (research.md §7).
 */
export function createMemoryTools(memory: MemoryStore, userId: string): StructuredToolInterface[] {
	const rememberFact = tool(
		async ({ fact }: { fact: string }) => {
			const { memory: saved, created } = await memory.remember(userId, fact);
			return JSON.stringify({ id: saved.id, fact: saved.fact, created });
		},
		{
			name: "remember_fact",
			description:
				"Guarda um fato DURADOURO sobre o plantonista com quem você está falando — papel, time, " +
				"serviços pelos quais responde, preferências de resposta — para lembrar em conversas " +
				"futuras. Use quando ele contar algo assim sobre si ou pedir para você lembrar. Não use " +
				"para estado de alertas ou incidentes, que muda o tempo todo e já está nas outras tools.",
			schema: z.object({
				fact: factSchema.describe("O fato, numa frase curta e autocontida (ex.: 'É responsável pelo serviço de pagamentos')."),
			}),
		},
	);

	const forgetPreferenceTool = tool(
		async ({ description }: { description: string }) => {
			return JSON.stringify(await forgetPreference(memory, userId, description));
		},
		{
			name: "forget_preference",
			description:
				"Esquece um fato ou preferência guardado sobre o plantonista, quando ele pedir para " +
				"esquecer ou disser que algo mudou (ex.: trocou de time, não prefere mais respostas " +
				"curtas). Descreva o fato com as palavras dele; a tool remove o fato guardado mais " +
				"parecido e devolve o texto removido em `fact` — confirme esse texto ao plantonista. " +
				"Se `forgotten` vier false, diga que não encontrou nada parecido.",
			schema: z.object({
				description: z
					.string()
					.trim()
					.min(1)
					.max(500)
					.describe("A preferência/fato a esquecer, em linguagem natural (ex.: 'que eu prefiro respostas curtas')."),
			}),
		},
	);

	return [rememberFact, forgetPreferenceTool];
}

export type ForgetPreferenceResult = { forgotten: true; fact: string } | { forgotten: false };

/**
 * Esquece o fato de `userId` mais parecido com `description` — desde que passe
 * o limiar de relevância do `recall` (specs/009, research.md §7).
 */
export async function forgetPreference(
	memory: MemoryStore,
	userId: string,
	description: string,
): Promise<ForgetPreferenceResult> {
	const [closest] = await memory.recall(userId, description, 1);
	if (!closest || !(await memory.forget(userId, closest.id))) {
		return { forgotten: false };
	}
	return { forgotten: true, fact: closest.fact };
}

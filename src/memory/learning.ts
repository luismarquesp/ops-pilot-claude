/**
 * Refletor de aprendizado (specs/009, research.md §1/§4): depois de cada turno
 * bem-sucedido com `userId`, destila da mensagem do usuário no máximo um fato
 * duradouro e o registra na memória semântica.
 */
import { z } from "zod";
import { createModel } from "../agents/model.js";
import type { MemoryStore } from "./memory-store.js";
import { containsSecret } from "./secrets.js";

/** Tamanho máximo de um fato aprendido (mesmo teto da tool `remember_fact`). */
export const MAX_FACT_LENGTH = 500;

/** Saída estruturada do extrator — efêmera, nunca persistida. */
export interface LearningVerdict {
	hasLearning: boolean;
	fact?: string;
}

export type LearningExtractor = (message: string) => Promise<LearningVerdict>;

/** Resultado observável de um aprendizado (data-model.md). */
export type LearningOutcome = "skipped_secret" | "nothing" | "rejected" | "learned" | "duplicate" | "failed";

export interface LearnInput {
	userId: string;
	message: string;
}

export interface LearnDeps {
	memory: MemoryStore;
	extractor: LearningExtractor;
	log: (error: unknown) => void;
}

/**
 * Função pura (research.md §4): o fato que pode ir para a memória, ou
 * `undefined` quando não há aprendizado, o fato é vazio, longo demais ou
 * contém algo com cara de segredo (segunda barreira, FR-007).
 */
export function toLearnableFact(verdict: LearningVerdict): string | undefined {
	if (!verdict.hasLearning) {
		return undefined;
	}
	const fact = verdict.fact?.trim() ?? "";
	if (fact.length === 0 || fact.length > MAX_FACT_LENGTH || containsSecret(fact)) {
		return undefined;
	}
	return fact;
}

/**
 * Aprende (no máximo) um fato da mensagem do usuário. Nunca rejeita: roda sem
 * `await` depois da resposta (research.md §5), então qualquer falha vira
 * `"failed"` + `log`, sem afetar o turno (FR-008). Mensagem com segredo nem
 * chega ao extrator (research.md §3).
 */
export async function learnFromMessage(input: LearnInput, deps: LearnDeps): Promise<LearningOutcome> {
	if (containsSecret(input.message)) {
		return "skipped_secret";
	}
	try {
		const verdict = await deps.extractor(input.message);
		if (!verdict.hasLearning) {
			return "nothing";
		}
		const fact = toLearnableFact(verdict);
		if (fact === undefined) {
			return "rejected";
		}
		const { created } = await deps.memory.remember(input.userId, fact);
		return created ? "learned" : "duplicate";
	} catch (error) {
		deps.log(error);
		return "failed";
	}
}

/** Log de falha sem conteúdo do usuário — só o nome do erro (research.md §6). */
export function logLearningFailure(error: unknown): void {
	console.warn("[learning] falha ao aprender:", error instanceof Error ? error.name : typeof error);
}

const learningSchema = z.object({
	hasLearning: z.boolean().describe("true só se a mensagem contém um fato DURADOURO sobre o próprio plantonista"),
	// Obrigatório (string vazia quando não há aprendizado): com `optional()`, o
	// modelo às vezes devolvia hasLearning: true sem o fato (eval, research.md §8).
	fact: z
		.string()
		.describe(
			'Se hasLearning: o fato numa frase curta, autocontida, em terceira pessoa, no idioma da mensagem. Senão: ""',
		),
});

const LEARNING_PROMPT =
	"Você é o refletor de aprendizado do OpsPilot, um copiloto de plantão. Leia APENAS a " +
	"mensagem do plantonista e decida se ela revela um fato DURADOURO sobre ele que valha " +
	"lembrar em conversas futuras: papel, time, serviços pelos quais responde, preferências " +
	"de formato ou idioma de resposta, rotinas de plantão.\n\n" +
	"NUNCA é aprendizado:\n" +
	"- pedidos pontuais ou ações do momento (abrir/fechar/listar/consultar algo);\n" +
	"- estado de alertas, incidentes ou serviços (isso muda o tempo todo);\n" +
	"- contexto que só vale para a conversa atual;\n" +
	"- qualquer credencial (senha, token, chave, connection string). Se a mensagem contiver " +
	"uma credencial, responda hasLearning: false, mesmo que haja outro fato na mensagem.\n\n" +
	"Se houver mais de um fato, devolva só o mais relevante, numa frase curta e autocontida, " +
	"em terceira pessoa e no idioma da mensagem. Na dúvida, hasLearning: false.\n\n" +
	"Exemplos:\n" +
	'- "sou eu que cuido do checkout, tem algo pegando?" → hasLearning: true, fact: "O plantonista é responsável pelo serviço de checkout."\n' +
	'- "fecha o incidente 42" → hasLearning: false\n' +
	'- "sou do time de pagamentos, abre um incidente pro checkout" → hasLearning: true, fact: "O plantonista é do time de pagamentos."\n' +
	'- "minha senha do grafana é hunter2, sou do SRE" → hasLearning: false';

/** Extrator real: mesmo modelo do núcleo, saída estruturada (research.md §1/§2). */
export const defaultLearningExtractor: LearningExtractor = async (message) => {
	return createModel((model) => model.withStructuredOutput(learningSchema))
		.invoke([
			["system", LEARNING_PROMPT],
			["user", `Mensagem do plantonista: ${message}`],
		]);
};

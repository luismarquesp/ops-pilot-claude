import type { Memory, MemoryStore, RememberResult } from "../memory/memory-store.js";
import { containsSecret } from "../memory/secrets.js";
import { MemoryNotFoundError, SecretDetectedError } from "./errors.js";

/**
 * Acesso direto à memória, sem LLM (specs/010, research.md §1/§2). Regras de
 * negócio aqui; o Controller (`http/memory-routes.ts`) só valida e traduz.
 */

/**
 * Registra um fato com dedup. Fatos com cara de segredo são recusados antes de
 * qualquer embedding — mesma barreira do aprendizado automático (specs/009).
 */
export async function registerFact(
	memory: MemoryStore,
	{ userId, fact }: { userId: string; fact: string },
): Promise<RememberResult> {
	if (containsSecret(fact)) {
		throw new SecretDetectedError();
	}
	return memory.remember(userId, fact);
}

/** Todos os fatos do usuário, do mais recente para o mais antigo. */
export function listFacts(memory: MemoryStore, userId: string): Promise<Memory[]> {
	return memory.list(userId);
}

/**
 * Remove um fato do próprio usuário. Inexistente e alheio são o mesmo erro —
 * a API não revela se o id existe para outra pessoa (FR-007).
 */
export async function removeFact(
	memory: MemoryStore,
	{ userId, memoryId }: { userId: string; memoryId: string },
): Promise<void> {
	if (!(await memory.forget(userId, memoryId))) {
		throw new MemoryNotFoundError(memoryId);
	}
}

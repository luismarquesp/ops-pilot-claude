import { z } from "zod";

/**
 * Identificação de usuário na borda HTTP (specs/008, specs/010 research.md §3):
 * texto opaco, 1..128 caracteres após o trim. Compartilhado por `/chat` e
 * `/memories` para as regras nunca divergirem.
 */
export const userIdSchema = z.string().trim().min(1).max(128);

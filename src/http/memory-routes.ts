import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { MemoryStore } from "../memory/memory-store.js";
import { factSchema } from "../memory/memory-tools.js";
import { listFacts, registerFact, removeFact } from "../services/memory-service.js";
import { MemoryNotFoundError, SecretDetectedError } from "../services/errors.js";
import { userIdSchema } from "./schemas.js";

const createBodySchema = z.object({ userId: userIdSchema, fact: factSchema });
const userQuerySchema = z.object({ userId: userIdSchema });
const idParamsSchema = z.object({ id: z.uuid() });

/**
 * Controller de `/memories` (specs/010, contracts/memories-api.md): só valida
 * com zod, chama o Service (`services/memory-service.ts`) e traduz erros de
 * domínio em status — acesso direto à memória, sem LLM. Erros inesperados
 * seguem para a rede de segurança do app (500).
 */
export function createMemoryRouter(memory: MemoryStore): Router {
	const router = Router();

	router.post("/", async (req: Request, res: Response) => {
		const parsed = createBodySchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({ issues: parsed.error.issues });
			return;
		}

		try {
			const { memory: saved, created } = await registerFact(memory, parsed.data);
			res.status(created ? 201 : 200).json({ memory: saved });
		} catch (error) {
			if (error instanceof SecretDetectedError) {
				res.status(422).json({ error: "secret_detected" });
				return;
			}
			throw error;
		}
	});

	router.get("/", async (req: Request, res: Response) => {
		const parsed = userQuerySchema.safeParse(req.query);
		if (!parsed.success) {
			res.status(400).json({ issues: parsed.error.issues });
			return;
		}

		res.status(200).json({ memories: await listFacts(memory, parsed.data.userId) });
	});

	router.delete("/:id", async (req: Request, res: Response) => {
		const params = idParamsSchema.safeParse(req.params);
		const query = userQuerySchema.safeParse(req.query);
		if (!params.success || !query.success) {
			const issues = [...(params.error?.issues ?? []), ...(query.error?.issues ?? [])];
			res.status(400).json({ issues });
			return;
		}

		try {
			await removeFact(memory, { userId: query.data.userId, memoryId: params.data.id });
			res.status(204).end();
		} catch (error) {
			if (error instanceof MemoryNotFoundError) {
				res.status(404).json({ error: "memory_not_found", id: error.memoryId });
				return;
			}
			throw error;
		}
	});

	return router;
}

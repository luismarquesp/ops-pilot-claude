import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { RequestStore } from "../store/request-store.js";
import { getRequest } from "../services/request-service.js";
import { RequestNotFoundError } from "../services/errors.js";

const idParamsSchema = z.object({ id: z.uuid() });

/**
 * Controller de `/requests` (specs/016, contracts/requests-api.md): valida o id
 * com zod, chama o Service e traduz `RequestNotFoundError` em 404.
 */
export function createRequestRouter(requests: RequestStore): Router {
	const router = Router();

	router.get("/:id", async (req: Request, res: Response) => {
		const parsed = idParamsSchema.safeParse(req.params);
		if (!parsed.success) {
			res.status(400).json({ issues: parsed.error.issues });
			return;
		}

		try {
			res.status(200).json(await getRequest(requests, parsed.data.id));
		} catch (error) {
			if (error instanceof RequestNotFoundError) {
				res.status(404).json({ error: "request_not_found", requestId: error.requestId });
				return;
			}
			throw error;
		}
	});

	return router;
}

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { RequestStore } from "../store/request-store.js";
import type { ModelPrices } from "../services/pricing.js";
import { DEFAULT_SINCE, getStats, sinceSchema } from "../services/stats-service.js";

const statsQuerySchema = z.object({ since: sinceSchema.default(DEFAULT_SINCE) });

export interface StatsRouterOptions {
	/** Preço por 1M tokens de prompt (`MODEL_PRICES`); ausente → só `:free` tem custo conhecido. */
	prices?: ModelPrices;
	/** Relógio injetável para os testes. */
	now?: () => Date;
}

/**
 * Controller de `/stats` (specs/017, contracts/stats-api.md): valida `since`
 * com zod e delega a agregação ao Service `getStats`.
 */
export function createStatsRouter(requests: RequestStore, { prices = new Map(), now = () => new Date() }: StatsRouterOptions = {}): Router {
	const router = Router();

	router.get("/", async (req: Request, res: Response) => {
		const parsed = statsQuerySchema.safeParse(req.query);
		if (!parsed.success) {
			res.status(400).json({ issues: parsed.error.issues });
			return;
		}
		res.status(200).json(await getStats(requests, { since: parsed.data.since, now: now(), prices }));
	});

	return router;
}

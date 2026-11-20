import { randomUUID } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { silentLogger, type Logger } from "./logger.js";
import { requestEndLogFields } from "./log-fields.js";

/** Cabeçalho do id de requisição (specs/016, FR-002). */
export const REQUEST_ID_HEADER = "X-Request-Id";

/** Acrescenta `requestId` a um corpo de resposta (pura, não muta a entrada). */
export function withRequestId<T extends object>(body: T, requestId: string): { requestId: string } & T {
	return { requestId, ...body };
}

/** Id da requisição atual, gravado pelo `requestContext`; `undefined` fora dele. */
export function requestIdOf(res: Response): string | undefined {
	const id: unknown = res.locals.requestId;
	return typeof id === "string" ? id : undefined;
}

export interface RequestContextOptions {
	newId?: () => string;
	logger?: Logger;
	clock?: () => number;
}

/**
 * Middleware do `/chat` (specs/016, research.md §1), montado antes do
 * `express.json()` para cobrir também o JSON malformado: gera o id no servidor
 * (o `X-Request-Id` do cliente é ignorado, FR-003), grava em `res.locals` e no
 * cabeçalho, e loga `chat.request.start`. No `finish`, loga `chat.request.end`
 * com o que o handler deixou em `res.locals` (`errorCode`, `route`, `metrics`).
 */
export function requestContext({ newId = randomUUID, logger = silentLogger, clock = Date.now }: RequestContextOptions = {}): RequestHandler {
	return (req: Request, res: Response, next: NextFunction) => {
		const requestId = newId();
		const t0 = clock();
		res.locals.requestId = requestId;
		res.setHeader(REQUEST_ID_HEADER, requestId);
		logger.info("chat.request.start", { requestId, method: req.method, path: req.originalUrl.split("?")[0] });

		res.on("finish", () => {
			const fields = requestEndLogFields({
				requestId,
				status: res.statusCode,
				durationMs: clock() - t0,
				errorCode: res.locals.errorCode,
				route: res.locals.route,
				metrics: res.locals.metrics,
			});
			if (res.statusCode >= 500) {
				logger.warn("chat.request.end", fields);
			} else {
				logger.info("chat.request.end", fields);
			}
		});
		next();
	};
}

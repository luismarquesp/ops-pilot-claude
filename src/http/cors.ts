import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";

export const CORS_ORIGINS_ENV = "CORS_ORIGINS";

/** `http(s)://host[:port]`, sem caminho, query nem barra final (contracts/cors.md). */
const originSchema = z
	.string()
	.regex(/^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i)
	.transform((origin) => origin.toLowerCase());

/**
 * Lê `CORS_ORIGINS` (pura, specs/018 research §6): vírgula, trim, sem vazios
 * nem repetidos. Itens inválidos são ignorados e a variável entra em `invalid`.
 */
export function parseCorsOrigins(env: Readonly<Record<string, string | undefined>>): { origins: string[]; invalid: string[] } {
	const origins: string[] = [];
	let bad = false;
	for (const item of (env[CORS_ORIGINS_ENV] ?? "").split(",")) {
		const trimmed = item.trim();
		if (!trimmed) {
			continue;
		}
		const parsed = originSchema.safeParse(trimmed);
		if (!parsed.success) {
			bad = true;
			continue;
		}
		if (!origins.includes(parsed.data)) {
			origins.push(parsed.data);
		}
	}
	return { origins, invalid: bad ? [CORS_ORIGINS_ENV] : [] };
}

/**
 * Cabeçalhos CORS de uma requisição (pura). Só origens da lista, por
 * comparação exata em minúsculas; nunca `*` nem credentials.
 */
export function corsHeaders(origin: string | undefined, allowed: readonly string[], method: string): Record<string, string> {
	if (!origin || !allowed.includes(origin.toLowerCase())) {
		return {};
	}
	const base = {
		"Access-Control-Allow-Origin": origin,
		Vary: "Origin",
		"Access-Control-Expose-Headers": "X-Request-Id",
	};
	if (method.toUpperCase() !== "OPTIONS") {
		return base;
	}
	return {
		...base,
		"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Access-Control-Max-Age": "600",
	};
}

/** Aplica `corsHeaders`; todo `OPTIONS` termina em 204 (com ou sem cabeçalhos). */
export function corsMiddleware(allowed: readonly string[]): RequestHandler {
	return (req: Request, res: Response, next: NextFunction) => {
		for (const [name, value] of Object.entries(corsHeaders(req.headers.origin, allowed, req.method))) {
			res.setHeader(name, value);
		}
		if (req.method === "OPTIONS") {
			res.status(204).end();
			return;
		}
		next();
	};
}

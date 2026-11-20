/** Dublês de rede e armazenamento para os testes da web. */
import { vi } from "vitest";
import type { KeyValueStorage } from "../config.js";

export function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Map<string, string> } {
	const data = new Map(Object.entries(initial));
	return {
		data,
		getItem: (k) => data.get(k) ?? null,
		setItem: (k, v) => void data.set(k, v),
		removeItem: (k) => void data.delete(k),
	};
}

export function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-request-id": "hdr" } });
}

type Handler = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;

export function fakeFetch(...handlers: Handler[]) {
	const queue = [...handlers];
	return vi.fn(async (url: string, init?: RequestInit) => {
		const next = queue.shift();
		if (!next) {
			throw new Error(`fetch inesperado: ${url}`);
		}
		return next(url, init);
	});
}

/**
 * Cópia da fixture com o relógio trazido para agora. As fixtures da API têm
 * relógio fixo (`createdAt` 12:00Z, `expiresAt` 12:15Z); sem isso o cartão
 * nasce expirado assim que o dia passa das 12:15Z. Mantém o TTL da fixture.
 */
export function freshFixture<T>(fixture: T, now = Date.now()): T {
	const text = JSON.stringify(fixture);
	const created = /"createdAt":"([^"]+)"/.exec(text)?.[1];
	const shift = created ? now - Date.parse(created) : 0;
	return JSON.parse(text, (key, value: unknown) =>
		(key === "createdAt" || key === "expiresAt") && typeof value === "string" ? new Date(Date.parse(value) + shift).toISOString() : value,
	) as T;
}

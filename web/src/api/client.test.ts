import { describe, expect, test, vi } from "vitest";
import { createApiClient, testConnection } from "./client.js";
import { OK_BODY } from "../test/bodies.js";

function jsonResponse(status: number, body: unknown, requestId = "req-1"): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", "x-request-id": requestId },
	});
}

describe("postChat", () => {
	test("200 → kind ok, com a URL sem barra dupla e o corpo enviado", async () => {
		const fetchMock = vi.fn(async () => jsonResponse(200, OK_BODY));
		const client = createApiClient({ baseUrl: "http://api.test/", fetch: fetchMock });

		const outcome = await client.postChat({ message: "oi", conversationId: "c1" });

		expect(outcome).toEqual({ kind: "ok", data: OK_BODY });
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe("http://api.test/chat");
		expect(JSON.parse(init.body as string)).toEqual({ message: "oi", conversationId: "c1" });
	});

	test("sem conversationId, o campo não é enviado", async () => {
		const fetchMock = vi.fn(async () => jsonResponse(200, OK_BODY));
		await createApiClient({ baseUrl: "http://api.test", fetch: fetchMock }).postChat({ message: "oi" });

		const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(JSON.parse(init.body as string)).toEqual({ message: "oi" });
	});

	test.each([
		[503, { requestId: "r", error: "model_unavailable", modelsTried: ["a"] }, "model_unavailable"],
		[504, { requestId: "r", error: "timeout", timeoutMs: 180000 }, "timeout"],
		[404, { requestId: "r", error: "conversation_not_found", conversationId: "c" }, "conversation_not_found"],
		[500, { requestId: "r", error: "internal_error" }, "internal_error"],
		[400, { requestId: "r", issues: [] }, "validation"],
	])("%i → kind error com código %s", async (status, body, code) => {
		const client = createApiClient({ baseUrl: "http://api.test", fetch: async () => jsonResponse(status, body) });

		const outcome = await client.postChat({ message: "oi" });

		expect(outcome).toMatchObject({ kind: "error", status, code, requestId: "r" });
	});

	test("falha de rede (TypeError) → kind network", async () => {
		const client = createApiClient({
			baseUrl: "http://api.test",
			fetch: async () => {
				throw new TypeError("Failed to fetch");
			},
		});

		expect(await client.postChat({ message: "oi" })).toEqual({ kind: "network" });
	});

	test("corpo fora do contrato → kind invalid com requestId do cabeçalho", async () => {
		const client = createApiClient({ baseUrl: "http://api.test", fetch: async () => jsonResponse(200, { nada: true }, "hdr-9") });

		expect(await client.postChat({ message: "oi" })).toEqual({ kind: "invalid", status: 200, requestId: "hdr-9" });
	});

	test("corpo que nem é JSON → kind invalid", async () => {
		const client = createApiClient({ baseUrl: "http://api.test", fetch: async () => new Response("<html>", { status: 502 }) });

		expect(await client.postChat({ message: "oi" })).toEqual({ kind: "invalid", status: 502, requestId: undefined });
	});

	test("AbortSignal abortado → kind cancelled", async () => {
		const controller = new AbortController();
		const client = createApiClient({
			baseUrl: "http://api.test",
			fetch: (_url, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
				}),
		});

		const pending = client.postChat({ message: "oi" }, controller.signal);
		controller.abort();

		expect(await pending).toEqual({ kind: "cancelled" });
	});
});

describe("testConnection (research §7)", () => {
	test("GET /health 200 → connected", async () => {
		const fetchMock = vi.fn(async (_url: string) => jsonResponse(200, { status: "ok" }));

		expect(await testConnection("http://api.test/", fetchMock)).toEqual({ kind: "connected" });
		expect(fetchMock.mock.calls[0]?.[0]).toBe("http://api.test/health");
	});

	test("falha de CORS: a 1ª tentativa dá TypeError, a 2ª sem CORS resolve → cors_blocked", async () => {
		const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
			if (init?.mode === "no-cors") {
				return new Response(null, { status: 200 });
			}
			throw new TypeError("Failed to fetch");
		});

		expect(await testConnection("http://api.test", fetchMock)).toEqual({ kind: "cors_blocked" });
	});

	test("as duas tentativas falham → unreachable; status inesperado → unexpected", async () => {
		const down = async () => {
			throw new TypeError("Failed to fetch");
		};

		expect(await testConnection("http://api.test", down)).toEqual({ kind: "unreachable" });
		expect(await testConnection("http://api.test", async () => new Response("x", { status: 404 }))).toEqual({ kind: "unexpected", status: 404 });
	});
});

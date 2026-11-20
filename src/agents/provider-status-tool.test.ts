import { test } from "node:test";
import assert from "node:assert/strict";
import { createProviderStatusTool, PROVIDER_STATUS_URLS } from "./provider-status-tool.js";

type QueuedResponse = Response | Error | "hang";

/**
 * `fetch` fake configurável (contracts/provider-status-tool.md) — cada
 * chamada consome a próxima entrada da fila: uma `Response`, um `Error`
 * (falha de rede), ou `"hang"` (nunca resolve por conta própria, só reage ao
 * abort do `AbortSignal.timeout` da tool, igual a um upstream real travado).
 */
function fakeFetch(queue: QueuedResponse[]): { fetchImpl: typeof fetch; calls: string[] } {
	const calls: string[] = [];
	let index = 0;

	const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
		calls.push(String(input));
		const next = queue[index];
		index += 1;
		if (next === undefined) {
			throw new Error("fakeFetch: fila de respostas esgotada");
		}
		if (next === "hang") {
			return new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => reject(new Error("The operation was aborted")));
			});
		}
		if (next instanceof Error) {
			throw next;
		}
		return next;
	}) as typeof fetch;

	return { fetchImpl, calls };
}

function okResponse(indicator: string, description: string): Response {
	return new Response(JSON.stringify({ status: { indicator, description } }), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

function statusResponse(status: number): Response {
	return new Response(JSON.stringify({}), { status, headers: { "content-type": "application/json" } });
}

async function invoke(tool: ReturnType<typeof createProviderStatusTool>, args: Record<string, unknown>) {
	return tool.invoke(args as never) as Promise<string>;
}

// --- User Story 1: checar status de um provedor suportado ---

test("provider omitido consulta a URL do GitHub (default)", async () => {
	const { fetchImpl, calls } = fakeFetch([okResponse("none", "All Systems Operational")]);
	const tool = createProviderStatusTool(fetchImpl);

	await invoke(tool, {});

	assert.equal(calls.length, 1);
	assert.equal(calls[0], PROVIDER_STATUS_URLS.github);
});

test("provider 'cloudflare' consulta a URL do Cloudflare, não a do GitHub", async () => {
	const { fetchImpl, calls } = fakeFetch([okResponse("none", "All Systems Operational")]);
	const tool = createProviderStatusTool(fetchImpl);

	await invoke(tool, { provider: "cloudflare" });

	assert.equal(calls.length, 1);
	assert.equal(calls[0], PROVIDER_STATUS_URLS.cloudflare);
});

test("provider fora do enum rejeita antes de qualquer chamada ao fetchImpl", async () => {
	const { fetchImpl, calls } = fakeFetch([okResponse("none", "All Systems Operational")]);
	const tool = createProviderStatusTool(fetchImpl);

	await assert.rejects(() => tool.invoke({ provider: "aws" } as never));
	assert.equal(calls.length, 0);
});

test("sucesso na 1ª tentativa retorna a linha compacta indicator + description", async () => {
	const { fetchImpl } = fakeFetch([okResponse("major", "Partial System Outage")]);
	const tool = createProviderStatusTool(fetchImpl);

	const result = await invoke(tool, { provider: "github" });

	assert.equal(result, "github: major — Partial System Outage");
});

// --- User Story 2: resposta confiável mesmo com o provedor lento/instável ---

test("falha de rede na 1ª tentativa e sucesso na 2ª retorna normalmente (retry)", async () => {
	const { fetchImpl, calls } = fakeFetch([
		new Error("network down"),
		okResponse("none", "All Systems Operational"),
	]);
	const tool = createProviderStatusTool(fetchImpl);

	const result = await invoke(tool, { provider: "github" });

	assert.equal(result, "github: none — All Systems Operational");
	assert.equal(calls.length, 2);
});

test("HTTP 500 nas duas tentativas retorna erro legível, fetchImpl chamado 2x", async () => {
	const { fetchImpl, calls } = fakeFetch([statusResponse(500), statusResponse(500)]);
	const tool = createProviderStatusTool(fetchImpl);

	const result = await invoke(tool, { provider: "cloudflare" });

	assert.match(result, /^Erro: /);
	assert.equal(calls.length, 2);
});

test("fetchImpl que nunca resolve (respeita o abort) retorna erro em vez de travar o teste", async () => {
	const { fetchImpl, calls } = fakeFetch(["hang", "hang"]);
	const tool = createProviderStatusTool(fetchImpl);

	const result = await invoke(tool, { provider: "github" });

	assert.match(result, /^Erro: /);
	assert.equal(calls.length, 2);
});

test("HTTP 404 retorna erro imediatamente, fetchImpl chamado 1x (sem retentativa)", async () => {
	const { fetchImpl, calls } = fakeFetch([statusResponse(404), okResponse("none", "não deveria ser usada")]);
	const tool = createProviderStatusTool(fetchImpl);

	const result = await invoke(tool, { provider: "github" });

	assert.match(result, /^Erro: /);
	assert.equal(calls.length, 1);
});

test("resposta fora do schema Zod retorna erro imediatamente, fetchImpl chamado 1x (sem retentativa)", async () => {
	const invalidBody = new Response(JSON.stringify({ status: { indicator: "apocalyptic", description: "x" } }), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
	const { fetchImpl, calls } = fakeFetch([invalidBody, okResponse("none", "não deveria ser usada")]);
	const tool = createProviderStatusTool(fetchImpl);

	const result = await invoke(tool, { provider: "github" });

	assert.match(result, /^Erro: /);
	assert.equal(calls.length, 1);
});

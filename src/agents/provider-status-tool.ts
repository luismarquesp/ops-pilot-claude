import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

export const PROVIDERS = ["github", "cloudflare"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const STATUS_INDICATORS = ["none", "minor", "major", "critical"] as const;
export type StatusIndicator = (typeof STATUS_INDICATORS)[number];

/** Endpoint público da statuspage.io de cada provedor — sem chave/autenticação. */
export const PROVIDER_STATUS_URLS: Record<Provider, string> = {
	github: "https://www.githubstatus.com/api/v2/status.json",
	cloudflare: "https://www.cloudflarestatus.com/api/v2/status.json",
};

const TIMEOUT_MS = 5000;

const statusPageResponseSchema = z.object({
	status: z.object({
		indicator: z.enum(STATUS_INDICATORS),
		description: z.string(),
	}),
});

/**
 * Passo de transporte: uma tentativa de `fetch` com teto de tempo. HTTP `5xx`
 * é tratado como falha passageira (lança) — `4xx` é devolvido normalmente
 * (research.md §2: só rede/5xx são retentados, nunca 4xx nem resposta
 * inválida).
 */
async function fetchOnce(provider: Provider, fetchImpl: typeof fetch): Promise<Response> {
	const response = await fetchImpl(PROVIDER_STATUS_URLS[provider], {
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (response.status >= 500) {
		throw new Error(`upstream respondeu ${response.status}`);
	}
	return response;
}

/** Uma única retentativa automática para falha de rede/timeout/5xx (contracts/provider-status-tool.md). */
async function fetchWithOneRetry(provider: Provider, fetchImpl: typeof fetch): Promise<Response> {
	try {
		return await fetchOnce(provider, fetchImpl);
	} catch {
		return await fetchOnce(provider, fetchImpl);
	}
}

function formatError(provider: Provider, error: unknown): string {
	const motivo = error instanceof Error ? error.message : String(error);
	return (
		`Erro: não foi possível consultar o status do ${provider} (${motivo}). ` +
		"Responda com base em outras informações disponíveis (alertas/incidentes internos) " +
		"e avise o plantonista dessa limitação."
	);
}

/**
 * Consulta o status público de um provedor externo (data-model.md) — passo
 * de transporte com retry isolado do passo de interpretação (json + Zod),
 * que nunca é retentado (contracts/provider-status-tool.md, casos 8-9).
 */
async function fetchProviderStatus(provider: Provider, fetchImpl: typeof fetch): Promise<string> {
	let response: Response;
	try {
		response = await fetchWithOneRetry(provider, fetchImpl);
	} catch (error) {
		return formatError(provider, error);
	}

	if (!response.ok) {
		return formatError(provider, new Error(`HTTP ${response.status}`));
	}

	try {
		const json = await response.json();
		const { status } = statusPageResponseSchema.parse(json);
		return `${provider}: ${status.indicator} — ${status.description}`;
	} catch (error) {
		return formatError(provider, error);
	}
}

/**
 * Tool sem dependência de `OpsStore` (plan.md) — erro nunca escapa como
 * exceção, sempre volta como string `"Erro: ..."` (Constitution Princípio IV).
 */
export function createProviderStatusTool(fetchImpl: typeof fetch = fetch): StructuredToolInterface {
	return tool(
		async ({ provider }: { provider: Provider }) => fetchProviderStatus(provider, fetchImpl),
		{
			name: "check_provider_status",
			description:
				"Consulta o status público de um provedor externo (GitHub ou Cloudflare). Use quando " +
				"houver suspeita de problema externo/upstream durante um incidente — 'é o nosso ou é do " +
				"provedor?', uma dependência aparentemente fora do ar. Não abre nem altera nenhum " +
				"incidente interno — para isso, use open_incident/list_incidents.",
			schema: z.object({
				provider: z
					.enum(PROVIDERS)
					.default("github")
					.describe("Provedor externo a consultar. Default: github."),
			}),
		},
	);
}

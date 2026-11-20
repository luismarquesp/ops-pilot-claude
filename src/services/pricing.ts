import { z } from "zod";

/** Preço em USD por 1M tokens de prompt, por id de modelo (specs/017). */
export type ModelPrices = ReadonlyMap<string, number>;

export const MODEL_PRICES_ENV = "MODEL_PRICES";

/** Ids `:free` do OpenRouter e o roteador gratuito `openrouter/free` custam 0 (pura). */
export function isFreeModel(modelId: string): boolean {
	return modelId.endsWith(":free") || modelId === "openrouter/free";
}

const priceSchema = z.coerce.number().finite().nonnegative();

/**
 * Lê `MODEL_PRICES` (`id=usdPor1M,...`; pura). Entradas vazias somem; inválidas
 * são ignoradas e a variável entra em `invalid` (o aviso cita só o nome).
 */
export function parseModelPrices(env: Readonly<Record<string, string | undefined>>): { prices: Map<string, number>; invalid: string[] } {
	const prices = new Map<string, number>();
	let bad = false;
	for (const entry of (env[MODEL_PRICES_ENV] ?? "").split(",")) {
		const trimmed = entry.trim();
		if (!trimmed) {
			continue;
		}
		const at = trimmed.lastIndexOf("=");
		const id = at > 0 ? trimmed.slice(0, at).trim() : "";
		const raw = at > 0 ? trimmed.slice(at + 1).trim() : "";
		const parsed = priceSchema.safeParse(raw);
		if (!id || !raw || !parsed.success) {
			bad = true;
			continue;
		}
		prices.set(id, parsed.data);
	}
	return { prices, invalid: bad ? [MODEL_PRICES_ENV] : [] };
}

/**
 * Custo estimado de um turno (pura): sem modelo e sem tokens → 0 (nada chamado);
 * gratuito → 0; com preço e tokens → `tokens × preço / 1e6`; senão `null` (desconhecido).
 */
export function requestCost({ modelUsed, promptTokens }: { modelUsed: string | null; promptTokens: number | null }, prices: ModelPrices): number | null {
	if (modelUsed === null) {
		return promptTokens ? null : 0;
	}
	if (isFreeModel(modelUsed)) {
		return 0;
	}
	const price = prices.get(modelUsed);
	if (price === undefined || promptTokens === null) {
		return null;
	}
	return (promptTokens * price) / 1_000_000;
}

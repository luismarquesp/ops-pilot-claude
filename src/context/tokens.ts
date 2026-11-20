/**
 * Estimativa grosseira de tokens (specs/011, research.md §1): `ceil(chars / 4)`.
 * Função pura, determinística e sem tokenizador — serve para comparar fontes
 * de contexto, não para cobrar.
 */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/** Uso informado pelo provedor em uma chamada ao modelo (data-model.md). */
export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
	return typeof value === "object" && value !== null ? (value as UnknownRecord) : undefined;
}

function isCount(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function toUsage(input: unknown, output: unknown, total: unknown): TokenUsage | undefined {
	if (!isCount(input)) {
		return undefined;
	}
	const outputTokens = isCount(output) ? output : 0;
	return { inputTokens: input, outputTokens, totalTokens: isCount(total) ? total : input + outputTokens };
}

/**
 * Função pura (research.md §2): extrai o uso real de um `LLMResult` do
 * LangChain. Prefere o `usage_metadata` padronizado da mensagem gerada e cai
 * para o `llmOutput.tokenUsage` legado do `ChatOpenAI` — nunca soma os dois.
 * Sem uso, ou com dados malformados, devolve `undefined`.
 */
export function usageFromLLMResult(output: unknown): TokenUsage | undefined {
	const result = asRecord(output);
	const generations = Array.isArray(result?.generations) ? result.generations : [];
	const first: unknown = Array.isArray(generations[0]) ? generations[0][0] : undefined;
	const metadata = asRecord(asRecord(asRecord(first)?.message)?.usage_metadata);
	if (metadata) {
		return toUsage(metadata.input_tokens, metadata.output_tokens, metadata.total_tokens);
	}

	const legacy = asRecord(asRecord(result?.llmOutput)?.tokenUsage);
	if (legacy) {
		return toUsage(legacy.promptTokens, legacy.completionTokens, legacy.totalTokens);
	}
	return undefined;
}

/**
 * Função pura (research.md §5): tokens de entrada do turno, somando todas as
 * chamadas. `null` quando nenhuma chamada informou uso — "não sei", não "zero".
 */
export function promptTokensOf(calls: readonly TokenUsage[]): number | null {
	if (calls.length === 0) {
		return null;
	}
	return calls.reduce((sum, call) => sum + call.inputTokens, 0);
}

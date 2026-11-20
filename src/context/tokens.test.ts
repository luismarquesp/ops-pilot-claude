import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateTokens, promptTokensOf, usageFromLLMResult } from "./tokens.js";

test("estimateTokens arredonda chars/4 para cima, com vazio valendo 0", () => {
	assert.equal(estimateTokens(""), 0);
	assert.equal(estimateTokens("a"), 1);
	assert.equal(estimateTokens("abcd"), 1);
	assert.equal(estimateTokens("abcde"), 2);
	assert.equal(estimateTokens("x".repeat(400)), 100);
});

test("estimateTokens conta acentos pelo comprimento do texto e é determinística", () => {
	assert.equal(estimateTokens("ação"), 1);
	assert.equal(estimateTokens("ação rápida"), estimateTokens("ação rápida"));
});

/** `LLMResult` mínimo com uma geração cuja mensagem carrega `usage_metadata`. */
const withUsageMetadata = (usage: unknown, llmOutput?: unknown) => ({
	generations: [[{ text: "", message: { usage_metadata: usage } }]],
	llmOutput,
});

test("usageFromLLMResult lê o usage_metadata padronizado da mensagem", () => {
	assert.deepEqual(usageFromLLMResult(withUsageMetadata({ input_tokens: 10, output_tokens: 5, total_tokens: 15 })), {
		inputTokens: 10,
		outputTokens: 5,
		totalTokens: 15,
	});
});

test("usageFromLLMResult cai para o tokenUsage legado do llmOutput", () => {
	const output = { generations: [[{ text: "" }]], llmOutput: { tokenUsage: { promptTokens: 7, completionTokens: 3, totalTokens: 10 } } };

	assert.deepEqual(usageFromLLMResult(output), { inputTokens: 7, outputTokens: 3, totalTokens: 10 });
});

test("usageFromLLMResult com os dois formatos usa só o usage_metadata, sem somar", () => {
	const output = withUsageMetadata(
		{ input_tokens: 10, output_tokens: 5, total_tokens: 15 },
		{ tokenUsage: { promptTokens: 99, completionTokens: 1, totalTokens: 100 } },
	);

	assert.deepEqual(usageFromLLMResult(output), { inputTokens: 10, outputTokens: 5, totalTokens: 15 });
});

test("usageFromLLMResult completa saída e total ausentes", () => {
	assert.deepEqual(usageFromLLMResult(withUsageMetadata({ input_tokens: 10 })), {
		inputTokens: 10,
		outputTokens: 0,
		totalTokens: 10,
	});
	assert.deepEqual(usageFromLLMResult(withUsageMetadata({ input_tokens: 10, output_tokens: 4 })), {
		inputTokens: 10,
		outputTokens: 4,
		totalTokens: 14,
	});
});

test("usageFromLLMResult devolve undefined sem uso ou com dados malformados", () => {
	assert.equal(usageFromLLMResult({ generations: [[{ text: "" }]] }), undefined);
	assert.equal(usageFromLLMResult({ generations: [] }), undefined);
	assert.equal(usageFromLLMResult({ generations: [[{ text: "", message: undefined }]] }), undefined);
	assert.equal(usageFromLLMResult(withUsageMetadata({ input_tokens: "x" })), undefined);
	assert.equal(usageFromLLMResult(withUsageMetadata({ input_tokens: -1 })), undefined);
	assert.equal(usageFromLLMResult(withUsageMetadata({ input_tokens: 1.5 })), undefined);
	assert.equal(usageFromLLMResult(null), undefined);
	assert.equal(usageFromLLMResult("lixo"), undefined);
});

test("promptTokensOf soma os tokens de entrada e devolve null sem chamadas", () => {
	assert.equal(promptTokensOf([]), null);
	assert.equal(
		promptTokensOf([
			{ inputTokens: 10, outputTokens: 1, totalTokens: 11 },
			{ inputTokens: 32, outputTokens: 2, totalTokens: 34 },
		]),
		42,
	);
});

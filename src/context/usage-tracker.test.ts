import { test } from "node:test";
import assert from "node:assert/strict";
import { recordUsage, trackUsage, usageCallbacks } from "./usage-tracker.js";
import type { TokenUsage } from "./tokens.js";

const usage = (inputTokens: number): TokenUsage => ({ inputTokens, outputTokens: 1, totalTokens: inputTokens + 1 });

/** `LLMResult` falso, no formato que o `ChatOpenAI` entrega ao `handleLLMEnd`. */
const llmResult = (inputTokens: number) => ({
	generations: [[{ text: "", message: { usage_metadata: { input_tokens: inputTokens, output_tokens: 1, total_tokens: inputTokens + 1 } } }]],
});

const tick = (ms = 1) => new Promise((resolve) => setTimeout(resolve, ms));

test("trackUsage devolve o valor de fn e o uso registrado dentro dela", async () => {
	const { value, usage: calls } = await trackUsage(async () => {
		recordUsage(usage(10));
		await tick();
		recordUsage(usage(20));
		return "pronto";
	});

	assert.equal(value, "pronto");
	assert.deepEqual(calls, [usage(10), usage(20)]);
});

test("recordUsage fora de escopo é no-op e não vaza para escopos seguintes", async () => {
	recordUsage(usage(99));

	const { usage: calls } = await trackUsage(async () => "x");

	assert.deepEqual(calls, []);
});

test("trackUsage concorrentes não misturam o uso", async () => {
	const turn = (inputTokens: number, delay: number) =>
		trackUsage(async () => {
			await tick(delay);
			recordUsage(usage(inputTokens));
			await tick(delay);
			recordUsage(usage(inputTokens));
		});

	const [a, b] = await Promise.all([turn(1, 5), turn(1000, 1)]);

	assert.deepEqual(a.usage, [usage(1), usage(1)]);
	assert.deepEqual(b.usage, [usage(1000), usage(1000)]);
});

test("usageCallbacks fora de escopo devolve undefined", () => {
	assert.equal(usageCallbacks(), undefined);
});

test("handler de usageCallbacks é aguardado e soma no escopo em que foi criado", async () => {
	let handler: NonNullable<ReturnType<typeof usageCallbacks>>[number] | undefined;

	const first = await trackUsage(async () => {
		handler = usageCallbacks()?.[0];
		assert.equal(handler?.awaitHandlers, true);
		await handler?.handleLLMEnd?.(llmResult(10) as never, "run-1");
	});
	const second = await trackUsage(async () => {
		// Disparado de dentro de outro escopo (e depois do primeiro fechar): conta no primeiro.
		await handler?.handleLLMEnd?.(llmResult(5) as never, "run-2");
	});

	assert.deepEqual(first.usage, [usage(10), usage(5)]);
	assert.deepEqual(second.usage, []);
});

test("handler ignora resultado sem uso ou malformado, sem lançar", async () => {
	const { usage: calls } = await trackUsage(async () => {
		const handler = usageCallbacks()?.[0];
		await handler?.handleLLMEnd?.({ generations: [[{ text: "" }]] } as never, "run-1");
		await handler?.handleLLMEnd?.(null as never, "run-2");
	});

	assert.deepEqual(calls, []);
});

test("trackUsage propaga a rejeição de fn", async () => {
	await assert.rejects(
		() =>
			trackUsage(async () => {
				throw new Error("boom");
			}),
		/boom/,
	);
});

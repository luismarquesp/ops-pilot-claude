import { test } from "node:test";
import assert from "node:assert/strict";
import { modelCallCount, modelCallsSince, recordModelCall, trackModelCalls, type ModelCall } from "./model-calls.js";

const call = (modelUsed: string, switches: ModelCall["switches"] = []): ModelCall => ({ modelUsed, switches });

const tick = (ms = 1) => new Promise((resolve) => setTimeout(resolve, ms));

test("trackModelCalls devolve o valor de fn e as chamadas registradas, na ordem", async () => {
	const { value, calls } = await trackModelCalls(async () => {
		recordModelCall(call("a"));
		await tick();
		recordModelCall(call("b", [{ from: "a", to: "b", reason: "RateLimitError" }]));
		return "pronto";
	});

	assert.equal(value, "pronto");
	assert.deepEqual(calls, [call("a"), call("b", [{ from: "a", to: "b", reason: "RateLimitError" }])]);
});

test("fora de escopo: recordModelCall é no-op e não vaza para o próximo escopo", async () => {
	recordModelCall(call("x"));

	assert.equal(modelCallCount(), 0);
	assert.deepEqual(modelCallsSince(0), []);
	const { calls } = await trackModelCalls(async () => "ok");
	assert.deepEqual(calls, []);
});

test("modelCallsSince devolve só as chamadas depois da marca", async () => {
	await trackModelCalls(async () => {
		recordModelCall(call("a"));
		const mark = modelCallCount();
		recordModelCall(call("b"));
		recordModelCall(call("c"));

		assert.equal(mark, 1);
		assert.deepEqual(modelCallsSince(mark), [call("b"), call("c")]);
	});
});

test("escopos concorrentes não se misturam", async () => {
	const turn = (model: string, delay: number) =>
		trackModelCalls(async () => {
			await tick(delay);
			recordModelCall(call(model));
			await tick(delay);
			recordModelCall(call(model));
		});

	const [slow, fast] = await Promise.all([turn("lento", 5), turn("rapido", 1)]);

	assert.deepEqual(slow.calls, [call("lento"), call("lento")]);
	assert.deepEqual(fast.calls, [call("rapido"), call("rapido")]);
});

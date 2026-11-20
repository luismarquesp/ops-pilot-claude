import { test } from "node:test";
import assert from "node:assert/strict";
import { isFreeModel, parseModelPrices, requestCost } from "./pricing.js";

test("isFreeModel: sufixo :free e o roteador openrouter/free", () => {
	assert.equal(isFreeModel("meta-llama/llama-3.3-70b-instruct:free"), true);
	assert.equal(isFreeModel("openrouter/free"), true);
	assert.equal(isFreeModel("openai/gpt-4o-mini"), false);
	assert.equal(isFreeModel("free/modelo"), false);
});

test("parseModelPrices: id=preço separados por vírgula, trim, sem vazios", () => {
	const { prices, invalid } = parseModelPrices({ MODEL_PRICES: " openai/gpt-4o-mini=0.15 , anthropic/claude=3,, " });

	assert.deepEqual([...prices], [
		["openai/gpt-4o-mini", 0.15],
		["anthropic/claude", 3],
	]);
	assert.deepEqual(invalid, []);
});

test("parseModelPrices: vazio → mapa vazio; entrada inválida é ignorada e aponta a variável", () => {
	assert.equal(parseModelPrices({}).prices.size, 0);

	const { prices, invalid } = parseModelPrices({ MODEL_PRICES: "a=1,b=-2,c=x,semigual,=3" });

	assert.deepEqual([...prices], [["a", 1]]);
	assert.deepEqual(invalid, ["MODEL_PRICES"]);
});

test("requestCost: gratuito → 0, com preço → tokens × preço / 1e6, desconhecido → null", () => {
	const prices = new Map([["pago", 2]]);

	assert.equal(requestCost({ modelUsed: "x:free", promptTokens: 5000 }, prices), 0);
	assert.equal(requestCost({ modelUsed: "pago", promptTokens: 1500 }, prices), 0.003);
	assert.equal(requestCost({ modelUsed: "sem-preco", promptTokens: 10 }, prices), null);
	assert.equal(requestCost({ modelUsed: "pago", promptTokens: null }, prices), null);
	assert.equal(requestCost({ modelUsed: null, promptTokens: null }, prices), 0);
});

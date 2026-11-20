import { test } from "node:test";
import assert from "node:assert/strict";
import { parseModelChain } from "./model.js";

test("parseModelChain sem reservas devolve só o principal", () => {
	assert.deepEqual(parseModelChain({ OPEN_ROUTER_MODEL: "a" }), { primary: "a", fallbacks: [] });
});

test("parseModelChain normaliza as reservas: trim, sem vazios, sem repetidos e sem o principal", () => {
	assert.deepEqual(parseModelChain({ OPEN_ROUTER_MODEL: "a", OPENROUTER_MODEL_FALLBACK: " b , ,c,b, a " }), {
		primary: "a",
		fallbacks: ["b", "c"],
	});
});

test("parseModelChain com variáveis ausentes mantém o comportamento atual", () => {
	assert.deepEqual(parseModelChain({}), { primary: "", fallbacks: [] });
});

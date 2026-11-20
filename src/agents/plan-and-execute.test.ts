import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_STEPS, shouldContinue } from "./plan-and-execute.js";

test("nunca continua além do teto de 8 passos, mesmo com passos restantes", () => {
	assert.equal(shouldContinue(MAX_STEPS, ["mais um passo"]), false);
	assert.equal(shouldContinue(MAX_STEPS + 1, ["mais um passo"]), false);
});

test("continua quando há passos restantes e o teto não foi atingido", () => {
	assert.equal(shouldContinue(0, ["primeiro passo"]), true);
	assert.equal(shouldContinue(MAX_STEPS - 1, ["último passo"]), true);
});

test("não continua quando não há passos restantes, mesmo abaixo do teto", () => {
	assert.equal(shouldContinue(0, []), false);
	assert.equal(shouldContinue(3, []), false);
});

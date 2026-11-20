import { test } from "node:test";
import assert from "node:assert/strict";
import { formatQuestionWithMemory } from "./memory-prompt.js";

const facts = [{ fact: "sou do time de pagamentos" }, { fact: "prefiro respostas curtas" }];

test("formatQuestionWithMemory sem fatos devolve a pergunta inalterada", () => {
	assert.equal(formatQuestionWithMemory([], "quais alertas?"), "quais alertas?");
});

test("formatQuestionWithMemory lista os fatos (sem id), na ordem recebida, antes da pergunta", () => {
	assert.equal(
		formatQuestionWithMemory(facts, "quais alertas?"),
		"Fatos lembrados sobre este usuário (mais relevante primeiro):\n" +
			"- sou do time de pagamentos\n" +
			"- prefiro respostas curtas\n\n" +
			"quais alertas?",
	);
});

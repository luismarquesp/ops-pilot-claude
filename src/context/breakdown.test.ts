import { test } from "node:test";
import assert from "node:assert/strict";
import { contextBreakdown } from "./breakdown.js";
import { estimateTokens } from "./tokens.js";
import { formatQuestionWithHistory, formatSummaryBlock, type HistoryMessage } from "../agents/history.js";
import { formatQuestionWithMemory, type PromptFact } from "../memory/memory-prompt.js";

const history: HistoryMessage[] = [
	{ role: "user", content: "quais alertas estão disparando?" },
	{ role: "assistant", content: "Há 2 alertas firing no checkout." },
];
const facts: PromptFact[] = [{ fact: "é responsável pelo checkout" }];
const question = "e o runbook do checkout?";

test("contextBreakdown sem histórico e sem fatos conta só a pergunta", () => {
	assert.deepEqual(contextBreakdown(question, [], []), {
		question: estimateTokens(question),
		history: 0,
		memory: 0,
		summary: 0,
		total: estimateTokens(question),
	});
});

test("contextBreakdown estima o bloco que cada fonte acrescenta, com total igual à soma", () => {
	const breakdown = contextBreakdown(question, history, facts);

	assert.equal(breakdown.question, estimateTokens(question));
	assert.equal(breakdown.history, estimateTokens(formatQuestionWithHistory(history, "")));
	assert.equal(breakdown.memory, estimateTokens(formatQuestionWithMemory(facts, "")));
	assert.ok(breakdown.history > 0 && breakdown.memory > 0);
	assert.equal(breakdown.total, breakdown.question + breakdown.history + breakdown.memory);
});

test("os blocos estimados particionam exatamente o prompt montado pelo buildContext, na ordem real", () => {
	// buildContext (specs/013) formata histórico + resumo primeiro e prefixa os fatos por fora.
	const summary = "- rollback do checkout aprovado";
	const assembled = formatQuestionWithMemory(facts, formatQuestionWithHistory(history, question, summary));

	assert.equal(
		formatQuestionWithMemory(facts, "") + formatSummaryBlock(summary) + formatQuestionWithHistory(history, "") + question,
		assembled,
	);
});

test("contextBreakdown estima o resumo como fonte própria, fora do histórico", () => {
	const summary = "- rollback do checkout aprovado";
	const breakdown = contextBreakdown(question, history, facts, summary);

	assert.equal(breakdown.summary, estimateTokens(formatSummaryBlock(summary)));
	assert.equal(breakdown.history, estimateTokens(formatQuestionWithHistory(history, "")));
	assert.equal(breakdown.total, breakdown.question + breakdown.history + breakdown.memory + breakdown.summary);
	assert.equal(contextBreakdown(question, history, facts).summary, 0);
});

test("contextBreakdown é determinística", () => {
	assert.deepEqual(contextBreakdown(question, history, facts), contextBreakdown(question, history, facts));
});

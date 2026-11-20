import { test } from "node:test";
import assert from "node:assert/strict";
import { formatQuestionWithHistory, formatSummaryBlock, planHistory, type HistoryMessage } from "./history.js";

test("formatQuestionWithHistory com histórico vazio devolve a pergunta inalterada", () => {
	assert.equal(formatQuestionWithHistory([], "quais alertas?"), "quais alertas?");
});

test("formatQuestionWithHistory prefixa o histórico, mais antigo primeiro, e marca a pergunta atual", () => {
	const question = formatQuestionWithHistory(
		[
			{ role: "user", content: "quais alertas?" },
			{ role: "assistant", content: "checkout e payments" },
		],
		"abre um incidente para o segundo",
	);

	assert.equal(
		question,
		"Histórico recente desta conversa (mais antigo primeiro):\n" +
			"Plantonista: quais alertas?\n" +
			"OpsPilot: checkout e payments\n" +
			"\n" +
			"Pergunta atual: abre um incidente para o segundo",
	);
});

// --- Sumarização (specs/012) ---

const range = (count: number): number[] => Array.from({ length: count }, (_, index) => index + 1);

test("planHistory não resume enquanto houver menos de 8 pendentes fora da janela de 8", () => {
	for (const count of [0, 8, 15]) {
		assert.deepEqual(planHistory(range(count)), { toSummarize: [], recent: range(count) }, `count=${count}`);
	}
});

test("planHistory com 8 ou mais pendentes resume todas elas e mantém as 8 mais recentes", () => {
	assert.deepEqual(planHistory(range(16)), { toSummarize: range(8), recent: range(16).slice(8) });
	assert.deepEqual(planHistory(range(17)), { toSummarize: range(9), recent: range(17).slice(9) });
	assert.deepEqual(planHistory(range(40)), { toSummarize: range(32), recent: range(40).slice(32) });
});

test("planHistory respeita janela e lote customizados", () => {
	assert.deepEqual(planHistory(range(5), { window: 2, batch: 3 }), { toSummarize: [1, 2, 3], recent: [4, 5] });
	assert.deepEqual(planHistory(range(4), { window: 2, batch: 3 }), { toSummarize: [], recent: range(4) });
});

test("formatSummaryBlock sem resumo é vazio e com resumo traz o cabeçalho", () => {
	assert.equal(formatSummaryBlock(undefined), "");
	assert.equal(formatSummaryBlock(""), "");
	assert.equal(formatSummaryBlock("resumo X"), "Resumo da conversa até aqui:\nresumo X\n\n");
});

const SHORT_HISTORY: HistoryMessage[] = [
	{ role: "user", content: "p1" },
	{ role: "assistant", content: "r1" },
];

test("formatQuestionWithHistory com resumo emite o resumo antes do histórico", () => {
	const formatted = formatQuestionWithHistory(SHORT_HISTORY, "p2", "resumo X");

	assert.equal(formatted, formatSummaryBlock("resumo X") + formatQuestionWithHistory(SHORT_HISTORY, "p2"));
	assert.ok(formatted.endsWith("Pergunta atual: p2"));
});

test("formatQuestionWithHistory com resumo e sem histórico traz só o resumo e a pergunta", () => {
	assert.equal(formatQuestionWithHistory([], "p2", "resumo X"), "Resumo da conversa até aqui:\nresumo X\n\np2");
});

test("formatQuestionWithHistory sem resumo mantém a saída de antes", () => {
	assert.equal(formatQuestionWithHistory(SHORT_HISTORY, "p2", undefined), formatQuestionWithHistory(SHORT_HISTORY, "p2"));
});


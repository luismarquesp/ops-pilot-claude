import { test } from "node:test";
import assert from "node:assert/strict";
import { buildContext, DEFAULT_CONTEXT_BUDGET, parseContextBudget, type BudgetFact, type ContextBudget } from "./context-builder.js";
import { contextBreakdown } from "./breakdown.js";
import { estimateTokens } from "./tokens.js";
import { formatQuestionWithHistory, formatSummaryBlock, type HistoryMessage } from "../agents/history.js";
import { formatQuestionWithMemory } from "../memory/memory-prompt.js";

const question = "e o runbook do checkout?";
const history: HistoryMessage[] = [
	{ role: "user", content: "msg-1 quais alertas estão disparando?" },
	{ role: "assistant", content: "msg-2 há 2 alertas firing no checkout" },
	{ role: "user", content: "msg-3 abre um incidente" },
	{ role: "assistant", content: "msg-4 incidente aberto" },
	{ role: "user", content: "msg-5 quem está de plantão?" },
	{ role: "assistant", content: "msg-6 o time de pagamentos" },
];
const facts: BudgetFact[] = [
	{ fact: "fato-A é responsável pelo checkout", score: 0.9 },
	{ fact: "fato-B prefere respostas curtas", score: 0.4 },
	{ fact: "fato-C usa postgres", score: 0.7 },
];
const summary = "- linha 1 rollback aprovado\n- linha 2 DBA acionado\n- linha 3 pendente: postmortem";

/** Orçamento com tetos folgados, exceto os sobrescritos. */
function budget(overrides: Partial<ContextBudget>): ContextBudget {
	return { summary: 10_000, window: 10_000, memory: 10_000, ...overrides };
}

const historyTokens = (messages: readonly HistoryMessage[]) => estimateTokens(formatQuestionWithHistory(messages, ""));
const memoryTokens = (kept: readonly BudgetFact[]) => estimateTokens(formatQuestionWithMemory(kept, ""));
const summaryTokens = (text: string) => estimateTokens(formatSummaryBlock(text));

test("buildContext abaixo dos tetos padrão monta o mesmo prompt da composição anterior, sem cortes", () => {
	const built = buildContext({ question, facts, summary, history });

	assert.equal(built.prompt, formatQuestionWithMemory(facts, formatQuestionWithHistory(history, question, summary)));
	assert.deepEqual(built.trimmed, { historyMessages: 0, memoryFacts: 0, summaryTruncated: false });
	assert.deepEqual(built.facts, facts);
	assert.deepEqual(built.history, history);
	assert.equal(built.summary, summary);
});

test("buildContext sem fatos, resumo e histórico devolve só a pergunta", () => {
	const built = buildContext({ question, facts: [], history: [] });

	assert.equal(built.prompt, question);
	assert.deepEqual(built.breakdown, contextBreakdown(question, [], []));
});

test("janela acima do teto perde as mensagens mais antigas, inteiras e na ordem", () => {
	const lastThree = history.slice(-3);
	const built = buildContext({ question, facts: [], history }, budget({ window: historyTokens(lastThree) }));

	assert.deepEqual(built.history, lastThree);
	assert.equal(built.trimmed.historyMessages, 3);
	assert.ok(built.breakdown.history <= historyTokens(lastThree));
	for (const dropped of ["msg-1", "msg-2", "msg-3"]) {
		assert.ok(!built.prompt.includes(dropped), `${dropped} deveria ter sido cortada`);
	}
	assert.ok(built.prompt.endsWith(question));
});

test("mensagem mais recente maior que a janela também sai: janela vazia, sem cabeçalho", () => {
	const built = buildContext({ question, facts: [], history }, budget({ window: historyTokens(history.slice(-1)) - 1 }));

	assert.deepEqual(built.history, []);
	assert.equal(built.trimmed.historyMessages, history.length);
	assert.equal(built.prompt, question);
	assert.ok(!built.prompt.includes("Histórico recente"));
});

test("memória acima do teto perde o fato de menor score, não o último da lista", () => {
	const two = buildContext({ question, facts, history: [] }, budget({ memory: memoryTokens([facts[0]!, facts[2]!]) }));
	assert.deepEqual(two.facts.map((kept) => kept.fact), [facts[0]!.fact, facts[2]!.fact]);
	assert.equal(two.trimmed.memoryFacts, 1);

	const one = buildContext({ question, facts, history: [] }, budget({ memory: memoryTokens([facts[0]!]) }));
	assert.deepEqual(one.facts.map((kept) => kept.fact), [facts[0]!.fact]);
	assert.equal(one.trimmed.memoryFacts, 2);
	assert.ok(one.breakdown.memory <= memoryTokens([facts[0]!]));
});

test("empate de score na fronteira: sai o que vem por último na entrada", () => {
	const tied: BudgetFact[] = [
		{ fact: "fato-X primeiro", score: 0.5 },
		{ fact: "fato-Y segundo", score: 0.5 },
	];
	const built = buildContext({ question, facts: tied, history: [] }, budget({ memory: memoryTokens([tied[0]!]) }));

	assert.deepEqual(built.facts, [tied[0]]);
});

test("resumo acima do teto é encurtado no fim de uma linha, mantendo o início", () => {
	const twoLines = "- linha 1 rollback aprovado\n- linha 2 DBA acionado";
	const built = buildContext({ question, facts: [], summary, history: [] }, budget({ summary: summaryTokens(twoLines) }));

	assert.equal(built.summary, twoLines);
	assert.equal(built.trimmed.summaryTruncated, true);
	assert.ok(built.breakdown.summary <= summaryTokens(twoLines));
	assert.ok(!built.prompt.includes("linha 3"));
});

test("resumo de uma linha só é cortado seco em caractere, dentro do teto", () => {
	const oneLine = "rollback do checkout aprovado e DBA acionado; pendente o postmortem do incidente";
	const limit = summaryTokens(oneLine) - 5;
	const built = buildContext({ question, facts: [], summary: oneLine, history: [] }, budget({ summary: limit }));

	assert.ok(built.summary && built.summary.length > 0 && oneLine.startsWith(built.summary));
	assert.ok(built.breakdown.summary <= limit);
	assert.equal(built.trimmed.summaryTruncated, true);
});

test("teto que não cabe nem o cabeçalho remove o resumo do prompt", () => {
	const built = buildContext({ question, facts: [], summary, history: [] }, budget({ summary: 1 }));

	assert.equal(built.summary, undefined);
	assert.equal(built.trimmed.summaryTruncated, true);
	assert.ok(!built.prompt.includes("Resumo da conversa"));
});

test("pergunta nunca é cortada, mesmo maior que todos os tetos zerados", () => {
	const huge = "x".repeat(10_000);
	const built = buildContext({ question: huge, facts, summary, history }, { summary: 0, window: 0, memory: 0 });

	assert.equal(built.prompt, huge);
	assert.deepEqual(built.trimmed, { historyMessages: history.length, memoryFacts: facts.length, summaryTruncated: true });
});

test("seções são independentes: cortar a janela não mexe em fatos nem resumo", () => {
	const built = buildContext({ question, facts, summary, history }, budget({ window: historyTokens(history.slice(-2)) }));

	assert.equal(built.trimmed.memoryFacts, 0);
	assert.equal(built.trimmed.summaryTruncated, false);
	assert.deepEqual(built.facts, facts);
	assert.equal(built.summary, summary);
});

test("com cortes nas três seções, prompt e breakdown saem do conteúdo mantido, na ordem fatos → resumo → histórico → pergunta", () => {
	const built = buildContext(
		{ question, facts, summary, history },
		{ summary: summaryTokens("- linha 1 rollback aprovado"), window: historyTokens(history.slice(-2)), memory: memoryTokens([facts[0]!]) },
	);

	assert.equal(built.prompt, formatQuestionWithMemory(built.facts, formatQuestionWithHistory(built.history, question, built.summary)));
	assert.deepEqual(built.breakdown, contextBreakdown(question, built.history, built.facts, built.summary));
	assert.deepEqual(built.trimmed, { historyMessages: 4, memoryFacts: 2, summaryTruncated: true });
});

test("buildContext é determinística", () => {
	const tight: ContextBudget = { summary: 20, window: 30, memory: 15 };
	assert.deepEqual(buildContext({ question, facts, summary, history }, tight), buildContext({ question, facts, summary, history }, tight));
});

test("parseContextBudget sem variáveis devolve o padrão", () => {
	assert.deepEqual(parseContextBudget({}), { budget: DEFAULT_CONTEXT_BUDGET, invalid: [] });
	assert.deepEqual(DEFAULT_CONTEXT_BUDGET, { summary: 200, window: 1200, memory: 300 });
});

test("parseContextBudget aceita inteiros ≥ 0, inclusive 0, e ignora chaves alheias", () => {
	const parsed = parseContextBudget({ CONTEXT_BUDGET_WINDOW: "500", CONTEXT_BUDGET_MEMORY: "0", PORT: "3000" });

	assert.deepEqual(parsed, { budget: { summary: 200, window: 500, memory: 0 }, invalid: [] });
});

test("parseContextBudget trata string vazia como ausente", () => {
	assert.deepEqual(parseContextBudget({ CONTEXT_BUDGET_SUMMARY: "  " }), { budget: DEFAULT_CONTEXT_BUDGET, invalid: [] });
});

test("parseContextBudget cai no padrão e lista as variáveis inválidas", () => {
	const parsed = parseContextBudget({ CONTEXT_BUDGET_SUMMARY: "abc", CONTEXT_BUDGET_WINDOW: "-1", CONTEXT_BUDGET_MEMORY: "1.5" });

	assert.deepEqual(parsed, {
		budget: DEFAULT_CONTEXT_BUDGET,
		invalid: ["CONTEXT_BUDGET_SUMMARY", "CONTEXT_BUDGET_WINDOW", "CONTEXT_BUDGET_MEMORY"],
	});
});

test("decisões do plantonista (specs/018) entram logo antes da pergunta e nunca são cortadas", () => {
	const decisions = "Decisões do plantonista neste turno:\n- Resolver o incidente #3: aprovada e executada";
	const history = Array.from({ length: 40 }, (_, i) => ({ role: "user" as const, content: `mensagem ${i} `.repeat(30) }));

	const built = buildContext({ question: "resolva o 3", facts: [], history, decisions }, { summary: 0, window: 0, memory: 0 });

	assert.ok(built.prompt.endsWith(`${decisions}\n\nresolva o 3`));
	assert.equal(built.history.length, 0);
	assert.equal(built.breakdown.question, buildContext({ question: "resolva o 3", facts: [], history: [] }).breakdown.question);
});

test("sem decisões, o prompt não muda", () => {
	const input = { question: "oi", facts: [], history: [] };

	assert.equal(buildContext({ ...input, decisions: "" }).prompt, buildContext(input).prompt);
});

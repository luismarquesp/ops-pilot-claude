import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MAX_REFLECTION, withReflection, type Critic } from "./reflection.js";
import type { ReasoningStrategy, StrategyInput, StrategyResult, TraceEvent } from "./strategy.js";

function fakeStrategy(answers: string[]): { strategy: ReasoningStrategy; questions: string[] } {
	const questions: string[] = [];
	let call = 0;
	const strategy: ReasoningStrategy = {
		name: "fake",
		async run(input: StrategyInput): Promise<StrategyResult> {
			questions.push(input.question);
			const answer = answers[Math.min(call, answers.length - 1)] ?? "";
			call += 1;
			return {
				answer,
				trace: [
					{ type: "observation", content: `obs-${call}` },
					{ type: "answer", content: answer },
				],
				metrics: { llmCalls: 1, latencyMs: 1 },
			};
		},
	};
	return { strategy, questions };
}

function critiqueContents(trace: StrategyResult["trace"]): string[] {
	return trace
		.filter((event): event is Extract<TraceEvent, { type: "critique" }> => event.type === "critique")
		.map((event) => event.content);
}

const approvingCritic: Critic = async () => ({ approved: true });

function rejectingThenApprovingCritic(): Critic {
	let calls = 0;
	return async () => {
		calls += 1;
		if (calls === 1) {
			return { approved: false, feedback: "faltou considerar o incidente crítico" };
		}
		return { approved: true };
	};
}

const alwaysRejectingCritic: Critic = async () => ({ approved: false, feedback: "ainda não está certo" });

const throwingCritic: Critic = async () => {
	throw new Error("crítico indisponível");
};

test("aprovação na 1ª avaliação: nenhuma regeneração, resposta = a primeira gerada", async () => {
	const { strategy, questions } = fakeStrategy(["resposta 1"]);
	const wrapped = withReflection(strategy, { critic: approvingCritic });

	const result = await wrapped.run({ question: "Como está o plantão?" });

	assert.equal(result.answer, "resposta 1");
	assert.equal(questions.length, 1);
	assert.equal(wrapped.name, "reflect:fake");
});

test("reprovação seguida de aprovação: exatamente 1 regeneração, resposta final = a aprovada", async () => {
	const { strategy, questions } = fakeStrategy(["resposta 1", "resposta 2"]);
	const wrapped = withReflection(strategy, { critic: rejectingThenApprovingCritic() });

	const result = await wrapped.run({ question: "Como está o plantão?" });

	assert.equal(result.answer, "resposta 2");
	assert.equal(questions.length, 2);
});

test("o feedback do crítico é incorporado na pergunta da regeneração", async () => {
	const { strategy, questions } = fakeStrategy(["resposta 1", "resposta 2"]);
	const wrapped = withReflection(strategy, { critic: rejectingThenApprovingCritic() });

	await wrapped.run({ question: "Como está o plantão?" });

	assert.match(questions[0] ?? "", /Como está o plantão\?/);
	assert.match(questions[1] ?? "", /resposta 1/);
	assert.match(questions[1] ?? "", /faltou considerar o incidente crítico/);
});

test("o trace concatena as gerações com um evento critique após cada avaliação", async () => {
	const { strategy } = fakeStrategy(["resposta 1", "resposta 2"]);
	const wrapped = withReflection(strategy, { critic: rejectingThenApprovingCritic() });

	const result = await wrapped.run({ question: "Como está o plantão?" });

	const types = result.trace.map((event) => event.type);
	assert.deepEqual(types, ["observation", "answer", "critique", "observation", "answer", "critique"]);
});

test("crítico que sempre reprova: exatamente maxReflection avaliações e maxReflection+1 gerações", async () => {
	const { strategy, questions } = fakeStrategy(["r1", "r2", "r3"]);
	const wrapped = withReflection(strategy, { critic: alwaysRejectingCritic, maxReflection: 2 });

	const result = await wrapped.run({ question: "pergunta" });

	assert.equal(questions.length, 3);
	assert.equal(result.answer, "r3");
	assert.equal(critiqueContents(result.trace).length, 2);
});

test("maxReflection padrão é 2 quando não informado", async () => {
	const { strategy, questions } = fakeStrategy(["r1", "r2", "r3", "r4"]);
	const wrapped = withReflection(strategy, { critic: alwaysRejectingCritic });

	await wrapped.run({ question: "pergunta" });

	assert.equal(questions.length, DEFAULT_MAX_REFLECTION + 1);
});

test("maxReflection: 0 desativa a reflexão — nenhuma avaliação, resposta idêntica à da estratégia de base", async () => {
	const { strategy, questions } = fakeStrategy(["r1"]);
	let criticCalls = 0;
	const critic: Critic = async () => {
		criticCalls += 1;
		return { approved: true };
	};
	const wrapped = withReflection(strategy, { critic, maxReflection: 0 });

	const result = await wrapped.run({ question: "pergunta" });

	assert.equal(questions.length, 1);
	assert.equal(criticCalls, 0);
	assert.equal(result.answer, "r1");
	assert.equal(critiqueContents(result.trace).length, 0);
});

test("falha do crítico não propaga: encerra com a última resposta válida e registra no trace", async () => {
	const { strategy } = fakeStrategy(["r1"]);
	const wrapped = withReflection(strategy, { critic: throwingCritic });

	const result = await wrapped.run({ question: "pergunta" });

	assert.equal(result.answer, "r1");
	const critiques = critiqueContents(result.trace);
	assert.equal(critiques.length, 1);
	assert.match(critiques[0] ?? "", /crítico indisponível/);
});

test("métricas somam as chamadas de cada geração e de cada avaliação do crítico", async () => {
	const { strategy } = fakeStrategy(["r1", "r2"]);
	const wrapped = withReflection(strategy, { critic: rejectingThenApprovingCritic() });

	const result = await wrapped.run({ question: "pergunta" });

	// 2 gerações (1 llmCall cada, via fakeStrategy) + 2 avaliações do crítico = 4
	assert.equal(result.metrics.llmCalls, 4);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { RunnableLambda } from "@langchain/core/runnables";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { logModelFallback, summarizeAttempts, withResilience, type ModelAttempt } from "./resilience.js";
import { trackModelCalls } from "./model-calls.js";
import { ModelUnavailableError } from "../services/errors.js";

class RateLimitError extends Error {
	override name = "RateLimitError";
}

/** Runnable falso: a cada chamada consome o próximo item de `script` ("ok" responde, Error lança; o último se repete). */
function fake(id: string, ...script: Array<"ok" | Error>) {
	let calls = 0;
	const runnable = RunnableLambda.from(async (_input: string) => {
		const step = script[Math.min(calls, script.length - 1)];
		calls += 1;
		if (step instanceof Error) {
			throw step;
		}
		return `${id}:ok`;
	});
	return { id, runnable, calls: () => calls };
}

const ok = (model: string): ModelAttempt => ({ model, ok: true });
const ko = (model: string, error = "RateLimitError"): ModelAttempt => ({ model, ok: false, error });

// --- summarizeAttempts (pura) ---

test("summarizeAttempts: falha e recuperação no mesmo modelo não é troca", () => {
	assert.deepEqual(summarizeAttempts([ko("a"), ok("a")]), { modelUsed: "a", switches: [], modelsTried: ["a"] });
});

test("summarizeAttempts: principal esgotado e reserva responde gera uma troca", () => {
	assert.deepEqual(summarizeAttempts([ko("a"), ko("a", "TimeoutError"), ok("b")]), {
		modelUsed: "b",
		switches: [{ from: "a", to: "b", reason: "TimeoutError" }],
		modelsTried: ["a", "b"],
	});
});

test("summarizeAttempts: duas trocas até a segunda reserva", () => {
	const outcome = summarizeAttempts([ko("a"), ko("a"), ko("b"), ko("b"), ok("c")]);

	assert.equal(outcome.modelUsed, "c");
	assert.deepEqual(
		outcome.switches.map(({ from, to }) => `${from}→${to}`),
		["a→b", "b→c"],
	);
});

test("summarizeAttempts: tudo falhou → modelUsed null e modelos tentados em ordem", () => {
	const outcome = summarizeAttempts([ko("a"), ko("a"), ko("b"), ko("b")]);

	assert.equal(outcome.modelUsed, null);
	assert.deepEqual(outcome.modelsTried, ["a", "b"]);
});

// --- withResilience ---

test("withResilience: principal falha uma vez e se recupera na nova tentativa, sem tocar a reserva", async () => {
	const a = fake("a", new RateLimitError(), "ok");
	const b = fake("b", "ok");

	const answer = await withResilience([a, b].map(({ id, runnable }) => ({ id, runnable })), { attempts: 2 }).invoke("oi");

	assert.equal(answer, "a:ok");
	assert.equal(a.calls(), 2);
	assert.equal(b.calls(), 0);
});

test("withResilience: principal sempre falha e a reserva responde", async (t) => {
	t.mock.method(console, "warn", () => {});
	const a = fake("a", new RateLimitError());
	const b = fake("b", "ok");

	const answer = await withResilience([a, b], { attempts: 1 }).invoke("oi");

	assert.equal(answer, "b:ok");
	assert.equal(a.calls(), 1);
	assert.equal(b.calls(), 1);
});

test("withResilience: a primeira reserva também falha e a segunda responde", async (t) => {
	t.mock.method(console, "warn", () => {});
	const chain = [fake("a", new RateLimitError()), fake("b", new RateLimitError()), fake("c", "ok")];

	assert.equal(await withResilience(chain, { attempts: 1 }).invoke("oi"), "c:ok");
});

test("withResilience: principal saudável nunca chama as reservas", async () => {
	const a = fake("a", "ok");
	const b = fake("b", "ok");

	await withResilience([a, b]).invoke("oi");

	assert.equal(a.calls(), 1);
	assert.equal(b.calls(), 0);
});

test("withResilience: tudo falha → ModelUnavailableError com os modelos tentados", async () => {
	const chain = [fake("a", new RateLimitError()), fake("b", new TypeError("x"))];

	await assert.rejects(withResilience(chain, { attempts: 1 }).invoke("oi"), (error) => {
		assert.ok(error instanceof ModelUnavailableError);
		assert.deepEqual(error.modelsTried, ["a", "b"]);
		return true;
	});
});

test("withResilience registra a chamada no escopo do turno; fora de escopo não lança", async (t) => {
	t.mock.method(console, "warn", () => {});
	const chain = () => [fake("a", new RateLimitError()), fake("b", "ok")];

	const { calls } = await trackModelCalls(() => withResilience(chain(), { attempts: 1 }).invoke("oi"));
	assert.deepEqual(calls, [{ modelUsed: "b", switches: [{ from: "a", to: "b", reason: "RateLimitError" }] }]);

	assert.equal(await withResilience(chain(), { attempts: 1 }).invoke("oi"), "b:ok");
});

test("logModelFallback loga ids e nome do erro, nunca a mensagem", (t) => {
	const warn = t.mock.method(console, "warn", () => {});

	logModelFallback({ from: "a", to: "b", reason: new TypeError("segredo").name });

	const logged = warn.mock.calls.map((call) => call.arguments.join(" ")).join("\n");
	assert.match(logged, /a/);
	assert.match(logged, /b/);
	assert.match(logged, /TypeError/);
	assert.doesNotMatch(logged, /segredo/);
});

test("createReactAgent aceita o modelo resiliente como llm dinâmico (research.md §2)", async (t) => {
	t.mock.method(console, "warn", () => {});
	const failing = RunnableLambda.from(async (_input: unknown): Promise<AIMessage> => {
		throw new RateLimitError();
	});
	const reserve = new FakeListChatModel({ responses: ["pronto"] }).bindTools([]);

	const agent = createReactAgent({
		llm: () =>
			withResilience(
				[
					{ id: "a", runnable: failing },
					{ id: "b", runnable: reserve },
				],
				{ attempts: 1 },
			),
		tools: [],
	});
	const result = (await agent.invoke({ messages: [{ role: "user", content: "oi" }] })) as { messages: BaseMessage[] };

	assert.equal(result.messages.at(-1)?.content, "pronto");
});

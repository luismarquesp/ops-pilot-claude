/** runTurn com aprovação de ações sensíveis (specs/018, T037). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { runChat, runTurn, type ChatDeps } from "./chat-service.js";
import { withApprovalGate } from "../agents/approval-gate.js";
import type { ReasoningStrategy, StrategyResult } from "../agents/strategy.js";
import type { RouteStrategies } from "../agents/routes.js";
import { createMockConversationStore } from "../store/mock-conversation-store.js";
import { createMockApprovalStore } from "../store/mock-approval-store.js";

const NOW = new Date("2026-11-20T12:00:00.000Z");

function resolveTool() {
	const executed: unknown[] = [];
	const resolve = withApprovalGate(
		tool(
			async (input) => {
				executed.push(input);
				return '{"id":3,"status":"resolved"}';
			},
			{ name: "resolve_incident", description: "resolve", schema: z.object({ id: z.number() }) },
		),
	);
	return { resolve, executed };
}

/** Chama a tool sensível e responde com a observação que recebeu. */
function callingStrategy(call: () => Promise<unknown>): ReasoningStrategy & { questions: string[] } {
	const questions: string[] = [];
	return {
		name: "react",
		questions,
		async run(input): Promise<StrategyResult> {
			questions.push(input.question);
			const observation = String(await call());
			return {
				answer: `resposta final: ${observation}`,
				trace: [
					{ type: "action", tool: "resolve_incident", args: { id: 3 } },
					{ type: "observation", content: observation },
					{ type: "answer", content: `resposta final: ${observation}` },
				],
				metrics: { llmCalls: 2, latencyMs: 7 },
			};
		},
	};
}

function deps(react: ReasoningStrategy, extra: Partial<ChatDeps> = {}) {
	const conversations = createMockConversationStore();
	const approvals = createMockApprovalStore();
	const learned: unknown[] = [];
	let ids = 0;
	const base: ChatDeps = {
		strategies: { react } as RouteStrategies,
		conversations,
		approvals,
		timeoutMs: 5_000,
		learn: async (input) => void learned.push(input),
		now: () => NOW,
		newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
		...extra,
	};
	return { deps: base, conversations, approvals, learned };
}

test("pausa sem conversationId: cria a conversa vazia, grava a aprovação e não grava mensagens nem aprende", async () => {
	const { resolve, executed } = resolveTool();
	const { deps: d, conversations, approvals, learned } = deps(callingStrategy(() => resolve.invoke({ id: 3 })));

	const turn = await runTurn({ message: "resolva o 3", userId: "ana", requestId: "req-1", strategy: "react" }, d);

	assert.equal(turn.kind, "pending");
	if (turn.kind !== "pending") return;
	assert.equal(executed.length, 0);
	assert.deepEqual(await conversations.messagesSince(turn.conversationId, 0), []);
	assert.equal(learned.length, 0);
	const stored = await approvals.get(turn.approval.id, NOW);
	assert.deepEqual(stored, turn.approval);
	assert.equal(turn.approval.status, "pending");
	assert.equal(turn.approval.conversationId, turn.conversationId);
	assert.equal(turn.approval.message, "resolva o 3");
	assert.equal(turn.approval.userId, "ana");
	assert.equal(turn.approval.requestId, "req-1");
	assert.equal(turn.approval.route, "react");
	assert.equal(turn.approval.reflect, false);
	assert.equal(turn.approval.summary, "Resolver o incidente #3");
	assert.equal(turn.approval.expiresAt, "2026-11-20T12:15:00.000Z");
	assert.equal(turn.trace.at(-1)?.type, "approval");
	assert.ok(!turn.trace.some((e) => e.type === "answer"));
	assert.equal(turn.metrics.llmCalls, 2);
});

test("pausa com conversationId existente usa a mesma conversa", async () => {
	const { resolve } = resolveTool();
	const { deps: d, conversations } = deps(callingStrategy(() => resolve.invoke({ id: 3 })));
	const { id } = await conversations.create();

	const turn = await runTurn({ message: "resolva o 3", conversationId: id }, d);

	assert.equal(turn.kind, "pending");
	assert.equal(turn.conversationId, id);
});

test("retomada com o livro: responde do livro sem executar, abre o rastro com decision, grava a conversa e aprende", async () => {
	const { resolve, executed } = resolveTool();
	const react = callingStrategy(() => resolve.invoke({ id: 3 }));
	const { deps: d, conversations, learned } = deps(react);
	const { id } = await conversations.create();

	const turn = await runTurn(
		{
			message: "resolva o 3",
			conversationId: id,
			userId: "ana",
			resume: {
				turnId: "t-1",
				route: "react",
				ledger: [{ tool: "resolve_incident", args: { id: 3 }, status: "approved", result: '{"id":3,"status":"resolved"}' }],
				decision: { type: "decision", approvalId: "ap-1", decision: "approved", result: '{"id":3,"status":"resolved"}' },
			},
		},
		d,
	);

	assert.equal(turn.kind, "ok");
	if (turn.kind !== "ok") return;
	assert.equal(executed.length, 0);
	assert.match(turn.answer, /executado/);
	assert.deepEqual(turn.trace[0], { type: "decision", approvalId: "ap-1", decision: "approved", result: '{"id":3,"status":"resolved"}', node: "contexto" });
	assert.deepEqual(turn.trace[1], { type: "route", route: "react", reason: turn.trace[1]?.type === "route" ? turn.trace[1].reason : "", source: "resume", node: "roteador" });
	assert.match(react.questions[0] ?? "", /Decisões do plantonista neste turno:[\s\S]*aprovada e executada[\s\S]*resolva o 3$/);
	assert.deepEqual(
		(await conversations.messagesSince(id, 0)).map((m) => m.role),
		["user", "assistant"],
	);
	assert.equal(learned.length, 1);
});

test("retomada que esbarra em outra ação sensível pausa de novo com o mesmo turnId", async () => {
	const { resolve } = resolveTool();
	const react = callingStrategy(() => resolve.invoke({ id: 4 }));
	const { deps: d, conversations } = deps(react);
	const { id } = await conversations.create();

	const turn = await runTurn(
		{
			message: "resolva o 3 e o 4",
			conversationId: id,
			resume: {
				turnId: "t-1",
				route: "react",
				ledger: [{ tool: "resolve_incident", args: { id: 3 }, status: "denied", result: null }],
				decision: { type: "decision", approvalId: "ap-1", decision: "denied" },
			},
		},
		d,
	);

	assert.equal(turn.kind, "pending");
	if (turn.kind !== "pending") return;
	assert.equal(turn.approval.turnId, "t-1");
	assert.deepEqual(turn.approval.args, { id: 4 });
	assert.equal(turn.trace[0]?.type, "decision");
});

test("sem ApprovalStore nas deps, nada muda: a ação sensível executa direto e runChat responde", async () => {
	const { resolve, executed } = resolveTool();
	const { deps: d } = deps(callingStrategy(() => resolve.invoke({ id: 3 })), { approvals: undefined });

	const result = await runChat({ message: "resolva o 3" }, d);

	assert.equal(executed.length, 1);
	assert.match(result.answer, /resolved/);
});

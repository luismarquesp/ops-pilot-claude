import { test } from "node:test";
import assert from "node:assert/strict";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { decideApproval, executeApproved, listPendingApprovals, resumeTurn } from "./approval-service.js";
import { ApprovalAlreadyDecidedError, ApprovalExpiredError } from "./errors.js";
import { createMockApprovalStore } from "../store/mock-approval-store.js";
import { createMockOpsStore } from "../store/mock-ops-store.js";
import { createMockConversationStore } from "../store/mock-conversation-store.js";
import type { OpsStore } from "../store/ops-store.js";
import { newApproval, T0 } from "../store/approval-store.contract-tests.js";
import { withApprovalGate } from "../agents/approval-gate.js";
import type { ReasoningStrategy, StrategyResult } from "../agents/strategy.js";
import type { RouteStrategies } from "../agents/routes.js";
import type { ChatDeps } from "./chat-service.js";

const AP = "aaaaaaaa-0000-4000-8000-000000000001";
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

/** OpsStore falso que conta as escritas. */
function countingOps(): OpsStore & { writes: string[] } {
	const base = createMockOpsStore({ incidents: [{ title: "Fila travada", service: "payments", severity: "high", status: "open" }] });
	const writes: string[] = [];
	return {
		...base,
		writes,
		async resolveIncident(id) {
			writes.push(`resolve:${id}`);
			return base.resolveIncident(id);
		},
		async openIncident(input) {
			writes.push(`open:${input.service}`);
			return base.openIncident(input);
		},
	};
}

test("executeApproved: executa via ops-actions e devolve JSON; erro de domínio vira 'Erro: …'", async () => {
	const ops = countingOps();

	assert.match(await executeApproved(ops, "resolve_incident", { id: 1 }), /"status":"resolved"/);
	assert.match(await executeApproved(ops, "resolve_incident", { id: 99 }), /^Erro: /);
	assert.match(await executeApproved(ops, "open_incident", { title: "x", service: "inexistente", severity: "critical" }), /^Erro: /);
	await assert.rejects(executeApproved(ops, "resolve_incident", { id: "três" }));
	await assert.rejects(executeApproved(ops, "list_alerts", {}), /não é uma ação sensível/);
});

test("decideApproval(approve) executa a ação UMA vez, mesmo com duas decisões concorrentes, e guarda o resultado", async () => {
	const approvals = createMockApprovalStore();
	const ops = countingOps();
	await approvals.create(newApproval(AP, { args: { id: 1 } }));

	const results = await Promise.allSettled([
		decideApproval(AP, "approve", { approvals, ops, now: () => at(1) }),
		decideApproval(AP, "approve", { approvals, ops, now: () => at(1) }),
	]);

	assert.deepEqual(ops.writes, ["resolve:1"]);
	assert.equal(results.filter((r) => r.status === "rejected" && r.reason instanceof ApprovalAlreadyDecidedError).length, 1);
	const winner = results.find((r) => r.status === "fulfilled");
	assert.equal(winner?.status === "fulfilled" && winner.value.status, "approved");
	assert.match((await approvals.get(AP, at(2)))?.result ?? "", /"status":"resolved"/);
});

test("decideApproval(deny) não executa; expirada lança ApprovalExpiredError sem executar", async () => {
	const approvals = createMockApprovalStore();
	const ops = countingOps();
	await approvals.create(newApproval(AP, { args: { id: 1 } }));
	await approvals.create(newApproval("aaaaaaaa-0000-4000-8000-000000000002", { args: { id: 1 } }));

	const denied = await decideApproval(AP, "deny", { approvals, ops, now: () => at(1) });
	await assert.rejects(decideApproval("aaaaaaaa-0000-4000-8000-000000000002", "approve", { approvals, ops, now: () => at(20) }), ApprovalExpiredError);

	assert.equal(denied.status, "denied");
	assert.equal(denied.result, null);
	assert.deepEqual(ops.writes, []);
});

function callingStrategy(): ReasoningStrategy & { questions: string[] } {
	const questions: string[] = [];
	const gated = withApprovalGate(
		tool(async () => "executou de novo!", { name: "resolve_incident", description: "r", schema: z.object({ id: z.number() }) }),
	);
	return {
		name: "react",
		questions,
		async run(input): Promise<StrategyResult> {
			questions.push(input.question);
			const observation = String(await gated.invoke({ id: 1 }));
			return {
				answer: observation,
				trace: [{ type: "action", tool: "resolve_incident", args: { id: 1 } }, { type: "answer", content: observation }],
				metrics: { llmCalls: 1, latencyMs: 3 },
			};
		},
	};
}

test("resumeTurn: retoma na rota guardada com o livro; rastro abre com decision; grava a conversa", async () => {
	const approvals = createMockApprovalStore();
	const conversations = createMockConversationStore();
	const { id: conversationId } = await conversations.create();
	const ops = countingOps();
	const react = callingStrategy();
	await approvals.create(newApproval(AP, { conversationId, args: { id: 1 } }));
	const decided = await decideApproval(AP, "approve", { approvals, ops, now: () => at(1) });
	const chatDeps = { strategies: { react } as RouteStrategies, conversations, approvals, timeoutMs: 5_000, now: () => at(1) } satisfies ChatDeps;

	const turn = await resumeTurn(decided, { requestId: "req-2" }, chatDeps);

	assert.equal(turn.kind, "ok");
	if (turn.kind !== "ok") return;
	assert.deepEqual(ops.writes, ["resolve:1"]);
	assert.doesNotMatch(turn.answer, /executou de novo/);
	assert.match(turn.answer, /Aprovado pelo plantonista e executado/);
	assert.deepEqual(
		{ ...turn.trace[0], result: undefined },
		{ type: "decision", approvalId: AP, decision: "approved", result: undefined, node: "contexto" },
	);
	assert.equal(turn.trace[1]?.type === "route" && turn.trace[1].source, "resume");
	assert.equal((await conversations.messagesSince(conversationId, 0)).length, 2);
});

test("listPendingApprovals devolve só as pendentes da conversa", async () => {
	const approvals = createMockApprovalStore();
	await approvals.create(newApproval(AP));

	const pending = await listPendingApprovals(approvals, newApproval(AP).conversationId, at(1));

	assert.deepEqual(
		pending.map((a) => a.id),
		[AP],
	);
	assert.deepEqual(await listPendingApprovals(approvals, newApproval(AP).conversationId, at(30)), []);
});

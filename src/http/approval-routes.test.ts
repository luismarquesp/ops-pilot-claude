/** HTTP da aprovação de ações sensíveis (specs/018, contracts/chat-approvals-api.md — T039). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createApp, type AppDeps } from "./server.js";
import { withApprovalGate } from "../agents/approval-gate.js";
import type { ReasoningStrategy, StrategyResult } from "../agents/strategy.js";
import { createMockConversationStore } from "../store/mock-conversation-store.js";
import { createMockApprovalStore } from "../store/mock-approval-store.js";
import { createMockRequestStore } from "../store/mock-request-store.js";
import { createMockOpsStore } from "../store/mock-ops-store.js";
import type { ApprovalStore } from "../store/approval-store.js";
import type { OpsStore } from "../store/ops-store.js";
import type { RequestStore } from "../store/request-store.js";

const UUID = /^[0-9a-f-]{36}$/;
const UNKNOWN = "aaaaaaaa-0000-4000-8000-00000000dead";

/** Estratégia que tenta resolver `ids` em sequência (cada chamada passa pelo portão). */
function resolvingStrategy(ids: number[], ops: OpsStore): ReasoningStrategy {
	const resolve = withApprovalGate(
		tool(async ({ id }: { id: number }) => JSON.stringify(await ops.resolveIncident(id)), {
			name: "resolve_incident",
			description: "resolve",
			schema: z.object({ id: z.number() }),
		}),
	);
	return {
		name: "react",
		async run(): Promise<StrategyResult> {
			const trace: StrategyResult["trace"][number][] = [];
			const observations: string[] = [];
			for (const id of ids) {
				trace.push({ type: "action", tool: "resolve_incident", args: { id } });
				const observation = String(await resolve.invoke({ id }));
				observations.push(observation);
				trace.push({ type: "observation", content: observation });
			}
			const answer = observations.join(" | ");
			trace.push({ type: "answer", content: answer });
			return { answer, trace, metrics: { llmCalls: 1, latencyMs: 4 } };
		},
	};
}

interface Harness {
	baseUrl: string;
	approvals: ApprovalStore;
	ops: OpsStore;
	requests: RequestStore;
}

async function withApprovalsServer(ids: number[], fn: (h: Harness) => Promise<void>, now = () => new Date()): Promise<void> {
	const ops = createMockOpsStore({
		incidents: [
			{ title: "Fila travada", service: "payments", severity: "high", status: "open" },
			{ title: "Latência", service: "checkout", severity: "medium", status: "open" },
		],
	});
	const approvals = createMockApprovalStore();
	const requests = createMockRequestStore();
	const registry = new Map([["react", resolvingStrategy(ids, ops)]]);
	const deps: AppDeps = { strategiesFor: () => registry, conversations: createMockConversationStore(), approvals, ops, requests, now };
	const server = createApp(deps).listen(0);
	await new Promise<void>((resolve) => server.once("listening", resolve));
	const address = server.address();
	if (address === null || typeof address === "string") {
		throw new Error("sem porta");
	}
	try {
		await fn({ baseUrl: `http://127.0.0.1:${address.port}`, approvals, ops, requests });
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
}

async function post(url: string, body: unknown): Promise<{ status: number; body: Record<string, any> }> {
	const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
	return { status: response.status, body: (await response.json()) as Record<string, any> };
}

async function openStatus(ops: OpsStore): Promise<number[]> {
	return (await ops.listIncidents("open")).map((i) => i.id);
}

test("POST /chat com ação sensível → 202 approval_required, sem executar, registrado com status 202", async () => {
	await withApprovalsServer([1], async ({ baseUrl, ops, requests }) => {
		const { status, body } = await post(`${baseUrl}/chat`, { message: "resolva o 1" });

		assert.equal(status, 202);
		assert.match(body.requestId, UUID);
		assert.match(body.conversationId, UUID);
		assert.equal(body.status, "approval_required");
		assert.deepEqual(Object.keys(body.approval).sort(), ["args", "createdAt", "expiresAt", "id", "summary", "tool"]);
		assert.equal(body.approval.summary, "Resolver o incidente #1");
		assert.equal(body.answer, undefined);
		assert.equal(body.trace.at(-1).type, "approval");
		assert.ok(body.metrics);
		assert.deepEqual(await openStatus(ops), [1, 2]);

		const stored = await requests.get(body.requestId);
		assert.equal(stored?.request.status, 202);
		assert.equal(stored?.request.outcome, "ok");
		assert.equal(stored?.trace.at(-1)?.type, "approval");
	});
});

test("negar → 200 com resposta final, sem executar; aprovar de novo a mesma → 409", async () => {
	await withApprovalsServer([1], async ({ baseUrl, ops }) => {
		const paused = await post(`${baseUrl}/chat`, { message: "resolva o 1" });

		const denied = await post(`${baseUrl}/chat/approvals/${paused.body.approval.id}`, { decision: "deny" });
		const again = await post(`${baseUrl}/chat/approvals/${paused.body.approval.id}`, { decision: "approve" });

		assert.equal(denied.status, 200);
		assert.match(denied.body.requestId, UUID);
		assert.notEqual(denied.body.requestId, paused.body.requestId);
		assert.match(denied.body.answer, /Negado pelo plantonista/);
		assert.deepEqual(denied.body.trace[0], { type: "decision", approvalId: paused.body.approval.id, decision: "denied", node: "contexto" });
		assert.deepEqual(await openStatus(ops), [1, 2]);
		assert.equal(again.status, 409);
		assert.deepEqual(again.body, {
			requestId: again.body.requestId,
			error: "approval_already_decided",
			approvalId: paused.body.approval.id,
			status: "denied",
		});
	});
});

test("aprovar → executa uma vez e responde 200; rastro começa com decision approved e rota resume", async () => {
	await withApprovalsServer([1], async ({ baseUrl, ops }) => {
		const paused = await post(`${baseUrl}/chat`, { message: "resolva o 1" });

		const approved = await post(`${baseUrl}/chat/approvals/${paused.body.approval.id}`, { decision: "approve" });

		assert.equal(approved.status, 200);
		assert.equal(approved.body.conversationId, paused.body.conversationId);
		assert.equal(approved.body.trace[0].decision, "approved");
		assert.match(approved.body.trace[0].result, /"status":"resolved"/);
		assert.equal(approved.body.trace[1].source, "resume");
		assert.deepEqual(await openStatus(ops), [2]);
	});
});

test("retomada que esbarra numa segunda ação sensível → 202 encadeado com nova aprovação", async () => {
	await withApprovalsServer([1, 2], async ({ baseUrl, ops }) => {
		const first = await post(`${baseUrl}/chat`, { message: "resolva o 1 e o 2" });
		assert.equal(first.body.approval.summary, "Resolver o incidente #1");

		const second = await post(`${baseUrl}/chat/approvals/${first.body.approval.id}`, { decision: "approve" });

		assert.equal(second.status, 202);
		assert.equal(second.body.approval.summary, "Resolver o incidente #2");
		assert.notEqual(second.body.approval.id, first.body.approval.id);
		assert.deepEqual(await openStatus(ops), [2]);

		const done = await post(`${baseUrl}/chat/approvals/${second.body.approval.id}`, { decision: "approve" });
		assert.equal(done.status, 200);
		assert.deepEqual(await openStatus(ops), []);
	});
});

test("decisão: 400 para id não-UUID ou corpo inválido; 404 para inexistente; 410 para expirada", async () => {
	let clock = new Date("2026-11-20T12:00:00.000Z");
	await withApprovalsServer(
		[1],
		async ({ baseUrl, ops }) => {
			const badId = await post(`${baseUrl}/chat/approvals/nao-uuid`, { decision: "approve" });
			const badBody = await post(`${baseUrl}/chat/approvals/${UNKNOWN}`, { decision: "talvez" });
			const missing = await post(`${baseUrl}/chat/approvals/${UNKNOWN}`, { decision: "approve" });
			const paused = await post(`${baseUrl}/chat`, { message: "resolva o 1" });
			clock = new Date(clock.getTime() + 16 * 60_000);
			const expired = await post(`${baseUrl}/chat/approvals/${paused.body.approval.id}`, { decision: "approve" });

			assert.equal(badId.status, 400);
			assert.ok(Array.isArray(badId.body.issues));
			assert.match(badId.body.requestId, UUID);
			assert.equal(badBody.status, 400);
			assert.equal(missing.status, 404);
			assert.deepEqual(missing.body, { requestId: missing.body.requestId, error: "approval_not_found", approvalId: UNKNOWN });
			assert.equal(expired.status, 410);
			assert.deepEqual(expired.body, { requestId: expired.body.requestId, error: "approval_expired", approvalId: paused.body.approval.id });
			assert.deepEqual(await openStatus(ops), [1, 2]);
		},
		() => clock,
	);
});

test("GET /chat/approvals?conversationId= lista só as pendentes; 400 sem UUID", async () => {
	await withApprovalsServer([1], async ({ baseUrl }) => {
		const paused = await post(`${baseUrl}/chat`, { message: "resolva o 1" });

		const list = await fetch(`${baseUrl}/chat/approvals?conversationId=${paused.body.conversationId}`);
		const listBody = (await list.json()) as Record<string, any>;
		await post(`${baseUrl}/chat/approvals/${paused.body.approval.id}`, { decision: "deny" });
		const after = (await (await fetch(`${baseUrl}/chat/approvals?conversationId=${paused.body.conversationId}`)).json()) as Record<string, any>;
		const bad = await fetch(`${baseUrl}/chat/approvals?conversationId=x`);

		assert.equal(list.status, 200);
		assert.match(listBody.requestId, UUID);
		assert.deepEqual(
			listBody.approvals.map((a: Record<string, unknown>) => [a.id, a.status, a.summary]),
			[[paused.body.approval.id, "pending", "Resolver o incidente #1"]],
		);
		assert.deepEqual(after.approvals, []);
		assert.equal(bad.status, 400);
	});
});

test("sem ApprovalStore, /chat/approvals não existe e a ação executa direto (200)", async () => {
	const ops = createMockOpsStore({ incidents: [{ title: "x", service: "payments", severity: "high", status: "open" }] });
	const registry = new Map([["react", resolvingStrategy([1], ops)]]);
	const server = createApp({ strategiesFor: () => registry, conversations: createMockConversationStore() }).listen(0);
	await new Promise<void>((resolve) => server.once("listening", resolve));
	const address = server.address();
	try {
		if (address === null || typeof address === "string") throw new Error("sem porta");
		const baseUrl = `http://127.0.0.1:${address.port}`;
		const chat = await post(`${baseUrl}/chat`, { message: "resolva o 1" });
		const route = await fetch(`${baseUrl}/chat/approvals?conversationId=${UNKNOWN}`);

		assert.equal(chat.status, 200);
		assert.equal(chat.body.kind, undefined);
		assert.deepEqual((await ops.listIncidents("open")).length, 0);
		assert.equal(route.status, 404);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});

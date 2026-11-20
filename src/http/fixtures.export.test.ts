/**
 * Fixtures de contrato API ↔ war room (specs/018, research §11). Sobe o
 * `createApp` real com fakes, serializa as respostas e:
 * - com `OPSPILOT_WRITE_FIXTURES=1`, grava em `web/src/test/fixtures/`;
 * - sem a variável, compara com o arquivo existente e falha se divergir —
 *   uma mudança de formato na API obriga a regenerar e a revalidar na web.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createApp, type AppDeps } from "./server.js";
import type { ReasoningStrategy, StrategyResult, TraceEvent } from "../agents/strategy.js";
import { recordModelCall, type ModelSwitch } from "../agents/model-calls.js";
import { createFakeRouter } from "../agents/fake-router.js";
import { createFakeSummarizer } from "../agents/fake-summarizer.js";
import { createMockConversationStore } from "../store/mock-conversation-store.js";
import { ModelUnavailableError } from "../services/errors.js";

const FIXTURES_DIR = fileURLToPath(new URL("../../web/src/test/fixtures/", import.meta.url));
const WRITE = process.env.OPSPILOT_WRITE_FIXTURES === "1";
const FIXED_CONVERSATION = "5b1f3c2e-0000-4000-8000-00000000f1f1";
const FIXED_REQUEST = "0f8d6a1e-0000-4000-8000-00000000f1f1";

function strategy(name: string, trace: TraceEvent[], answer: string, switches: ModelSwitch[] = []): ReasoningStrategy {
	return {
		name,
		async run(): Promise<StrategyResult> {
			recordModelCall({ modelUsed: "openrouter/free", switches });
			return { answer, trace, metrics: { llmCalls: 2, latencyMs: 42 } };
		},
	};
}

function failing(name: string): ReasoningStrategy {
	return {
		name,
		async run(): Promise<StrategyResult> {
			throw new ModelUnavailableError(["modelo/principal", "modelo/reserva:free"]);
		},
	};
}

async function withApp<T>(deps: Partial<AppDeps> & Pick<AppDeps, "strategiesFor">, fn: (baseUrl: string) => Promise<T>): Promise<T> {
	const app = createApp({ conversations: createMockConversationStore(), ...deps }, { newRequestId: () => FIXED_REQUEST });
	const server = app.listen(0);
	await new Promise<void>((resolve) => server.once("listening", resolve));
	const address = server.address();
	if (address === null || typeof address === "string") {
		throw new Error("sem porta");
	}
	try {
		return await fn(`http://127.0.0.1:${address.port}`);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
}

async function post(baseUrl: string, body: object): Promise<{ status: number; body: Record<string, unknown> }> {
	const response = await fetch(`${baseUrl}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
	return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** Ids gerados por fakes viram constantes para a fixture ser estável. */
function normalize(body: Record<string, unknown>): Record<string, unknown> {
	return { ...body, ...(typeof body.conversationId === "string" ? { conversationId: FIXED_CONVERSATION } : {}) };
}

function checkFixture(name: string, value: unknown): void {
	const path = `${FIXTURES_DIR}${name}`;
	const text = `${JSON.stringify(value, null, "\t")}\n`;
	if (WRITE) {
		mkdirSync(FIXTURES_DIR, { recursive: true });
		writeFileSync(path, text);
		return;
	}
	assert.ok(existsSync(path), `fixture ausente: ${name} — rode com OPSPILOT_WRITE_FIXTURES=1`);
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), value, `fixture ${name} divergiu — regenere com OPSPILOT_WRITE_FIXTURES=1`);
}

const REACT_TRACE: TraceEvent[] = [
	{ type: "thought", content: "Vou listar os alertas disparando." },
	{ type: "action", tool: "list_alerts", args: { status: "firing" } },
	{ type: "observation", content: "[{\"id\":1,\"service\":\"pagamentos\",\"severity\":\"SEV2\"}]" },
	{ type: "answer", content: "Há **1 alerta** disparando:\n\n- pagamentos (SEV2)" },
];

test("fixture chat-ok.json: rota, pensamento, ação, observação e resposta", async () => {
	const registry = new Map([["react", strategy("react", REACT_TRACE, "Há **1 alerta** disparando:\n\n- pagamentos (SEV2)")]]);
	const router = createFakeRouter({ route: "react", reason: "Pergunta direta que pede uma tool." });

	const { status, body } = await withApp({ strategiesFor: () => registry, router }, (baseUrl) => post(baseUrl, { message: "quais alertas?" }));

	assert.equal(status, 200);
	checkFixture("chat-ok.json", normalize(body));
});

test("fixture chat-plan.json: plano com passos e troca de modelo", async () => {
	const trace: TraceEvent[] = [
		{ type: "plan", steps: ["Listar incidentes abertos", "Consultar o runbook de pagamentos"] },
		{ type: "action", tool: "list_incidents", args: { status: "open" } },
		{ type: "observation", content: "[]" },
		{ type: "answer", content: "Nenhum incidente aberto." },
	];
	const registry = new Map([
		["react", strategy("react", REACT_TRACE, "x")],
		["plan-and-execute", strategy("plan-and-execute", trace, "Nenhum incidente aberto.", [{ from: "modelo/principal", to: "openrouter/free", reason: "RateLimitError" }])],
	]);

	const { status, body } = await withApp({ strategiesFor: () => registry }, (baseUrl) =>
		post(baseUrl, { message: "planeje", strategy: "plan-and-execute" }),
	);

	assert.equal(status, 200);
	checkFixture("chat-plan.json", normalize(body));
});

test("fixture chat-summarize.json: turno que gera resumo do histórico", async () => {
	const registry = new Map([["react", strategy("react", [{ type: "answer", content: "ok" }], "ok")]]);
	const summarizer = createFakeSummarizer();

	const last = await withApp({ strategiesFor: () => registry, summarizer }, async (baseUrl) => {
		let conversationId: string | undefined;
		let response: { status: number; body: Record<string, unknown> } | undefined;
		for (let turn = 1; turn <= 9; turn += 1) {
			response = await post(baseUrl, { message: `p${turn}`, ...(conversationId ? { conversationId } : {}) });
			conversationId = response.body.conversationId as string;
		}
		return response!;
	});

	assert.equal(last.status, 200);
	assert.equal((last.body.trace as Array<{ type: string }>)[0]?.type, "summarize");
	checkFixture("chat-summarize.json", normalize(last.body));
});

test("fixture chat-503.json: nenhum modelo respondeu", async () => {
	const registry = new Map([["react", failing("react")]]);

	const { status, body } = await withApp({ strategiesFor: () => registry }, (baseUrl) => post(baseUrl, { message: "oi" }));

	assert.equal(status, 503);
	checkFixture("chat-503.json", body);
});

test("fixtures chat-202.json, approval-decided-200.json e approvals-list.json: pausa, decisão e recuperação", async () => {
	const { createMockApprovalStore } = await import("../store/mock-approval-store.js");
	const { createMockOpsStore } = await import("../store/mock-ops-store.js");
	const { withApprovalGate } = await import("../agents/approval-gate.js");
	const { tool } = await import("@langchain/core/tools");
	const { z } = await import("zod");
	const ops = createMockOpsStore({ incidents: [{ title: "Fila travada", service: "payments", severity: "high", status: "open" }] });
	const resolve = withApprovalGate(
		tool(async ({ id }: { id: number }) => JSON.stringify(await ops.resolveIncident(id)), {
			name: "resolve_incident",
			description: "resolve",
			schema: z.object({ id: z.number() }),
		}),
	);
	const react: ReasoningStrategy = {
		name: "react",
		async run(): Promise<StrategyResult> {
			recordModelCall({ modelUsed: "openrouter/free", switches: [] });
			const observation = String(await resolve.invoke({ id: 1 }));
			return {
				answer: observation,
				trace: [
					{ type: "action", tool: "resolve_incident", args: { id: 1 } },
					{ type: "observation", content: observation },
					{ type: "answer", content: observation },
				],
				metrics: { llmCalls: 1, latencyMs: 42 },
			};
		},
	};
	const registry = new Map([["react", react]]);
	const now = () => new Date("2026-11-20T12:00:00.000Z");

	const [paused, list, decided] = await withApp(
		{ strategiesFor: () => registry, approvals: createMockApprovalStore(), ops, now },
		async (baseUrl) => {
			const first = await post(baseUrl, { message: "resolva o incidente 1", strategy: "react" });
			const approvalId = (first.body.approval as { id: string }).id;
			const listed = await fetch(`${baseUrl}/chat/approvals?conversationId=${first.body.conversationId as string}`);
			const decision = await fetch(`${baseUrl}/chat/approvals/${approvalId}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ decision: "approve" }),
			});
			return [first, { status: listed.status, body: await listed.json() }, { status: decision.status, body: await decision.json() }] as const;
		},
	);
	const approvalId = (paused.body.approval as { id: string }).id;
	const stable = (body: unknown) =>
		normalize(
			JSON.parse(
				JSON.stringify(body)
					.replaceAll(approvalId, "aaaaaaaa-0000-4000-8000-00000000f1f1")
					.replaceAll(paused.body.conversationId as string, FIXED_CONVERSATION)
					// Só o resolvedAt do incidente usa o relógio real (também dentro de strings JSON escapadas);
					// createdAt/expiresAt vêm do `now` fixo e precisam ficar como estão.
					.replace(/(resolvedAt\\*":\\*")\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "$12026-11-20T12:30:00.000Z"),
			),
		);

	assert.equal(paused.status, 202);
	assert.equal(list.status, 200);
	assert.equal(decided.status, 200);
	checkFixture("chat-202.json", stable(paused.body));
	checkFixture("approvals-list.json", stable(list.body));
	checkFixture("approval-decided-200.json", stable(decided.body));
});

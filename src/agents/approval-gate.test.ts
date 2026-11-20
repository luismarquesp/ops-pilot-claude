import { test } from "node:test";
import assert from "node:assert/strict";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { currentPendingCall, trackApprovals, withApprovalGate } from "./approval-gate.js";
import { APPROVAL_PENDING_OBSERVATION, OTHER_PENDING_OBSERVATION } from "./approvals.js";
import { createStrategyRegistry } from "./index.js";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";

/** Modelo roteirizado: devolve as mensagens na ordem (o FakeStreamingChatModel perde os tool_calls). */
class ScriptedChatModel extends BaseChatModel {
	private next = 0;
	constructor(private readonly script: AIMessage[]) {
		super({});
	}
	_llmType(): string {
		return "scripted";
	}
	override bindTools(): this {
		return this;
	}
	async _generate(_messages: BaseMessage[]): Promise<ChatResult> {
		const message = this.script[Math.min(this.next++, this.script.length - 1)]!;
		return { generations: [{ message, text: typeof message.content === "string" ? message.content : "" }] };
	}
}

function countingTool(name: string) {
	const calls: unknown[] = [];
	const instance = tool(
		async (input) => {
			calls.push(input);
			return `executou ${name}`;
		},
		{ name, description: `tool ${name}`, schema: z.object({ id: z.number().int(), note: z.string().default("padrão") }) },
	);
	return { instance, calls };
}

test("sem escopo, a tool embrulhada executa direto (arena, bench, testes de estratégia)", async () => {
	const { instance, calls } = countingTool("resolve_incident");

	const out = await withApprovalGate(instance).invoke({ id: 3 });

	assert.equal(out, "executou resolve_incident");
	assert.equal(calls.length, 1);
});

test("dentro do escopo, a 1ª chamada sensível não executa: registra a pendência e devolve a observação fixa", async () => {
	const { instance, calls } = countingTool("resolve_incident");
	const gated = withApprovalGate(instance);

	const { value, pending } = await trackApprovals(async () => {
		const first = await gated.invoke({ id: 3 });
		assert.deepEqual(currentPendingCall()?.args, { id: 3, note: "padrão" });
		return first;
	});

	assert.equal(value, APPROVAL_PENDING_OBSERVATION);
	assert.equal(calls.length, 0);
	assert.equal(pending?.tool, "resolve_incident");
	assert.deepEqual(pending?.args, { id: 3, note: "padrão" });
	assert.match(pending?.id ?? "", /^[0-9a-f-]{36}$/);
});

test("a mesma chamada repetida devolve a mesma pendência; outra ação sensível não é registrada", async () => {
	const resolve = countingTool("resolve_incident");
	const open = countingTool("open_incident");
	const gatedResolve = withApprovalGate(resolve.instance);
	const gatedOpen = withApprovalGate(open.instance);

	const { value, pending } = await trackApprovals(async () => [
		await gatedResolve.invoke({ id: 3 }),
		await gatedResolve.invoke({ note: "padrão", id: 3 }),
		await gatedOpen.invoke({ id: 9 }),
	]);

	assert.deepEqual(value, [APPROVAL_PENDING_OBSERVATION, APPROVAL_PENDING_OBSERVATION, OTHER_PENDING_OBSERVATION]);
	assert.equal(pending?.tool, "resolve_incident");
	assert.equal(resolve.calls.length + open.calls.length, 0);
});

test("com livro: chamada idêntica aprovada devolve o resultado guardado sem executar; negada devolve a negação", async () => {
	const resolve = countingTool("resolve_incident");
	const gated = withApprovalGate(resolve.instance);
	const ledger = [
		{ tool: "resolve_incident", args: { id: 3, note: "padrão" }, status: "approved" as const, result: '{"id":3}' },
		{ tool: "resolve_incident", args: { id: 4, note: "padrão" }, status: "denied" as const, result: null },
	];

	const { value, pending } = await trackApprovals(async () => [await gated.invoke({ id: 3 }), await gated.invoke({ id: 4 })], { ledger });

	assert.match(String(value[0]), /executado.*\{"id":3\}/s);
	assert.match(String(value[1]), /Negado pelo plantonista; não executado/);
	assert.equal(pending, undefined);
	assert.equal(resolve.calls.length, 0);
});

test("com livro, uma ação nova ainda não decidida pausa de novo", async () => {
	const resolve = countingTool("resolve_incident");
	const gated = withApprovalGate(resolve.instance);
	const ledger = [{ tool: "resolve_incident", args: { id: 3, note: "padrão" }, status: "approved" as const, result: "ok" }];

	const { pending } = await trackApprovals(() => gated.invoke({ id: 5 }), { ledger });

	assert.deepEqual(pending?.args, { id: 5, note: "padrão" });
});

test("escopos concorrentes não se misturam", async () => {
	const gated = withApprovalGate(countingTool("resolve_incident").instance);

	const [a, b] = await Promise.all([trackApprovals(() => gated.invoke({ id: 1 })), trackApprovals(() => gated.invoke({ id: 2 }))]);

	assert.deepEqual(a.pending?.args, { id: 1, note: "padrão" });
	assert.deepEqual(b.pending?.args, { id: 2, note: "padrão" });
});

test("o registry embrulha só as tools sensíveis, mantendo nome, descrição e schema", () => {
	const resolve = countingTool("resolve_incident").instance;
	const list = countingTool("list_alerts").instance;

	const registry = createStrategyRegistry([resolve, list]);

	assert.ok(registry.get("react"));
	const wrapped = withApprovalGate(resolve);
	assert.equal(wrapped.name, "resolve_incident");
	assert.equal(wrapped.description, resolve.description);
	assert.equal(wrapped.schema, resolve.schema);
});

test("o escopo atravessa o ToolNode do createReactAgent real: a tool não roda e o agente recebe a observação fixa", async () => {
	const { instance, calls } = countingTool("resolve_incident");
	const llm = new ScriptedChatModel([
		new AIMessage({ content: "", tool_calls: [{ id: "c1", name: "resolve_incident", args: { id: 3 } }] }),
		new AIMessage("A ação depende de aprovação."),
	]);
	const agent = createReactAgent({ llm, tools: [withApprovalGate(instance)] });

	const { value, pending } = await trackApprovals(() => agent.invoke({ messages: [{ role: "user", content: "resolva o 3" }] }));

	assert.equal(calls.length, 0);
	assert.deepEqual(pending?.args, { id: 3, note: "padrão" });
	const toolMessage = value.messages.find((m) => m.getType() === "tool");
	assert.equal(toolMessage?.content, APPROVAL_PENDING_OBSERVATION);
});

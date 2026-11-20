import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTrace } from "./trace.js";
import type { Trace } from "./strategy.js";

test("formata cada tipo de evento de forma legível e preserva a ordem", () => {
	const trace: Trace = [
		{ type: "plan", steps: ["listar alertas", "resolver o mais crítico"] },
		{ type: "thought", content: "Vou checar os alertas em aberto." },
		{ type: "action", tool: "list_alerts", args: { status: "firing" } },
		{ type: "observation", content: "[]" },
		{ type: "critique", content: "Nenhum alerta restante." },
		{ type: "answer", content: "Nenhum incidente em aberto." },
	];

	const lines = formatTrace(trace).split("\n");

	assert.match(lines[0] ?? "", /^\[Plano\]$/);
	assert.match(lines[1] ?? "", /1\. listar alertas/);
	assert.match(lines[2] ?? "", /2\. resolver o mais crítico/);
	assert.match(lines[3] ?? "", /^\[Pensamento\] Vou checar os alertas em aberto\.$/);
	assert.match(lines[4] ?? "", /^\[Ação\] list_alerts\(\{"status":"firing"\}\)$/);
	assert.match(lines[5] ?? "", /^\[Observação\] \[\]$/);
	assert.match(lines[6] ?? "", /^\[Crítica\] Nenhum alerta restante\.$/);
	assert.match(lines[7] ?? "", /^\[Resposta\] Nenhum incidente em aberto\.$/);
});

test("rastro vazio formata para string vazia", () => {
	assert.equal(formatTrace([]), "");
});

test("formatTrace rotula o evento summarize como Resumo (specs/012)", () => {
	assert.equal(formatTrace([{ type: "summarize", content: "R", messagesSummarized: 8 }]), "[Resumo] R");
});

test("formata o evento de rota do grafo e ignora o campo node (specs/014)", () => {
	const tagged = { type: "answer" as const, content: "feito", node: "plan-and-execute" };
	const formatted = formatTrace([
		{ type: "route", route: "plan-and-execute", reason: "vários passos", source: "router" },
		tagged,
	]);

	assert.equal(formatted, "[Rota] plan-and-execute (router): vários passos\n[Resposta] feito");
});

test("formata o evento de troca de modelo (specs/015)", () => {
	assert.equal(
		formatTrace([{ type: "fallback", from: "a", to: "b", reason: "RateLimitError" }]),
		"[Troca de modelo] a → b (RateLimitError)",
	);
});

test("formatTrace rotula a pausa de aprovação e a decisão", () => {
	const lines = formatTrace([
		{ type: "approval", approvalId: "ap-1", tool: "resolve_incident", args: { id: 3 }, summary: "Resolver o incidente #3" },
		{ type: "decision", approvalId: "ap-1", decision: "denied" },
	]).split("\n");

	assert.deepEqual(lines, ["[Aguardando aprovação] Resolver o incidente #3", "[Decisão] denied"]);
});

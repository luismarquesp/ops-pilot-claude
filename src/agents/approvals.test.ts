import { test } from "node:test";
import assert from "node:assert/strict";
import {
	APPROVAL_TTL_MS,
	approvalSummary,
	callKey,
	insertApprovalEvent,
	isSensitiveTool,
	ledgerObservation,
	ledgerPromptSection,
} from "./approvals.js";
import type { TraceEvent } from "./strategy.js";

test("isSensitiveTool: só open_incident e resolve_incident", () => {
	assert.equal(isSensitiveTool("open_incident"), true);
	assert.equal(isSensitiveTool("resolve_incident"), true);
	assert.equal(isSensitiveTool("list_incidents"), false);
	assert.equal(isSensitiveTool("remember_fact"), false);
});

test("callKey: estável com chaves em outra ordem e diferente com args diferentes", () => {
	assert.equal(
		callKey("open_incident", { title: "x", service: "pagamentos", severity: "SEV2" }),
		callKey("open_incident", { severity: "SEV2", service: "pagamentos", title: "x" }),
	);
	assert.notEqual(callKey("resolve_incident", { id: 3 }), callKey("resolve_incident", { id: 4 }));
	assert.notEqual(callKey("resolve_incident", { id: 3 }), callKey("open_incident", { id: 3 }));
	assert.equal(callKey("t", { a: { y: 1, x: [2, { k: 1, j: 2 }] } }), callKey("t", { a: { x: [2, { j: 2, k: 1 }], y: 1 } }));
});

test("approvalSummary descreve a ação em linguagem humana", () => {
	assert.equal(approvalSummary("resolve_incident", { id: 3 }), "Resolver o incidente #3");
	assert.equal(
		approvalSummary("open_incident", { title: "Fila travada", service: "pagamentos", severity: "SEV2" }),
		"Abrir incidente SEV2 «Fila travada» em pagamentos",
	);
	assert.equal(approvalSummary("outra", {}), "Executar outra");
});

test("ledgerObservation: aprovada devolve o resultado; negada/expirada diz que não executou", () => {
	assert.match(ledgerObservation({ tool: "resolve_incident", args: { id: 3 }, status: "approved", result: '{"id":3}' }), /executado.*\{"id":3\}/s);
	assert.match(ledgerObservation({ tool: "resolve_incident", args: { id: 3 }, status: "denied", result: null }), /negado pelo plantonista; não executado/i);
	assert.match(ledgerObservation({ tool: "resolve_incident", args: { id: 3 }, status: "expired", result: null }), /não executado/i);
});

test("ledgerPromptSection: vazio → string vazia; senão lista as decisões com o resumo", () => {
	assert.equal(ledgerPromptSection([]), "");
	const section = ledgerPromptSection([
		{ tool: "resolve_incident", args: { id: 3 }, status: "approved", result: '{"id":3,"status":"resolved"}' },
		{ tool: "open_incident", args: { title: "x", service: "s", severity: "SEV1" }, status: "denied", result: null },
	]);
	assert.ok(section.startsWith("Decisões do plantonista neste turno:"));
	assert.match(section, /Resolver o incidente #3: aprovada e executada/);
	assert.match(section, /Abrir incidente SEV1 «x» em s: negada, não executada/);
});

test("insertApprovalEvent: insere depois do action pendente e corta o resto", () => {
	const trace: TraceEvent[] = [
		{ type: "thought", content: "vou resolver" },
		{ type: "action", tool: "list_incidents", args: {} },
		{ type: "observation", content: "[]" },
		{ type: "action", tool: "resolve_incident", args: { id: 3 } },
		{ type: "observation", content: "aguardando" },
		{ type: "answer", content: "pedi aprovação" },
	];
	const pending = { id: "ap-1", tool: "resolve_incident", args: { id: 3 } };

	assert.deepEqual(insertApprovalEvent(trace, pending), [
		...trace.slice(0, 4),
		{ type: "approval", approvalId: "ap-1", tool: "resolve_incident", args: { id: 3 }, summary: "Resolver o incidente #3" },
	]);
});

test("insertApprovalEvent: sem o action correspondente, o evento vai no fim", () => {
	const trace: TraceEvent[] = [{ type: "answer", content: "x" }];

	const out = insertApprovalEvent(trace, { id: "ap-1", tool: "resolve_incident", args: { id: 3 } });

	assert.equal(out.at(-1)?.type, "approval");
	assert.equal(out.length, 2);
});

test("APPROVAL_TTL_MS é 15 minutos", () => {
	assert.equal(APPROVAL_TTL_MS, 15 * 60_000);
});

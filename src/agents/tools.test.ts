import { test } from "node:test";
import assert from "node:assert/strict";
import { createOpsTools } from "./tools.js";
import { createMockOpsStore } from "../store/mock-ops-store.js";
import type { Alert, Incident, OpenIncidentInput, OpsStore, Runbook } from "../store/ops-store.js";

function fakeStore(): OpsStore {
	return {
		async listAlerts(): Promise<Alert[]> {
			return [];
		},
		async listIncidents(): Promise<Incident[]> {
			return [];
		},
		async openIncident(input: OpenIncidentInput): Promise<Incident> {
			return {
				id: 1,
				title: input.title,
				service: input.service,
				severity: input.severity,
				status: "open",
				resolvedAt: null,
				summary: null,
			};
		},
		async resolveIncident(id: number): Promise<Incident> {
			return {
				id,
				title: "x",
				service: "checkout",
				severity: "low",
				status: "resolved",
				resolvedAt: new Date().toISOString(),
				summary: null,
			};
		},
		async getRunbook(service: string): Promise<Runbook> {
			return { service, content: "Procedimento de exemplo." };
		},
	};
}

function toolsOf(store: OpsStore) {
	const tools = createOpsTools(store);
	const byName = new Map(tools.map((tool) => [tool.name, tool]));
	const listAlerts = byName.get("list_alerts");
	const listIncidents = byName.get("list_incidents");
	const openIncident = byName.get("open_incident");
	const resolveIncident = byName.get("resolve_incident");
	const consultarRunbook = byName.get("consultar_runbook");
	if (!listAlerts || !listIncidents || !openIncident || !resolveIncident || !consultarRunbook) {
		throw new Error(
			"createOpsTools deve retornar list_alerts, list_incidents, open_incident, resolve_incident e consultar_runbook",
		);
	}
	return { listAlerts, listIncidents, openIncident, resolveIncident, consultarRunbook, byName };
}

test("list_alerts aceita status válido e rejeita status desconhecido", async () => {
	const { listAlerts } = toolsOf(fakeStore());
	await assert.doesNotReject(() => listAlerts.invoke({ status: "firing" }));
	await assert.rejects(() => listAlerts.invoke({ status: "unknown" } as never));
});

test("open_incident rejeita severidade desconhecida e título vazio, aceita entrada válida", async () => {
	const { openIncident } = toolsOf(fakeStore());
	await assert.rejects(() => openIncident.invoke({ title: "X", service: "checkout", severity: "unknown" } as never));
	await assert.rejects(() => openIncident.invoke({ title: "", service: "checkout", severity: "low" } as never));
	await assert.doesNotReject(() => openIncident.invoke({ title: "X", service: "checkout", severity: "low" }));
});

test("open_incident cria o incidente com status 'open' (não mais 'firing')", async () => {
	const { openIncident } = toolsOf(fakeStore());
	const raw = await openIncident.invoke({ title: "X", service: "checkout", severity: "low" });
	const incident = JSON.parse(raw as string) as Incident;
	assert.equal(incident.status, "open");
});

test("resolve_incident rejeita id não positivo e aceita id válido", async () => {
	const { resolveIncident } = toolsOf(fakeStore());
	await assert.rejects(() => resolveIncident.invoke({ id: -1 } as never));
	await assert.rejects(() => resolveIncident.invoke({ id: 1.5 } as never));
	await assert.doesNotReject(() => resolveIncident.invoke({ id: 1 }));
});

test("list_incidents aceita status válido e rejeita status desconhecido", async () => {
	const { listIncidents } = toolsOf(fakeStore());
	await assert.doesNotReject(() => listIncidents.invoke({ status: "open" }));
	await assert.rejects(() => listIncidents.invoke({ status: "unknown" } as never));
});

test("list_incidents sem filtro (default open) retorna só os incidentes abertos", async () => {
	const store = createMockOpsStore({
		incidents: [
			{ title: "Fila travada", service: "checkout", severity: "high", status: "open" },
			{ title: "Latência alta", service: "payments", severity: "medium", status: "resolved" },
		],
	});
	const { listIncidents } = toolsOf(store);

	const raw = await listIncidents.invoke({});
	const incidents = JSON.parse(raw as string) as Incident[];

	assert.equal(incidents.length, 1);
	assert.equal(incidents[0]?.status, "open");
});

test("list_incidents com status 'resolved' retorna só os resolvidos", async () => {
	const store = createMockOpsStore({
		incidents: [
			{ title: "Fila travada", service: "checkout", severity: "high", status: "open" },
			{ title: "Latência alta", service: "payments", severity: "medium", status: "resolved" },
		],
	});
	const { listIncidents } = toolsOf(store);

	const raw = await listIncidents.invoke({ status: "resolved" });
	const incidents = JSON.parse(raw as string) as Incident[];

	assert.equal(incidents.length, 1);
	assert.equal(incidents[0]?.status, "resolved");
});

test("list_incidents com status 'all' retorna abertos e resolvidos", async () => {
	const store = createMockOpsStore({
		incidents: [
			{ title: "Fila travada", service: "checkout", severity: "high", status: "open" },
			{ title: "Latência alta", service: "payments", severity: "medium", status: "resolved" },
		],
	});
	const { listIncidents } = toolsOf(store);

	const raw = await listIncidents.invoke({ status: "all" });
	const incidents = JSON.parse(raw as string) as Incident[];

	assert.equal(incidents.length, 2);
});

test("consultar_runbook retorna o procedimento de um serviço com runbook cadastrado", async () => {
	const { consultarRunbook } = toolsOf(createMockOpsStore());

	const raw = await consultarRunbook.invoke({ service: "checkout" });
	const runbook = JSON.parse(raw as string) as Runbook;

	assert.equal(runbook.service, "checkout");
	assert.ok(runbook.content.length > 0);
});

test("consultar_runbook retorna mensagem de erro (não lança) para serviço sem runbook", async () => {
	const { consultarRunbook } = toolsOf(createMockOpsStore());

	const raw = await consultarRunbook.invoke({ service: "search" });

	assert.match(raw as string, /^Erro: /);
});

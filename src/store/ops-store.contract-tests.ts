import { test } from "node:test";
import assert from "node:assert/strict";
import { IncidentNotFoundError, RunbookNotFoundError, ServiceNotFoundError } from "../services/errors.js";
import type { OpsStore } from "./ops-store.js";

/**
 * Suíte de contrato de `OpsStore` (contracts/ops-store.md, casos 1-9) —
 * roda idêntica contra `SqliteOpsStore` e `MockOpsStore`, para garantir que
 * trocar uma implementação pela outra por composição nunca muda o
 * comportamento observável pelas tools. Casos 10 (seed não duplica ao
 * reabrir o mesmo arquivo) e 11 (CHECK do SQLite rejeita valor fora do enum)
 * são específicos da camada SQL e ficam só em `sqlite-ops-store.test.ts`.
 */
export function runOpsStoreContractTests(label: string, createStore: () => OpsStore): void {
	test(`[${label}] seed inicial: 6 alerts (3 firing, 3 resolved), 0 incidents`, async () => {
		const store = createStore();

		const allAlerts = await store.listAlerts();
		const firing = await store.listAlerts("firing");
		const resolved = await store.listAlerts("resolved");
		const incidents = await store.listIncidents();

		assert.equal(allAlerts.length, 6);
		assert.equal(firing.length, 3);
		assert.equal(resolved.length, 3);
		assert.deepEqual(incidents, []);
	});

	test(`[${label}] openIncident com serviço válido cria incidente "open"`, async () => {
		const store = createStore();

		const incident = await store.openIncident({ title: "Fila travada", service: "checkout", severity: "high" });

		assert.equal(incident.status, "open");
		assert.equal(incident.resolvedAt, null);
		assert.equal(incident.service, "checkout");
		assert.equal(incident.severity, "high");
	});

	test(`[${label}] openIncident com serviço inexistente rejeita com ServiceNotFoundError`, async () => {
		const store = createStore();

		await assert.rejects(
			() => store.openIncident({ title: "X", service: "inexistente", severity: "low" }),
			ServiceNotFoundError,
		);
	});

	test(`[${label}] listIncidents filtra por open/resolved corretamente`, async () => {
		const store = createStore();
		const a = await store.openIncident({ title: "Fila travada", service: "checkout", severity: "high" });
		await store.openIncident({ title: "Latência alta", service: "payments", severity: "medium" });
		await store.resolveIncident(a.id);

		const open = await store.listIncidents("open");
		const resolved = await store.listIncidents("resolved");

		assert.equal(open.length, 1);
		assert.equal(open[0]?.service, "payments");
		assert.equal(resolved.length, 1);
		assert.equal(resolved[0]?.id, a.id);
	});

	test(`[${label}] resolveIncident marca "resolved" e grava resolvedAt`, async () => {
		const store = createStore();
		const incident = await store.openIncident({ title: "Fila travada", service: "checkout", severity: "high" });

		const resolved = await store.resolveIncident(incident.id);

		assert.equal(resolved.status, "resolved");
		assert.notEqual(resolved.resolvedAt, null);
	});

	test(`[${label}] resolveIncident é idempotente (resolvedAt não muda numa 2ª chamada)`, async () => {
		const store = createStore();
		const incident = await store.openIncident({ title: "Fila travada", service: "checkout", severity: "high" });

		const first = await store.resolveIncident(incident.id);
		const second = await store.resolveIncident(incident.id);

		assert.equal(second.status, "resolved");
		assert.equal(second.resolvedAt, first.resolvedAt);
	});

	test(`[${label}] resolveIncident com id inexistente rejeita com IncidentNotFoundError`, async () => {
		const store = createStore();

		await assert.rejects(() => store.resolveIncident(9999), IncidentNotFoundError);
	});

	test(`[${label}] getRunbook retorna conteúdo para checkout/payments/auth`, async () => {
		const store = createStore();

		for (const service of ["checkout", "payments", "auth"]) {
			const runbook = await store.getRunbook(service);
			assert.equal(runbook.service, service);
			assert.ok(runbook.content.length > 0);
		}
	});

	test(`[${label}] getRunbook sem runbook cadastrado rejeita com RunbookNotFoundError`, async () => {
		const store = createStore();

		await assert.rejects(() => store.getRunbook("search"), RunbookNotFoundError);
	});
}

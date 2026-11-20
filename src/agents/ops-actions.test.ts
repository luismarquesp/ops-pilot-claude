import { test } from "node:test";
import assert from "node:assert/strict";
import { listAlertsAction, openIncidentAction, resolveIncidentAction } from "./ops-actions.js";
import { createMockOpsStore } from "../store/mock-ops-store.js";
import { IncidentNotFoundError, ServiceNotFoundError } from "../services/errors.js";

test("listAlertsAction retorna alertas firing por padrão", async () => {
	const store = createMockOpsStore();
	const alerts = await listAlertsAction(store, { status: "firing" });
	assert.ok(alerts.length > 0);
	assert.ok(alerts.every((alert) => alert.status === "firing"));
});

test("listAlertsAction com status 'all' retorna alertas de qualquer status", async () => {
	const store = createMockOpsStore();
	const firing = await listAlertsAction(store, { status: "firing" });
	const all = await listAlertsAction(store, { status: "all" });
	assert.ok(all.length >= firing.length);
});

test("openIncidentAction cria um incidente para um serviço existente", async () => {
	const store = createMockOpsStore();
	const incident = await openIncidentAction(store, {
		title: "Fila de pagamento travada",
		service: "checkout",
		severity: "high",
	});
	assert.equal(incident.status, "open");
	assert.equal(incident.service, "checkout");
	assert.equal(incident.resolvedAt, null);
});

test("openIncidentAction propaga ServiceNotFoundError para serviço inexistente", async () => {
	const store = createMockOpsStore();
	await assert.rejects(
		() => openIncidentAction(store, { title: "x", service: "servico-inexistente", severity: "low" }),
		ServiceNotFoundError,
	);
});

test("resolveIncidentAction resolve um incidente aberto", async () => {
	const store = createMockOpsStore();
	const opened = await openIncidentAction(store, { title: "x", service: "checkout", severity: "low" });
	const resolved = await resolveIncidentAction(store, { id: opened.id });
	assert.equal(resolved.status, "resolved");
	assert.ok(resolved.resolvedAt);
});

test("resolveIncidentAction propaga IncidentNotFoundError para id inexistente", async () => {
	const store = createMockOpsStore();
	await assert.rejects(() => resolveIncidentAction(store, { id: 999999 }), IncidentNotFoundError);
});

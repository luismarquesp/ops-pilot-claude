import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createOpsMcpServer } from "./server.js";
import { createMockOpsStore } from "../store/mock-ops-store.js";
import type { OpsStore } from "../store/ops-store.js";
import { assertNoStdoutWrites } from "./test-support/stdout-guard.js";

function firstTextContent(result: unknown): { type: string; text: string } {
	const [content] = (result as { content: Array<{ type: string; text: string }> }).content;
	assert.ok(content, "resultado da tool não trouxe nenhum content");
	return content;
}

async function connectedClient(store: OpsStore = createMockOpsStore()): Promise<Client> {
	const server = createOpsMcpServer(store);
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: "opspilot-test-client", version: "1.0.0" });
	await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
	return client;
}

test("tools/list retorna exatamente list_alerts, open_incident e resolve_incident com o schema esperado", async () => {
	const client = await connectedClient();
	const { tools } = await client.listTools();

	assert.deepEqual(
		tools.map((t) => t.name).sort(),
		["list_alerts", "open_incident", "resolve_incident"],
	);

	const listAlerts = tools.find((t) => t.name === "list_alerts")!;
	assert.match(listAlerts.description ?? "", /alertas/i);
	assert.deepEqual(Object.keys(listAlerts.inputSchema.properties ?? {}), ["status"]);

	const openIncident = tools.find((t) => t.name === "open_incident")!;
	assert.match(openIncident.description ?? "", /incidente/i);
	assert.deepEqual(
		Object.keys(openIncident.inputSchema.properties ?? {}).sort(),
		["service", "severity", "title"],
	);
	assert.deepEqual(openIncident.inputSchema.required?.slice().sort(), ["service", "severity", "title"]);

	const resolveIncident = tools.find((t) => t.name === "resolve_incident")!;
	assert.match(resolveIncident.description ?? "", /resolvido/i);
	assert.deepEqual(Object.keys(resolveIncident.inputSchema.properties ?? {}), ["id"]);
	assert.deepEqual(resolveIncident.inputSchema.required, ["id"]);
});

test("conectar e listar ferramentas não escreve nada em stdout", async () => {
	await assertNoStdoutWrites(async () => {
		const client = await connectedClient();
		await client.listTools();
	});
});

test("list_alerts via MCP retorna os alertas firing por padrão", async () => {
	const client = await connectedClient();
	const result = await client.callTool({ name: "list_alerts", arguments: {} });
	assert.notEqual(result.isError, true);
	const content = firstTextContent(result);
	const alerts = JSON.parse(content.text);
	assert.ok(Array.isArray(alerts));
	assert.ok(alerts.length > 0);
	assert.ok(alerts.every((alert: { status: string }) => alert.status === "firing"));
});

test("open_incident via MCP cria um incidente para um serviço válido", async () => {
	const client = await connectedClient();
	const result = await client.callTool({
		name: "open_incident",
		arguments: { title: "Fila de pagamento travada", service: "checkout", severity: "high" },
	});
	assert.notEqual(result.isError, true);
	const content = firstTextContent(result);
	const incident = JSON.parse(content.text);
	assert.equal(incident.status, "open");
	assert.equal(incident.service, "checkout");
});

test("open_incident via MCP com serviço inexistente retorna isError sem derrubar o servidor", async () => {
	const client = await connectedClient();
	const errorResult = await client.callTool({
		name: "open_incident",
		arguments: { title: "x", service: "servico-inexistente", severity: "low" },
	});
	assert.equal(errorResult.isError, true);
	const content = firstTextContent(errorResult);
	assert.match(content.text, /Serviço não encontrado/);

	const okResult = await client.callTool({
		name: "open_incident",
		arguments: { title: "y", service: "checkout", severity: "low" },
	});
	assert.notEqual(okResult.isError, true);
});

test("resolve_incident via MCP resolve um incidente aberto", async () => {
	const client = await connectedClient();
	const opened = await client.callTool({
		name: "open_incident",
		arguments: { title: "x", service: "checkout", severity: "low" },
	});
	const openedContent = firstTextContent(opened);
	const incidentId = JSON.parse(openedContent.text).id;

	const resolved = await client.callTool({ name: "resolve_incident", arguments: { id: incidentId } });
	assert.notEqual(resolved.isError, true);
	const resolvedContent = firstTextContent(resolved);
	const incident = JSON.parse(resolvedContent.text);
	assert.equal(incident.status, "resolved");
	assert.ok(incident.resolvedAt);
});

test("resolve_incident via MCP com id inexistente retorna isError sem derrubar o servidor", async () => {
	const client = await connectedClient();
	const errorResult = await client.callTool({ name: "resolve_incident", arguments: { id: 999999 } });
	assert.equal(errorResult.isError, true);
	const content = firstTextContent(errorResult);
	assert.match(content.text, /Incidente não encontrado/);

	const opened = await client.callTool({
		name: "open_incident",
		arguments: { title: "z", service: "checkout", severity: "low" },
	});
	assert.notEqual(opened.isError, true);
});

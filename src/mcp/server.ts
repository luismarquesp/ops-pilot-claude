import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { OpsStore } from "../store/ops-store.js";
import { SqliteOpsStore } from "../store/sqlite-ops-store.js";
import { IncidentNotFoundError, ServiceNotFoundError } from "../services/errors.js";
import {
	listAlertsAction,
	listAlertsInputSchema,
	openIncidentAction,
	openIncidentInputSchema,
	resolveIncidentAction,
	resolveIncidentInputSchema,
} from "../agents/ops-actions.js";

/**
 * Servidor MCP do OpsPilot — segundo transporte (stdio) sobre o mesmo
 * `OpsStore` e os mesmos schemas zod já usados pelas tools LangChain
 * (`src/agents/tools.ts`), via `src/agents/ops-actions.ts` (FR-003/FR-004).
 *
 * REGRA CRÍTICA: nenhuma escrita em stdout além dos frames do próprio
 * protocolo MCP (escritos pelo `StdioServerTransport`) — stdout é o canal do
 * protocolo. Diagnóstico, se necessário, usa `console.error` (stderr).
 */
export function createOpsMcpServer(store: OpsStore): McpServer {
	const server = new McpServer({ name: "opspilot", version: "1.0.0" });

	server.registerTool(
		"list_alerts",
		{
			description:
				"Lista os ALERTAS de monitoramento — sinais brutos emitidos pelo sistema de observabilidade, " +
				"antes de qualquer ação do time. Use quando o plantonista perguntar o que está disparando " +
				"nos serviços monitorados, ou 'como está o plantão' no sentido de monitoramento.",
			inputSchema: listAlertsInputSchema,
		},
		async (input) => {
			const alerts = await listAlertsAction(store, input);
			return { content: [{ type: "text", text: JSON.stringify(alerts) }] };
		},
	);

	server.registerTool(
		"open_incident",
		{
			description:
				"Abre um novo incidente de resposta para um serviço monitorado — o operador decide " +
				"formalmente tratar um problema (cria um registro novo, distinto de um alerta que já " +
				"dispara sozinho vindo do monitoramento).",
			inputSchema: openIncidentInputSchema,
		},
		async (input) => {
			try {
				const incident = await openIncidentAction(store, input);
				return { content: [{ type: "text", text: JSON.stringify(incident) }] };
			} catch (error) {
				if (error instanceof ServiceNotFoundError) {
					return { content: [{ type: "text", text: error.message }], isError: true };
				}
				throw error;
			}
		},
	);

	server.registerTool(
		"resolve_incident",
		{
			description:
				"Marca como resolvido um incidente que o time abriu com open_incident, dado o seu id. " +
				"Não resolve alertas de monitoramento — alerts não têm uma tool de escrita.",
			inputSchema: resolveIncidentInputSchema,
		},
		async (input) => {
			try {
				const incident = await resolveIncidentAction(store, input);
				return { content: [{ type: "text", text: JSON.stringify(incident) }] };
			} catch (error) {
				if (error instanceof IncidentNotFoundError) {
					return { content: [{ type: "text", text: error.message }], isError: true };
				}
				throw error;
			}
		},
	);

	return server;
}

async function main(): Promise<void> {
	const store = new SqliteOpsStore();
	const server = createOpsMcpServer(store);
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error("OpsPilot MCP server (opspilot) conectado via stdio.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}

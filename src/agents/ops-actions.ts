import { z } from "zod";
import { SEVERITIES } from "../store/ops-store.js";
import type { Alert, AlertStatus, Incident, OpsStore } from "../store/ops-store.js";

/**
 * Schemas zod e funções de ação sobre o `OpsStore` — única fonte de verdade
 * reutilizada tanto pelas tools LangChain (`src/agents/tools.ts`) quanto pelo
 * servidor MCP (`src/mcp/server.ts`). Nenhum dos dois transportes define
 * validação ou lógica de negócio própria; cada um só traduz o resultado (ou o
 * erro de domínio lançado aqui) para o formato do seu próprio protocolo.
 */

export const listAlertsInputSchema = z.object({
	status: z
		.enum(["firing", "resolved", "all"])
		.default("firing")
		.describe("Filtro de status do alerta. Default: firing (o que está disparando agora)."),
});

export const openIncidentInputSchema = z.object({
	title: z.string().min(1).describe("Título curto do incidente, ex.: 'Fila de pagamento travada'."),
	service: z.string().min(1).describe("Nome do serviço monitorado ao qual o incidente pertence."),
	severity: z.enum(SEVERITIES).describe(`Severidade do incidente: uma de ${SEVERITIES.join(", ")}.`),
});

export const resolveIncidentInputSchema = z.object({
	id: z.number().int().positive().describe("Id do incidente a resolver, retornado por open_incident/list_incidents."),
});

export type ListAlertsInput = z.infer<typeof listAlertsInputSchema>;
export type OpenIncidentInput = z.infer<typeof openIncidentInputSchema>;
export type ResolveIncidentInput = z.infer<typeof resolveIncidentInputSchema>;

export async function listAlertsAction(store: OpsStore, input: ListAlertsInput): Promise<Alert[]> {
	const filter: AlertStatus | undefined = input.status === "all" ? undefined : input.status;
	return store.listAlerts(filter);
}

export async function openIncidentAction(store: OpsStore, input: OpenIncidentInput): Promise<Incident> {
	return store.openIncident(input);
}

export async function resolveIncidentAction(store: OpsStore, input: ResolveIncidentInput): Promise<Incident> {
	return store.resolveIncident(input.id);
}

import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { ALERT_STATUSES, SEVERITIES } from "../store/ops-store.js";
import type { OpsStore } from "../store/ops-store.js";
import { IncidentNotFoundError, RunbookNotFoundError, ServiceNotFoundError } from "../services/errors.js";
import {
	listAlertsAction,
	listAlertsInputSchema,
	openIncidentAction,
	openIncidentInputSchema,
	resolveIncidentAction,
	resolveIncidentInputSchema,
} from "./ops-actions.js";

/**
 * Tools LangChain sobre o `OpsStore` (FR-006/FR-007/FR-010). Erros de
 * domínio nunca escapam da tool — viram uma observação de erro (Princípio
 * IV), nunca uma exceção não tratada (edge case da spec).
 */
export function createOpsTools(store: OpsStore): StructuredToolInterface[] {
	const listAlerts = tool(
		async (input) => {
			const alerts = await listAlertsAction(store, input);
			return JSON.stringify(alerts);
		},
		{
			name: "list_alerts",
			description:
				"Lista os ALERTAS de monitoramento — sinais brutos emitidos pelo sistema de observabilidade, " +
				"antes de qualquer ação do time. Use quando o plantonista perguntar o que está disparando " +
				"nos serviços monitorados, ou 'como está o plantão' no sentido de monitoramento. Não use " +
				"para saber quais incidentes o time já abriu/está tratando — para isso, use list_incidents.",
			schema: listAlertsInputSchema,
		},
	);

	const listIncidents = tool(
		async ({ status }: { status?: "open" | "resolved" | "all" }) => {
			const filter = status === "all" || status === undefined ? undefined : status;
			const incidents = await store.listIncidents(filter);
			return JSON.stringify(incidents);
		},
		{
			name: "list_incidents",
			description:
				"Lista os INCIDENTES abertos pelo time — rastreamento formal de resposta a um problema, " +
				"distinto do alerta de monitoramento que o originou. Use quando o plantonista perguntar o " +
				"que está em aberto/atribuído ao time, ou pedir o histórico de incidentes já resolvidos. " +
				"Não use para ver sinais de monitoramento ainda não tratados — para isso, use list_alerts.",
			schema: z.object({
				status: z
					.enum(["open", "resolved", "all"])
					.default("open")
					.describe("Filtro de status do incidente. Default: open (o que ainda está em aberto)."),
			}),
		},
	);

	const openIncident = tool(
		async (input) => {
			try {
				const incident = await openIncidentAction(store, input);
				return JSON.stringify(incident);
			} catch (error) {
				if (error instanceof ServiceNotFoundError) {
					return `Erro: ${error.message}`;
				}
				throw error;
			}
		},
		{
			name: "open_incident",
			description:
				"Abre um novo incidente de resposta para um serviço monitorado — o operador decide " +
				"formalmente tratar um problema (cria um registro novo, distinto de um alerta que já " +
				"dispara sozinho vindo do monitoramento). Não use para só consultar o que já está " +
				"acontecendo — para isso, use list_alerts ou list_incidents.",
			schema: openIncidentInputSchema,
		},
	);

	const resolveIncident = tool(
		async (input) => {
			try {
				const incident = await resolveIncidentAction(store, input);
				return JSON.stringify(incident);
			} catch (error) {
				if (error instanceof IncidentNotFoundError) {
					return `Erro: ${error.message}`;
				}
				throw error;
			}
		},
		{
			name: "resolve_incident",
			description:
				"Marca como resolvido um incidente que o time abriu com open_incident, dado o seu id. " +
				"Não resolve alertas de monitoramento — alerts não têm uma tool de escrita.",
			schema: resolveIncidentInputSchema,
		},
	);

	const consultarRunbook = tool(
		async ({ service }: { service: string }) => {
			try {
				const runbook = await store.getRunbook(service);
				return JSON.stringify(runbook);
			} catch (error) {
				if (error instanceof RunbookNotFoundError) {
					return `Erro: ${error.message}`;
				}
				throw error;
			}
		},
		{
			name: "consultar_runbook",
			description:
				"Consulta o procedimento de remediação (runbook) cadastrado para um serviço. Use quando " +
				"o plantonista pedir orientação de como agir durante um incidente daquele serviço — " +
				"'como eu trato isso', 'qual o procedimento para pagamentos'.",
			schema: z.object({
				service: z.string().min(1).describe("Nome do serviço monitorado cujo runbook deve ser consultado."),
			}),
		},
	);

	return [listAlerts, listIncidents, openIncident, resolveIncident, consultarRunbook];
}

export { SEVERITIES, ALERT_STATUSES };

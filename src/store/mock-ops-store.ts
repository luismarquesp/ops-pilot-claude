import { IncidentNotFoundError, RunbookNotFoundError, ServiceNotFoundError } from "../services/errors.js";
import { MERCADINHO_ALERTS, MERCADINHO_RUNBOOKS, MERCADINHO_SERVICES } from "./mercadinho-seed.js";
import type { SeedAlert, SeedRunbook, SeedService } from "./mercadinho-seed.js";
import type {
	Alert,
	AlertStatus,
	Incident,
	IncidentStatus,
	OpenIncidentInput,
	OpsStore,
	Runbook,
	Severity,
} from "./ops-store.js";

export interface SeedIncident {
	title: string;
	service: string;
	severity: Severity;
	status: IncidentStatus;
	resolvedAt?: string | null;
	summary?: string | null;
}

export interface MockOpsStoreData {
	services?: readonly SeedService[];
	alerts?: readonly SeedAlert[];
	runbooks?: readonly SeedRunbook[];
	incidents?: readonly SeedIncident[];
}

interface ServiceRecord {
	id: number;
	name: string;
}

/**
 * `OpsStore` em memória, sem nenhum I/O de disco — sucessor de
 * `services/json-store.ts` (removido). Usado pelos testes de tools/estratégia
 * e por `bench.ts`, onde reprodutibilidade execução-a-execução importa mais
 * que persistência real (research.md §5): cada chamada a `createMockOpsStore`
 * já entrega uma instância isolada, sem precisar de `structuredClone` externo.
 */
export function createMockOpsStore(data: MockOpsStoreData = {}): OpsStore {
	const seedServices = data.services ?? MERCADINHO_SERVICES;
	const seedAlerts = data.alerts ?? MERCADINHO_ALERTS;
	const seedRunbooks = data.runbooks ?? MERCADINHO_RUNBOOKS;
	const seedIncidents = data.incidents ?? [];

	const services: ServiceRecord[] = seedServices.map((service, index) => ({
		id: index + 1,
		name: service.name,
	}));
	const serviceByName = new Map(services.map((service) => [service.name, service]));

	const alerts: Alert[] = seedAlerts.map((alert, index) => ({
		id: index + 1,
		title: alert.title,
		service: alert.service,
		severity: alert.severity,
		status: alert.status,
	}));

	const incidents: Incident[] = seedIncidents.map((incident, index) => ({
		id: index + 1,
		title: incident.title,
		service: incident.service,
		severity: incident.severity,
		status: incident.status,
		resolvedAt: incident.resolvedAt ?? null,
		summary: incident.summary ?? null,
	}));
	let nextIncidentId = incidents.length + 1;

	const runbookByService = new Map(seedRunbooks.map((runbook) => [runbook.service, runbook.content]));

	async function listAlerts(status?: AlertStatus): Promise<Alert[]> {
		return alerts.filter((alert) => !status || alert.status === status);
	}

	async function listIncidents(status?: IncidentStatus): Promise<Incident[]> {
		return incidents.filter((incident) => !status || incident.status === status);
	}

	async function openIncident(input: OpenIncidentInput): Promise<Incident> {
		if (!serviceByName.has(input.service)) {
			throw new ServiceNotFoundError(input.service);
		}
		const incident: Incident = {
			id: nextIncidentId,
			title: input.title,
			service: input.service,
			severity: input.severity,
			status: "open",
			resolvedAt: null,
			summary: null,
		};
		nextIncidentId += 1;
		incidents.push(incident);
		return incident;
	}

	async function resolveIncident(id: number): Promise<Incident> {
		const incident = incidents.find((candidate) => candidate.id === id);
		if (!incident) {
			throw new IncidentNotFoundError(id);
		}
		if (incident.status !== "resolved") {
			incident.status = "resolved";
			incident.resolvedAt = new Date().toISOString();
		}
		return incident;
	}

	async function getRunbook(service: string): Promise<Runbook> {
		const content = runbookByService.get(service);
		if (content === undefined) {
			throw new RunbookNotFoundError(service);
		}
		return { service, content };
	}

	return { listAlerts, listIncidents, openIncident, resolveIncident, getRunbook };
}

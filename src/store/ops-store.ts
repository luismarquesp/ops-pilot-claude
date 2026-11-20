export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SERVICE_TIERS = ["tier1", "tier2", "tier3"] as const;
export type ServiceTier = (typeof SERVICE_TIERS)[number];

export const ALERT_STATUSES = ["firing", "resolved"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const INCIDENT_STATUSES = ["open", "resolved"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export interface Alert {
	id: number;
	title: string;
	service: string;
	severity: Severity;
	status: AlertStatus;
}

export interface Incident {
	id: number;
	title: string;
	service: string;
	severity: Severity;
	status: IncidentStatus;
	resolvedAt: string | null;
	summary: string | null;
}

export interface Runbook {
	service: string;
	content: string;
}

export interface OpenIncidentInput {
	title: string;
	service: string;
	severity: Severity;
}

/**
 * Model layer (constitution, Princípio III) — única camada que fala SQL.
 * `SqliteOpsStore` (persistência real) e `MockOpsStore` (em memória, para
 * testes e para o bench) implementam esta mesma interface, de modo que a
 * composição (index.ts/arena.ts × bench.ts/testes) escolhe o backend sem que
 * as tools (src/agents/tools.ts) precisem saber qual está por trás.
 */
export interface OpsStore {
	listAlerts(status?: AlertStatus): Promise<Alert[]>;
	listIncidents(status?: IncidentStatus): Promise<Incident[]>;
	openIncident(input: OpenIncidentInput): Promise<Incident>;
	resolveIncident(id: number): Promise<Incident>;
	getRunbook(service: string): Promise<Runbook>;
}

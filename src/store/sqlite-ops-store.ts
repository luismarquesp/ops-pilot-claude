import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { IncidentNotFoundError, RunbookNotFoundError, ServiceNotFoundError } from "../services/errors.js";
import { MERCADINHO_ALERTS, MERCADINHO_RUNBOOKS, MERCADINHO_SERVICES } from "./mercadinho-seed.js";
import type {
	Alert,
	AlertStatus,
	Incident,
	IncidentStatus,
	OpenIncidentInput,
	OpsStore,
	Runbook,
} from "./ops-store.js";

interface AlertRow {
	id: number;
	title: string;
	service: string;
	severity: Alert["severity"];
	status: AlertStatus;
}

interface IncidentRow {
	id: number;
	title: string;
	service: string;
	severity: Incident["severity"];
	status: IncidentStatus;
	resolved_at: string | null;
	summary: string | null;
}

function toIncident(row: IncidentRow): Incident {
	return {
		id: row.id,
		title: row.title,
		service: row.service,
		severity: row.severity,
		status: row.status,
		resolvedAt: row.resolved_at,
		summary: row.summary,
	};
}

const DDL = `
	PRAGMA foreign_keys = ON;

	CREATE TABLE IF NOT EXISTS services (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE,
		tier TEXT NOT NULL CHECK (tier IN ('tier1','tier2','tier3'))
	);

	CREATE TABLE IF NOT EXISTS alerts (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		title TEXT NOT NULL,
		service_id INTEGER NOT NULL REFERENCES services(id),
		severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
		status TEXT NOT NULL CHECK (status IN ('firing','resolved'))
	);

	CREATE TABLE IF NOT EXISTS incidents (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		title TEXT NOT NULL,
		service_id INTEGER NOT NULL REFERENCES services(id),
		severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
		status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
		resolved_at TEXT,
		summary TEXT
	);

	CREATE TABLE IF NOT EXISTS runbooks (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		service_id INTEGER NOT NULL UNIQUE REFERENCES services(id),
		content TEXT NOT NULL
	);
`;

/** Caminho default do banco, compartilhado por todos os stores SQLite (specs/007, research.md §7). */
export const DEFAULT_DB_PATH = process.env.OPSPILOT_DB ?? "./data/opspilot.db";

/**
 * Persistência real do OpsPilot (spec.md, "Persistência Real de Operações")
 * via `node:sqlite` (`DatabaseSync`, nativo do Node — constitution v1.1.0,
 * sem dependência de terceiros). Única camada que fala SQL (Princípio III);
 * toda query usa prepared statement, nunca SQL concatenado (research.md §6).
 */
export class SqliteOpsStore implements OpsStore {
	private readonly db: DatabaseSync;

	constructor(path: string = DEFAULT_DB_PATH) {
		if (path !== ":memory:") {
			mkdirSync(dirname(path), { recursive: true });
		}
		this.db = new DatabaseSync(path);
		this.db.exec(DDL);
		this.seedIfEmpty();
	}

	/** Seed idempotente do cenário "Mercadinho" (FR-002/FR-004) — só roda se `services` estiver vazia. */
	private seedIfEmpty(): void {
		const { count } = this.db.prepare("SELECT COUNT(*) AS count FROM services").get() as { count: number };
		if (count > 0) {
			return;
		}

		this.db.exec("BEGIN");
		try {
			const insertService = this.db.prepare("INSERT INTO services (name, tier) VALUES (?, ?)");
			const serviceIdByName = new Map<string, number | bigint>();
			for (const service of MERCADINHO_SERVICES) {
				const { lastInsertRowid } = insertService.run(service.name, service.tier);
				serviceIdByName.set(service.name, lastInsertRowid);
			}

			const insertAlert = this.db.prepare(
				"INSERT INTO alerts (title, service_id, severity, status) VALUES (?, ?, ?, ?)",
			);
			for (const alert of MERCADINHO_ALERTS) {
				const serviceId = serviceIdByName.get(alert.service);
				insertAlert.run(alert.title, serviceId as number, alert.severity, alert.status);
			}

			const insertRunbook = this.db.prepare("INSERT INTO runbooks (service_id, content) VALUES (?, ?)");
			for (const runbook of MERCADINHO_RUNBOOKS) {
				const serviceId = serviceIdByName.get(runbook.service);
				insertRunbook.run(serviceId as number, runbook.content);
			}

			this.db.exec("COMMIT");
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	private findServiceId(service: string): number | undefined {
		const row = this.db.prepare("SELECT id FROM services WHERE name = ?").get(service) as
			| { id: number }
			| undefined;
		return row?.id;
	}

	async listAlerts(status?: AlertStatus): Promise<Alert[]> {
		const sql = `
			SELECT alerts.id AS id, alerts.title AS title, services.name AS service,
			       alerts.severity AS severity, alerts.status AS status
			FROM alerts
			JOIN services ON services.id = alerts.service_id
			${status ? "WHERE alerts.status = ?" : ""}
			ORDER BY alerts.id ASC
		`;
		const stmt = this.db.prepare(sql);
		const rows = (status ? stmt.all(status) : stmt.all()) as unknown as AlertRow[];
		return rows;
	}

	async listIncidents(status?: IncidentStatus): Promise<Incident[]> {
		const sql = `
			SELECT incidents.id AS id, incidents.title AS title, services.name AS service,
			       incidents.severity AS severity, incidents.status AS status,
			       incidents.resolved_at AS resolved_at, incidents.summary AS summary
			FROM incidents
			JOIN services ON services.id = incidents.service_id
			${status ? "WHERE incidents.status = ?" : ""}
			ORDER BY incidents.id ASC
		`;
		const stmt = this.db.prepare(sql);
		const rows = (status ? stmt.all(status) : stmt.all()) as unknown as IncidentRow[];
		return rows.map(toIncident);
	}

	async openIncident(input: OpenIncidentInput): Promise<Incident> {
		const serviceId = this.findServiceId(input.service);
		if (serviceId === undefined) {
			throw new ServiceNotFoundError(input.service);
		}

		const { lastInsertRowid } = this.db
			.prepare("INSERT INTO incidents (title, service_id, severity, status) VALUES (?, ?, ?, 'open')")
			.run(input.title, serviceId, input.severity);

		return {
			id: Number(lastInsertRowid),
			title: input.title,
			service: input.service,
			severity: input.severity,
			status: "open",
			resolvedAt: null,
			summary: null,
		};
	}

	async resolveIncident(id: number): Promise<Incident> {
		const row = this.db
			.prepare(
				`SELECT incidents.id AS id, incidents.title AS title, services.name AS service,
				        incidents.severity AS severity, incidents.status AS status,
				        incidents.resolved_at AS resolved_at, incidents.summary AS summary
				 FROM incidents
				 JOIN services ON services.id = incidents.service_id
				 WHERE incidents.id = ?`,
			)
			.get(id) as IncidentRow | undefined;

		if (!row) {
			throw new IncidentNotFoundError(id);
		}
		if (row.status === "resolved") {
			return toIncident(row);
		}

		const resolvedAt = new Date().toISOString();
		this.db
			.prepare("UPDATE incidents SET status = 'resolved', resolved_at = ? WHERE id = ?")
			.run(resolvedAt, id);

		return toIncident({ ...row, status: "resolved", resolved_at: resolvedAt });
	}

	async getRunbook(service: string): Promise<Runbook> {
		const row = this.db
			.prepare(
				`SELECT services.name AS service, runbooks.content AS content
				 FROM runbooks
				 JOIN services ON services.id = runbooks.service_id
				 WHERE services.name = ?`,
			)
			.get(service) as Runbook | undefined;

		if (!row) {
			throw new RunbookNotFoundError(service);
		}
		return row;
	}

	/** Fecha o arquivo/handle do SQLite — usado pelos testes para não vazar handles entre casos. */
	close(): void {
		this.db.close();
	}
}

import { z } from "zod";
import type { RequestStatRow, RequestStore } from "../store/request-store.js";
import { requestCost, type ModelPrices } from "./pricing.js";

const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
const MAX_WINDOW_MS = 30 * UNIT_MS.d;
const SINCE_PATTERN = /^([1-9]\d*)([mhd])$/;

export const DEFAULT_SINCE = "24h";

/** Janela em milissegundos de um `since` já validado (pura). */
export function windowMs(since: string): number {
	const match = SINCE_PATTERN.exec(since);
	if (!match) {
		throw new RangeError(`since inválido: ${since}`);
	}
	return Number(match[1]) * UNIT_MS[match[2] as keyof typeof UNIT_MS];
}

/** `since` do `GET /stats` (specs/017, FR-001): `<n>m|h|d`, n ≥ 1, no máximo 30 dias. */
export const sinceSchema = z
	.string()
	.regex(SINCE_PATTERN, "use <n>m, <n>h ou <n>d")
	// zod 4 roda o refine mesmo quando o regex falha: só mede o que casou.
	.refine((since) => !SINCE_PATTERN.test(since) || windowMs(since) <= MAX_WINDOW_MS, "no máximo 30d");

/** Percentil por posto mais próximo (pura, FR-005): não muta a entrada; vazio → `null`. */
export function percentile(values: readonly number[], p: number): number | null {
	if (values.length === 0) {
		return null;
	}
	const sorted = [...values].sort((a, b) => a - b);
	const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
	return sorted[rank - 1] ?? null;
}

export interface StatsBlock {
	total: number;
	errors: number;
	errorRate: number;
	/** USD estimado só sobre `promptTokens`; `unpriced` = turnos de custo desconhecido. */
	cost: { usd: number; unpriced: number };
	latencyMs: { p50: number | null; p95: number | null };
}

export interface StatsSummary extends StatsBlock {
	byRoute: Array<{ route: string | null } & StatsBlock>;
	byModel: Array<{ model: string | null } & StatsBlock>;
}

export interface StatsReport extends StatsSummary {
	since: string;
	from: string;
	to: string;
}

const round = (value: number, digits: number): number => Number(value.toFixed(digits));

function blockOf(rows: readonly RequestStatRow[], prices: ModelPrices): StatsBlock {
	const errors = rows.filter((r) => r.outcome === "error").length;
	const costs = rows.map((r) => requestCost(r, prices));
	const durations = rows.map((r) => r.durationMs);
	return {
		total: rows.length,
		errors,
		errorRate: rows.length === 0 ? 0 : round(errors / rows.length, 4),
		cost: {
			usd: round(costs.reduce<number>((sum, c) => sum + (c ?? 0), 0), 6),
			unpriced: costs.filter((c) => c === null).length,
		},
		latencyMs: { p50: percentile(durations, 50), p95: percentile(durations, 95) },
	};
}

/** Chave asc com `null` por último. */
function compareKeys(a: string | null, b: string | null): number {
	if (a === b) return 0;
	if (a === null) return 1;
	if (b === null) return -1;
	return a < b ? -1 : 1;
}

/** Agrupa por chave; ordem: `total` desc, depois chave asc, `null` por último (pura). */
function groupBy(rows: readonly RequestStatRow[], keyOf: (r: RequestStatRow) => string | null): Array<[string | null, RequestStatRow[]]> {
	const groups = new Map<string | null, RequestStatRow[]>();
	for (const r of rows) {
		const key = keyOf(r);
		groups.set(key, [...(groups.get(key) ?? []), r]);
	}
	return [...groups].sort(([ka, a], [kb, b]) => b.length - a.length || compareKeys(ka, kb));
}

/** Estatísticas de um conjunto de requisições (pura, specs/017 — FR-003..FR-006). */
export function computeStats(rows: readonly RequestStatRow[], prices: ModelPrices): StatsSummary {
	return {
		...blockOf(rows, prices),
		byRoute: groupBy(rows, (r) => r.route).map(([route, group]) => ({ route, ...blockOf(group, prices) })),
		byModel: groupBy(rows, (r) => r.modelUsed).map(([model, group]) => ({ model, ...blockOf(group, prices) })),
	};
}

export interface StatsQuery {
	since: string;
	now: Date;
	prices: ModelPrices;
}

/** Janela `[now - since, now]` sobre o `RequestStore` (Service, FR-002). */
export async function getStats(requests: RequestStore, { since, now, prices }: StatsQuery): Promise<StatsReport> {
	const to = now.toISOString();
	const from = new Date(now.getTime() - windowMs(since)).toISOString();
	const rows = (await requests.listSince(from)).filter((r) => r.startedAt <= to);
	return { since, from, to, ...computeStats(rows, prices) };
}

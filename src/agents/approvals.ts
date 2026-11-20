/**
 * Regras puras da aprovação de ações sensíveis (specs/018, research §1–§2 e
 * data-model.md). O portão (`approval-gate.ts`) e os serviços usam só isto.
 */
import type { TraceEvent } from "./strategy.js";

/** Ferramentas que mudam o estado da produção: só rodam depois de "Aprovar". */
export const SENSITIVE_TOOLS = ["open_incident", "resolve_incident"] as const;

export type SensitiveTool = (typeof SENSITIVE_TOOLS)[number];

/** Prazo para decidir; depois disso a aprovação expira e conta como negada (FR-013d). */
export const APPROVAL_TTL_MS = 15 * 60_000;

/** Observação devolvida ao agente no lugar da execução. */
export const APPROVAL_PENDING_OBSERVATION =
	"Ação aguardando aprovação do plantonista; não foi executada. Não execute outras ações sensíveis e encerre o turno informando que a ação depende de aprovação.";

/** Uma segunda ação sensível diferente no mesmo turno (só um cartão por vez). */
export const OTHER_PENDING_OBSERVATION =
	"Outra ação já aguarda aprovação do plantonista neste turno; esta não foi executada. Encerre o turno.";

export type DecidedStatus = "approved" | "denied" | "expired";

/** Chamada sensível interceptada pelo portão, com o id da aprovação que vai criar. */
export interface PendingCall {
	id: string;
	tool: string;
	args: unknown;
}

/** Decisão já tomada neste turno, consultada pelo portão no replay. */
export interface LedgerEntry {
	tool: string;
	args: unknown;
	status: DecidedStatus;
	result: string | null;
}

export function isSensitiveTool(name: string): name is SensitiveTool {
	return (SENSITIVE_TOOLS as readonly string[]).includes(name);
}

function canonical(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(canonical);
	}
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
		);
	}
	return value;
}

/** Chave estável de uma chamada: ferramenta + JSON canônico (chaves ordenadas). */
export function callKey(tool: string, args: unknown): string {
	return `${tool}:${JSON.stringify(canonical(args ?? {}))}`;
}

function field(args: unknown, key: string): string {
	const value = args !== null && typeof args === "object" ? (args as Record<string, unknown>)[key] : undefined;
	return value === undefined || value === null ? "?" : String(value);
}

/** A ação em linguagem humana, para o cartão e o rastro. */
export function approvalSummary(tool: string, args: unknown): string {
	switch (tool) {
		case "resolve_incident":
			return `Resolver o incidente #${field(args, "id")}`;
		case "open_incident":
			return `Abrir incidente ${field(args, "severity")} «${field(args, "title")}» em ${field(args, "service")}`;
		default:
			return `Executar ${tool}`;
	}
}

/** O que o portão devolve ao agente para uma chamada já decidida. */
export function ledgerObservation(entry: LedgerEntry): string {
	if (entry.status === "approved") {
		return `Aprovado pelo plantonista e executado. Resultado: ${entry.result ?? "(sem resultado)"}`;
	}
	return entry.status === "expired"
		? "Aprovação expirou: negado pelo plantonista; não executado."
		: "Negado pelo plantonista; não executado.";
}

const STATUS_TEXT: Record<DecidedStatus, string> = {
	approved: "aprovada e executada",
	denied: "negada, não executada",
	expired: "expirou, não executada",
};

/** Seção do prompt com as decisões do turno (nunca cortada pelo orçamento); vazia sem decisões. */
export function ledgerPromptSection(ledger: readonly LedgerEntry[]): string {
	if (ledger.length === 0) {
		return "";
	}
	const lines = ledger.map((entry) => {
		const base = `- ${approvalSummary(entry.tool, entry.args)}: ${STATUS_TEXT[entry.status]}`;
		return entry.status === "approved" && entry.result ? `${base}. Resultado: ${entry.result}` : base;
	});
	return ["Decisões do plantonista neste turno:", ...lines, "Não repita ações já decididas; conclua a resposta."].join("\n");
}

/**
 * Rastro de um turno pausado: o evento `approval` entra logo depois do
 * `action` da ferramenta pendente e o que veio depois é descartado (a resposta
 * daquele turno não vale). Sem o `action`, o evento vai no fim.
 */
export function insertApprovalEvent(trace: readonly TraceEvent[], pending: PendingCall): TraceEvent[] {
	const event: TraceEvent = {
		type: "approval",
		approvalId: pending.id,
		tool: pending.tool,
		args: pending.args,
		summary: approvalSummary(pending.tool, pending.args),
	};
	const index = trace.findIndex((e) => e.type === "action" && e.tool === pending.tool);
	return index === -1 ? [...trace, event] : [...trace.slice(0, index + 1), event];
}

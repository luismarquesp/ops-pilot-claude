/**
 * Decisão e retomada de ações sensíveis (specs/018, research §1 e §3) — Service.
 * A execução "exatamente uma vez" vem do `ApprovalStore.decide` atômico: só
 * quem vence a decisão executa a ação, via `ops-actions` (mesmos schemas e
 * regras das tools e do MCP).
 */
import type { OpsStore } from "../store/ops-store.js";
import type { Approval, ApprovalStore } from "../store/approval-store.js";
import { isSensitiveTool, type DecidedStatus, type LedgerEntry } from "../agents/approvals.js";
import { openIncidentAction, openIncidentInputSchema, resolveIncidentAction, resolveIncidentInputSchema } from "../agents/ops-actions.js";
import { IncidentNotFoundError, ServiceNotFoundError } from "./errors.js";
import { runTurn, type ChatDeps, type TurnResult } from "./chat-service.js";
import type { Route } from "../agents/router.js";

/**
 * Executa uma ação sensível aprovada. Erros de domínio viram `"Erro: …"`, como
 * as tools fazem. Argumentos inválidos lançam (o portão já validou pelo schema).
 */
export async function executeApproved(ops: OpsStore, tool: string, args: unknown): Promise<string> {
	if (!isSensitiveTool(tool)) {
		throw new Error(`${tool} não é uma ação sensível`);
	}
	try {
		const result =
			tool === "resolve_incident"
				? await resolveIncidentAction(ops, resolveIncidentInputSchema.parse(args))
				: await openIncidentAction(ops, openIncidentInputSchema.parse(args));
		return JSON.stringify(result);
	} catch (error) {
		if (error instanceof IncidentNotFoundError || error instanceof ServiceNotFoundError) {
			return `Erro: ${error.message}`;
		}
		throw error;
	}
}

export interface DecideDeps {
	approvals: ApprovalStore;
	ops: OpsStore;
	now?: () => Date;
}

/** Decide (atômico) e, se aprovou, executa uma vez e guarda o resultado. */
export async function decideApproval(id: string, decision: "approve" | "deny", { approvals, ops, now = () => new Date() }: DecideDeps): Promise<Approval> {
	const decided = await approvals.decide(id, decision === "approve" ? "approved" : "denied", now());
	if (decided.status !== "approved") {
		return decided;
	}
	const result = await executeApproved(ops, decided.tool, decided.args);
	await approvals.saveResult(id, result);
	return { ...decided, result };
}

function toLedgerEntry(approval: Approval): LedgerEntry {
	return { tool: approval.tool, args: approval.args, status: approval.status as DecidedStatus, result: approval.result };
}

/** Roda o turno de novo, na rota guardada, com o livro das decisões do turno. */
export async function resumeTurn(approval: Approval, { requestId }: { requestId?: string }, deps: ChatDeps & { approvals: ApprovalStore }): Promise<TurnResult> {
	const ledger = (await deps.approvals.ledger(approval.turnId)).map(toLedgerEntry);
	const status = approval.status as DecidedStatus;
	return runTurn(
		{
			message: approval.message,
			conversationId: approval.conversationId,
			...(approval.userId ? { userId: approval.userId } : {}),
			reflect: approval.reflect,
			...(requestId ? { requestId } : {}),
			resume: {
				turnId: approval.turnId,
				route: approval.route as Route,
				ledger,
				decision: {
					type: "decision",
					approvalId: approval.id,
					decision: status,
					...(approval.result !== null ? { result: approval.result } : {}),
				},
			},
		},
		deps,
	);
}

export async function listPendingApprovals(approvals: ApprovalStore, conversationId: string, now: Date = new Date()): Promise<Approval[]> {
	return approvals.listPending(conversationId, now);
}

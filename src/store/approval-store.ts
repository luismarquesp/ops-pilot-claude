/** Aprovações de ações sensíveis (specs/018, data-model.md) — Model. */

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";

export interface Approval {
	id: string;
	/** Igual em toda a cadeia de pausas do mesmo turno (research §1). */
	turnId: string;
	conversationId: string;
	requestId: string | null;
	/** Pergunta original, para o replay. */
	message: string;
	userId: string | null;
	/** Rota decidida na pausa; o replay a usa com `source: "resume"`. */
	route: string;
	reflect: boolean;
	tool: string;
	args: unknown;
	summary: string;
	status: ApprovalStatus;
	createdAt: string;
	expiresAt: string;
	decidedAt: string | null;
	/** Saída da ação aprovada (JSON do incidente ou `"Erro: …"`). */
	result: string | null;
}

export type NewApproval = Omit<Approval, "status" | "decidedAt" | "result">;

export interface ApprovalStore {
	create(approval: NewApproval): Promise<Approval>;
	/** Marca `expired` se o prazo venceu; `undefined` se não existe. */
	get(id: string, now: Date): Promise<Approval | undefined>;
	/** Pendentes da conversa em ordem de criação; expiradas são marcadas e omitidas. */
	listPending(conversationId: string, now: Date): Promise<Approval[]>;
	/**
	 * Decisão atômica: só uma vence. Lança `ApprovalNotFoundError`,
	 * `ApprovalAlreadyDecidedError` ou `ApprovalExpiredError`.
	 */
	decide(id: string, decision: "approved" | "denied", now: Date): Promise<Approval>;
	saveResult(id: string, result: string): Promise<void>;
	/** Aprovações já decididas do turno (aprovadas, negadas ou expiradas), em ordem de criação. */
	ledger(turnId: string): Promise<Approval[]>;
}

/** Venceu o prazo sem decisão (pura). */
export function isExpired(approval: Pick<Approval, "status" | "expiresAt">, now: Date): boolean {
	return approval.status === "pending" && now.getTime() >= Date.parse(approval.expiresAt);
}

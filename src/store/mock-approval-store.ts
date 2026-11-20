import { isExpired, type Approval, type ApprovalStore, type NewApproval } from "./approval-store.js";
import { ApprovalAlreadyDecidedError, ApprovalExpiredError, ApprovalNotFoundError } from "../services/errors.js";

/** `ApprovalStore` em memória — fake dos testes (specs/018). Guarda cópias. */
export function createMockApprovalStore(): ApprovalStore {
	const byId = new Map<string, Approval>();

	function current(id: string, now: Date): Approval | undefined {
		const approval = byId.get(id);
		if (approval && isExpired(approval, now)) {
			const expired: Approval = { ...approval, status: "expired" };
			byId.set(id, expired);
			return expired;
		}
		return approval;
	}

	const byCreation = (a: Approval, b: Approval) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);

	return {
		async create(input: NewApproval) {
			if (byId.has(input.id)) {
				throw new Error(`Aprovação já existe: ${input.id}`);
			}
			const approval: Approval = { ...structuredClone(input), status: "pending", decidedAt: null, result: null };
			byId.set(input.id, approval);
			return structuredClone(approval);
		},

		async get(id, now) {
			const approval = current(id, now);
			return approval ? structuredClone(approval) : undefined;
		},

		async listPending(conversationId, now) {
			return [...byId.keys()]
				.map((id) => current(id, now)!)
				.filter((a) => a.conversationId === conversationId && a.status === "pending")
				.sort(byCreation)
				.map((a) => structuredClone(a));
		},

		// Sem `await` entre ler e gravar: a decisão é atômica no laço de eventos.
		async decide(id, decision, now) {
			const before = byId.get(id);
			if (!before) {
				throw new ApprovalNotFoundError(id);
			}
			const approval = current(id, now)!;
			if (approval.status === "expired") {
				throw new ApprovalExpiredError(id);
			}
			if (approval.status !== "pending") {
				throw new ApprovalAlreadyDecidedError(id, approval.status);
			}
			const decided: Approval = { ...approval, status: decision, decidedAt: now.toISOString() };
			byId.set(id, decided);
			return structuredClone(decided);
		},

		async saveResult(id, result) {
			const approval = byId.get(id);
			if (approval) {
				byId.set(id, { ...approval, result });
			}
		},

		async ledger(turnId) {
			return [...byId.values()]
				.filter((a) => a.turnId === turnId && a.status !== "pending")
				.sort(byCreation)
				.map((a) => structuredClone(a));
		},
	};
}

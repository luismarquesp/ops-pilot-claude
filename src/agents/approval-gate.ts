/**
 * Portão de aprovação (specs/018, research §1): dentro do escopo de turno
 * aberto pelo `runTurn`, as tools sensíveis não executam — registram a
 * chamada pendente e devolvem uma observação fixa ao agente. No replay, o
 * livro de decisões responde pelas chamadas já decididas. Fora do escopo
 * (arena, bench, testes de estratégia) a tool executa como sempre.
 *
 * Não lança: o `ToolNode` do ReAct engoliria a exceção como observação.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import {
	APPROVAL_PENDING_OBSERVATION,
	callKey,
	ledgerObservation,
	OTHER_PENDING_OBSERVATION,
	type LedgerEntry,
	type PendingCall,
} from "./approvals.js";

interface ApprovalScope {
	ledger: Map<string, LedgerEntry>;
	pending?: PendingCall & { key: string };
	newId: () => string;
}

const scope = new AsyncLocalStorage<ApprovalScope>();

export interface TrackApprovalsOptions {
	/** Decisões já tomadas neste turno (replay). */
	ledger?: readonly LedgerEntry[];
	newId?: () => string;
}

/** Roda `fn` num escopo de aprovação e devolve a chamada pendente, se houve. */
export async function trackApprovals<T>(
	fn: () => Promise<T>,
	{ ledger = [], newId = randomUUID }: TrackApprovalsOptions = {},
): Promise<{ value: T; pending?: PendingCall }> {
	const state: ApprovalScope = { ledger: new Map(ledger.map((entry) => [callKey(entry.tool, entry.args), entry])), newId };
	const value = await scope.run(state, fn);
	return state.pending ? { value, pending: { id: state.pending.id, tool: state.pending.tool, args: state.pending.args } } : { value };
}

/** Chamada pendente do escopo atual — o nó da estratégia usa para cortar o rastro. */
export function currentPendingCall(): PendingCall | undefined {
	const pending = scope.getStore()?.pending;
	return pending ? { id: pending.id, tool: pending.tool, args: pending.args } : undefined;
}

/** Embrulha uma tool sensível; nome, descrição e schema são os mesmos. */
export function withApprovalGate(original: StructuredToolInterface): StructuredToolInterface {
	return tool(
		async (input: unknown) => {
			const state = scope.getStore();
			if (!state) {
				return original.invoke(input as never);
			}
			const key = callKey(original.name, input);
			const decided = state.ledger.get(key);
			if (decided) {
				return ledgerObservation(decided);
			}
			if (state.pending) {
				return state.pending.key === key ? APPROVAL_PENDING_OBSERVATION : OTHER_PENDING_OBSERVATION;
			}
			state.pending = { id: state.newId(), tool: original.name, args: input, key };
			return APPROVAL_PENDING_OBSERVATION;
		},
		{ name: original.name, description: original.description, schema: original.schema as never },
	) as unknown as StructuredToolInterface;
}

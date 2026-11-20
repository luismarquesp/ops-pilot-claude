/** Conversa persistente do chat (specs/007, data-model.md). */

export const MESSAGE_ROLES = ["user", "assistant"] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export interface Conversation {
	id: string;
	createdAt: string;
}

export interface ConversationMessage {
	role: MessageRole;
	content: string;
	createdAt: string;
}

/** Mensagem com posição estável e crescente na conversa — `messages.id` no SQLite (specs/012, research.md §2). */
export interface StoredMessage extends ConversationMessage {
	seq: number;
}

/** Resumo mesclado das mensagens que saíram da janela recente (specs/012, data-model.md). */
export interface ConversationSummary {
	summary: string;
	/** `seq` da última mensagem absorvida pelo resumo. */
	coveredUntil: number;
	/** Total acumulado de mensagens absorvidas. */
	messagesCovered: number;
	updatedAt: string;
}

export type NewConversationSummary = Omit<ConversationSummary, "updatedAt">;

/**
 * Model das conversas (constitution Princípio III). Implementações:
 * `SqliteConversationStore` (real) e `createMockConversationStore` (fake em
 * memória). Ver contracts/conversation-store.md.
 */
export interface ConversationStore {
	/** Cria uma conversa vazia com id UUID gerado pelo store. */
	create(): Promise<Conversation>;

	/**
	 * Acrescenta uma mensagem ao fim da conversa. Lança
	 * `ConversationNotFoundError` se o id não existir.
	 */
	append(conversationId: string, role: MessageRole, content: string): Promise<ConversationMessage>;

	/**
	 * As `limit` mensagens mais recentes, em ordem cronológica (mais antiga
	 * primeiro). Conversa sem mensagens → `[]`. Lança
	 * `ConversationNotFoundError` se o id não existir.
	 */
	lastMessages(conversationId: string, limit: number): Promise<ConversationMessage[]>;

	/**
	 * Mensagens com `seq > afterSeq`, em ordem cronológica (specs/012,
	 * contracts/conversation-store.md). `afterSeq = 0` → todas. Lança
	 * `ConversationNotFoundError` se o id não existir.
	 */
	messagesSince(conversationId: string, afterSeq: number): Promise<StoredMessage[]>;

	/** Resumo vigente, ou `undefined` se nunca houve. Lança `ConversationNotFoundError` se o id não existir. */
	getSummary(conversationId: string): Promise<ConversationSummary | undefined>;

	/**
	 * Grava o resumo só se não houver um ou se `coveredUntil` for maior que o
	 * atual — a cobertura nunca retrocede (research.md §6). Devolve se gravou.
	 * Resumo vazio ou contadores ≤ 0 rejeitam. Lança `ConversationNotFoundError`
	 * se o id não existir.
	 */
	saveSummary(conversationId: string, summary: NewConversationSummary): Promise<boolean>;
}

/**
 * Regra comum aos dois backends (contracts/conversation-store.md): resumo vazio
 * ou contadores não positivos são erro de programação — quem chama já filtra.
 */
export function assertValidSummary(summary: NewConversationSummary): void {
	if (summary.summary.trim().length === 0) {
		throw new Error("Resumo vazio não pode ser gravado");
	}
	if (!(summary.coveredUntil > 0) || !(summary.messagesCovered > 0)) {
		throw new Error("coveredUntil e messagesCovered devem ser positivos");
	}
}

import { randomUUID } from "node:crypto";
import { ConversationNotFoundError } from "../services/errors.js";
import {
	assertValidSummary,
	type Conversation,
	type ConversationMessage,
	type ConversationStore,
	type ConversationSummary,
	type MessageRole,
	type NewConversationSummary,
	type StoredMessage,
} from "./conversation-store.js";

/** Remove o `seq` interno: `append`/`lastMessages` seguem devolvendo `ConversationMessage`. */
function withoutSeq({ role, content, createdAt }: StoredMessage): ConversationMessage {
	return { role, content, createdAt };
}

/**
 * `ConversationStore` em memória, sem I/O — fake usado pelos testes do
 * Controller (specs/007, research.md §8). Cada chamada entrega uma instância
 * isolada. `seq` = posição 1-based na conversa; resumos seguem a mesma regra
 * monotônica do SQLite (specs/012, research.md §6).
 */
export function createMockConversationStore(): ConversationStore {
	const messagesById = new Map<string, StoredMessage[]>();
	const summariesById = new Map<string, ConversationSummary>();

	function messagesOf(conversationId: string): StoredMessage[] {
		const messages = messagesById.get(conversationId);
		if (!messages) {
			throw new ConversationNotFoundError(conversationId);
		}
		return messages;
	}

	return {
		async create(): Promise<Conversation> {
			const conversation = { id: randomUUID(), createdAt: new Date().toISOString() };
			messagesById.set(conversation.id, []);
			return conversation;
		},

		async append(conversationId: string, role: MessageRole, content: string): Promise<ConversationMessage> {
			const messages = messagesOf(conversationId);
			const message = { seq: messages.length + 1, role, content, createdAt: new Date().toISOString() };
			messages.push(message);
			return withoutSeq(message);
		},

		async lastMessages(conversationId: string, limit: number): Promise<ConversationMessage[]> {
			const messages = messagesOf(conversationId);
			return limit > 0 ? messages.slice(-limit).map(withoutSeq) : [];
		},

		async messagesSince(conversationId: string, afterSeq: number): Promise<StoredMessage[]> {
			return messagesOf(conversationId)
				.filter((message) => message.seq > afterSeq)
				.map((message) => ({ ...message }));
		},

		async getSummary(conversationId: string): Promise<ConversationSummary | undefined> {
			messagesOf(conversationId);
			const summary = summariesById.get(conversationId);
			return summary ? { ...summary } : undefined;
		},

		async saveSummary(conversationId: string, summary: NewConversationSummary): Promise<boolean> {
			assertValidSummary(summary);
			messagesOf(conversationId);
			const current = summariesById.get(conversationId);
			if (current && summary.coveredUntil <= current.coveredUntil) {
				return false;
			}
			summariesById.set(conversationId, { ...summary, updatedAt: new Date().toISOString() });
			return true;
		},
	};
}

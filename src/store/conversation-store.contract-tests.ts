import { test } from "node:test";
import assert from "node:assert/strict";
import { ConversationNotFoundError } from "../services/errors.js";
import type { ConversationStore } from "./conversation-store.js";

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

/**
 * Suíte de contrato de `ConversationStore` (contracts/conversation-store.md,
 * regras 1-5) — roda idêntica contra `SqliteConversationStore` e o fake em
 * memória. Persistência entre instâncias e CHECK do banco ficam só em
 * `sqlite-conversation-store.test.ts`.
 */
export function runConversationStoreContractTests(label: string, createStore: () => ConversationStore): void {
	test(`[${label}] create devolve ids distintos e conversa nova começa vazia`, async () => {
		const store = createStore();

		const first = await store.create();
		const second = await store.create();

		assert.notEqual(first.id, second.id);
		assert.match(first.id, /^[0-9a-f-]{36}$/);
		assert.deepEqual(await store.lastMessages(first.id, 12), []);
	});

	test(`[${label}] append + lastMessages preserva ordem, role e content`, async () => {
		const store = createStore();
		const { id } = await store.create();

		await store.append(id, "user", "quais alertas?");
		await store.append(id, "assistant", "3 disparando");

		const messages = await store.lastMessages(id, 12);
		assert.deepEqual(
			messages.map(({ role, content }) => ({ role, content })),
			[
				{ role: "user", content: "quais alertas?" },
				{ role: "assistant", content: "3 disparando" },
			],
		);
	});

	test(`[${label}] lastMessages(id, n) devolve só as n últimas, mais antiga primeiro`, async () => {
		const store = createStore();
		const { id } = await store.create();
		for (let i = 1; i <= 15; i += 1) {
			await store.append(id, i % 2 === 1 ? "user" : "assistant", `m${i}`);
		}

		const messages = await store.lastMessages(id, 12);

		assert.deepEqual(
			messages.map((message) => message.content),
			Array.from({ length: 12 }, (_, index) => `m${index + 4}`),
		);
	});

	test(`[${label}] append e lastMessages com id desconhecido rejeitam com ConversationNotFoundError`, async () => {
		const store = createStore();

		await assert.rejects(
			() => store.append(UNKNOWN_ID, "user", "oi"),
			(error) => error instanceof ConversationNotFoundError && error.conversationId === UNKNOWN_ID,
		);
		await assert.rejects(
			() => store.lastMessages(UNKNOWN_ID, 12),
			(error) => error instanceof ConversationNotFoundError && error.conversationId === UNKNOWN_ID,
		);
	});

	test(`[${label}] mensagens de uma conversa nunca aparecem em outra`, async () => {
		const store = createStore();
		const a = await store.create();
		const b = await store.create();

		await store.append(a.id, "user", "de A");
		await store.append(b.id, "user", "de B");

		assert.deepEqual(
			(await store.lastMessages(a.id, 12)).map((message) => message.content),
			["de A"],
		);
		assert.deepEqual(
			(await store.lastMessages(b.id, 12)).map((message) => message.content),
			["de B"],
		);
	});

	// --- Resumos (specs/012, contracts/conversation-store.md) ---

	async function withMessages(store: ConversationStore, count: number): Promise<string> {
		const { id } = await store.create();
		for (let i = 1; i <= count; i += 1) {
			await store.append(id, i % 2 === 1 ? "user" : "assistant", `m${i}`);
		}
		return id;
	}

	test(`[${label}] messagesSince devolve as mensagens posteriores a afterSeq, em ordem, com seq crescente`, async () => {
		const store = createStore();
		const id = await withMessages(store, 5);

		const all = await store.messagesSince(id, 0);
		assert.deepEqual(
			all.map(({ role, content }) => ({ role, content })),
			[
				{ role: "user", content: "m1" },
				{ role: "assistant", content: "m2" },
				{ role: "user", content: "m3" },
				{ role: "assistant", content: "m4" },
				{ role: "user", content: "m5" },
			],
		);
		for (let i = 1; i < all.length; i += 1) {
			assert.ok((all[i]?.seq ?? 0) > (all[i - 1]?.seq ?? 0));
		}

		const after = await store.messagesSince(id, all[2]?.seq ?? 0);
		assert.deepEqual(
			after.map((message) => message.content),
			["m4", "m5"],
		);
	});

	test(`[${label}] getSummary de conversa nunca resumida é undefined`, async () => {
		const store = createStore();
		const { id } = await store.create();

		assert.equal(await store.getSummary(id), undefined);
	});

	test(`[${label}] saveSummary grava e getSummary devolve o resumo com updatedAt`, async () => {
		const store = createStore();
		const id = await withMessages(store, 3);
		const [, , third] = await store.messagesSince(id, 0);

		assert.equal(await store.saveSummary(id, { summary: "resumo A", coveredUntil: third?.seq ?? 0, messagesCovered: 3 }), true);

		const saved = await store.getSummary(id);
		assert.equal(saved?.summary, "resumo A");
		assert.equal(saved?.coveredUntil, third?.seq);
		assert.equal(saved?.messagesCovered, 3);
		assert.ok(!Number.isNaN(Date.parse(saved?.updatedAt ?? "")));
	});

	test(`[${label}] saveSummary nunca retrocede a cobertura`, async () => {
		const store = createStore();
		const id = await withMessages(store, 4);
		const seqs = (await store.messagesSince(id, 0)).map((message) => message.seq);

		await store.saveSummary(id, { summary: "até m2", coveredUntil: seqs[1] ?? 0, messagesCovered: 2 });

		assert.equal(await store.saveSummary(id, { summary: "igual", coveredUntil: seqs[1] ?? 0, messagesCovered: 2 }), false);
		assert.equal(await store.saveSummary(id, { summary: "menor", coveredUntil: seqs[0] ?? 0, messagesCovered: 1 }), false);
		assert.equal((await store.getSummary(id))?.summary, "até m2");

		assert.equal(await store.saveSummary(id, { summary: "até m4", coveredUntil: seqs[3] ?? 0, messagesCovered: 4 }), true);
		assert.equal((await store.getSummary(id))?.summary, "até m4");
	});

	test(`[${label}] resumo de uma conversa nunca aparece em outra`, async () => {
		const store = createStore();
		const a = await withMessages(store, 2);
		const b = await withMessages(store, 2);
		const [first] = await store.messagesSince(a, 0);

		await store.saveSummary(a, { summary: "de A", coveredUntil: first?.seq ?? 0, messagesCovered: 1 });

		assert.equal(await store.getSummary(b), undefined);
	});

	test(`[${label}] métodos de resumo com id desconhecido rejeitam com ConversationNotFoundError`, async () => {
		const store = createStore();
		const notFound = (error: unknown) => error instanceof ConversationNotFoundError && error.conversationId === UNKNOWN_ID;

		await assert.rejects(() => store.messagesSince(UNKNOWN_ID, 0), notFound);
		await assert.rejects(() => store.getSummary(UNKNOWN_ID), notFound);
		await assert.rejects(() => store.saveSummary(UNKNOWN_ID, { summary: "x", coveredUntil: 1, messagesCovered: 1 }), notFound);
	});

	test(`[${label}] saveSummary rejeita resumo vazio e contadores não positivos`, async () => {
		const store = createStore();
		const id = await withMessages(store, 1);

		await assert.rejects(() => store.saveSummary(id, { summary: "   ", coveredUntil: 1, messagesCovered: 1 }));
		await assert.rejects(() => store.saveSummary(id, { summary: "ok", coveredUntil: 0, messagesCovered: 1 }));
		await assert.rejects(() => store.saveSummary(id, { summary: "ok", coveredUntil: 1, messagesCovered: 0 }));
		assert.equal(await store.getSummary(id), undefined);
	});
}

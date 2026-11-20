import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConversationContext } from "./history-service.js";
import { ConversationNotFoundError } from "./errors.js";
import { createFakeSummarizer } from "../agents/fake-summarizer.js";
import type { Summarizer } from "../agents/summarizer.js";
import { createMockConversationStore } from "../store/mock-conversation-store.js";
import { SqliteConversationStore } from "../store/sqlite-conversation-store.js";
import type { ConversationStore } from "../store/conversation-store.js";

/** Grava `m{from}..m{to}` alternando plantonista/OpsPilot (ímpar = user). */
async function appendRange(store: ConversationStore, id: string, from: number, to: number): Promise<void> {
	for (let i = from; i <= to; i += 1) {
		await store.append(id, i % 2 === 1 ? "user" : "assistant", `m${i}`);
	}
}

async function conversationWith(count: number, store: ConversationStore = createMockConversationStore()) {
	const { id } = await store.create();
	await appendRange(store, id, 1, count);
	return { store, id };
}

const contents = (messages: ReadonlyArray<{ content: string }>): string[] => messages.map((message) => message.content);
const names = (from: number, to: number): string[] => Array.from({ length: to - from + 1 }, (_, index) => `m${from + index}`);

test("loadConversationContext com 15 mensagens não chama o resumidor e devolve todas por extenso", async () => {
	const { store, id } = await conversationWith(15);
	const summarizer = createFakeSummarizer();

	const context = await loadConversationContext(id, { conversations: store, summarizer });

	assert.equal(summarizer.calls.length, 0);
	assert.deepEqual(contents(context.recent), names(1, 15));
	assert.equal(context.summary, undefined);
	assert.equal(context.event, undefined);
});

test("loadConversationContext com 16 mensagens resume as 8 mais antigas, grava e emite o evento", async () => {
	const { store, id } = await conversationWith(16);
	const summarizer = createFakeSummarizer();

	const context = await loadConversationContext(id, { conversations: store, summarizer });

	assert.equal(summarizer.calls.length, 1);
	assert.equal(summarizer.calls[0]?.previous, undefined);
	assert.deepEqual(contents(summarizer.calls[0]?.messages ?? []), names(1, 8));
	assert.deepEqual(contents(context.recent), names(9, 16));
	assert.ok(context.summary);
	assert.deepEqual(context.event, { type: "summarize", content: context.summary, messagesSummarized: 8 });

	const eighth = (await store.messagesSince(id, 0))[7];
	const saved = await store.getSummary(id);
	assert.equal(saved?.summary, context.summary);
	assert.equal(saved?.coveredUntil, eighth?.seq);
	assert.equal(saved?.messagesCovered, 8);
});

test("loadConversationContext reutiliza o resumo guardado sem chamar o resumidor de novo", async () => {
	const { store, id } = await conversationWith(16);
	const summarizer = createFakeSummarizer();
	const first = await loadConversationContext(id, { conversations: store, summarizer });

	await appendRange(store, id, 17, 22);
	const second = await loadConversationContext(id, { conversations: store, summarizer });

	assert.equal(summarizer.calls.length, 1);
	assert.equal(second.summary, first.summary);
	assert.equal(second.event, undefined);
	assert.deepEqual(contents(second.recent), names(9, 22));
});

test("loadConversationContext mescla o resumo anterior quando mais 8 mensagens saem da janela", async () => {
	const { store, id } = await conversationWith(16);
	const summarizer = createFakeSummarizer();
	const first = await loadConversationContext(id, { conversations: store, summarizer });

	await appendRange(store, id, 17, 24);
	const second = await loadConversationContext(id, { conversations: store, summarizer });

	assert.equal(summarizer.calls.length, 2);
	assert.equal(summarizer.calls[1]?.previous, first.summary);
	assert.deepEqual(contents(summarizer.calls[1]?.messages ?? []), names(9, 16));
	assert.deepEqual(contents(second.recent), names(17, 24));
	assert.ok(second.summary?.startsWith(first.summary ?? "?"));
	assert.equal(second.event?.messagesSummarized, 8);
	assert.equal((await store.getSummary(id))?.messagesCovered, 16);
});

test("loadConversationContext numa conversa legada de 40 mensagens resume 32 numa única chamada", async () => {
	const { store, id } = await conversationWith(40);
	const summarizer = createFakeSummarizer();

	const context = await loadConversationContext(id, { conversations: store, summarizer });

	assert.equal(summarizer.calls.length, 1);
	assert.equal(summarizer.calls[0]?.messages.length, 32);
	assert.deepEqual(contents(context.recent), names(33, 40));
	assert.equal(context.event?.messagesSummarized, 32);
});

for (const [label, summarizer] of [
	["que rejeita", createFakeSummarizer({ fail: true })],
	["que devolve texto vazio", createFakeSummarizer({ empty: true })],
] as const) {
	test(`loadConversationContext com resumidor ${label} não grava e mantém tudo por extenso`, async () => {
		const { store, id } = await conversationWith(16);
		const logged: unknown[] = [];

		const context = await loadConversationContext(id, { conversations: store, summarizer, log: (error) => logged.push(error) });

		assert.deepEqual(contents(context.recent), names(1, 16));
		assert.equal(context.summary, undefined);
		assert.equal(context.event, undefined);
		assert.equal(await store.getSummary(id), undefined);
		assert.equal(logged.length, 1);
	});
}

test("loadConversationContext com falha preserva o resumo anterior e todas as não resumidas", async () => {
	const { store, id } = await conversationWith(16);
	const first = await loadConversationContext(id, { conversations: store, summarizer: createFakeSummarizer() });
	await appendRange(store, id, 17, 24);

	const context = await loadConversationContext(id, {
		conversations: store,
		summarizer: createFakeSummarizer({ fail: true }),
		log: () => {},
	});

	assert.equal(context.summary, first.summary);
	assert.deepEqual(contents(context.recent), names(9, 24));
	assert.equal((await store.getSummary(id))?.messagesCovered, 8);
});

test("loadConversationContext sem resumidor nunca resume e usa resumo guardado + 8 mais recentes", async () => {
	const { store, id } = await conversationWith(16);
	const first = await loadConversationContext(id, { conversations: store, summarizer: createFakeSummarizer() });
	await appendRange(store, id, 17, 30);

	const context = await loadConversationContext(id, { conversations: store });

	assert.equal(context.summary, first.summary);
	assert.deepEqual(contents(context.recent), names(23, 30));
	assert.equal(context.event, undefined);
	assert.equal((await store.getSummary(id))?.messagesCovered, 8);
});

test("loadConversationContext com id desconhecido rejeita com ConversationNotFoundError", async () => {
	await assert.rejects(
		() => loadConversationContext("00000000-0000-4000-8000-000000000000", { conversations: createMockConversationStore() }),
		(error) => error instanceof ConversationNotFoundError,
	);
});

test("loadConversationContext reutiliza o resumo depois de reabrir o banco", async () => {
	const dir = mkdtempSync(join(tmpdir(), "opspilot-summary-"));
	const dbPath = join(dir, "opspilot.db");

	try {
		const first = new SqliteConversationStore(dbPath);
		const { id } = await conversationWith(16, first);
		const generated = await loadConversationContext(id, { conversations: first, summarizer: createFakeSummarizer() });
		first.close();

		const reopened = new SqliteConversationStore(dbPath);
		const summarizer = createFakeSummarizer();
		const context = await loadConversationContext(id, { conversations: reopened, summarizer });
		reopened.close();

		assert.equal(summarizer.calls.length, 0);
		assert.equal(context.summary, generated.summary);
		assert.deepEqual(contents(context.recent), names(9, 16));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("loadConversationContext concorrentes no limiar nunca absorvem as mesmas mensagens duas vezes", async () => {
	const { store, id } = await conversationWith(16);
	const slow: Summarizer = async (input) => {
		await new Promise((resolve) => setTimeout(resolve, 5));
		return createFakeSummarizer()(input);
	};

	const [a, b] = await Promise.all([
		loadConversationContext(id, { conversations: store, summarizer: slow }),
		loadConversationContext(id, { conversations: store, summarizer: slow }),
	]);

	assert.equal(a.summary, b.summary);
	assert.equal((await store.getSummary(id))?.messagesCovered, 8);
});

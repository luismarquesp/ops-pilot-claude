import { test } from "node:test";
import assert from "node:assert/strict";
import { createLocalEmbedder, EMBEDDING_DIMENSIONS } from "./embeddings.js";
import { RECALL_MIN_SCORE, SqliteMemoryStore } from "./memory-store.js";

/**
 * Testes com o modelo real (specs/008, research.md §8). A primeira execução
 * baixa o modelo; `OPSPILOT_SKIP_MODEL_TESTS=1` pula estes testes offline.
 */
const modelTest = { skip: process.env.OPSPILOT_SKIP_MODEL_TESTS === "1", timeout: 120_000 };

const FACT = "The payments database runs on PostgreSQL";
const QUESTION = "Which SQL engine stores our billing records?";
const DISTRACTOR = "My favourite colour is green";

function words(text: string): Set<string> {
	return new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

test("embed devolve um vetor de 384 posições com norma 1", modelTest, async () => {
	const vector = await createLocalEmbedder().embed(FACT);

	assert.ok(vector instanceof Float32Array);
	assert.equal(vector.length, EMBEDDING_DIMENSIONS);
	assert.ok(Math.abs(Math.hypot(...vector) - 1) < 1e-3);
});

test("recall acha um fato por uma pergunta sem nenhuma palavra em comum", modelTest, async () => {
	const questionWords = words(QUESTION);
	assert.deepEqual(
		[...words(FACT)].filter((word) => questionWords.has(word)),
		[],
	);

	const store = new SqliteMemoryStore(createLocalEmbedder(), ":memory:");
	await store.remember("alice", FACT);
	await store.remember("alice", DISTRACTOR);

	const recalled = await store.recall("alice", QUESTION);
	store.close();

	const [first] = recalled;
	assert.equal(first?.fact, FACT);
	assert.ok(first.score >= RECALL_MIN_SCORE, `score ${first.score} abaixo de ${RECALL_MIN_SCORE}`);
	const distractor = recalled.find((memory) => memory.fact === DISTRACTOR);
	if (distractor) {
		assert.ok(distractor.score < first.score);
	}
	console.log(`score do par fato/pergunta: ${first.score.toFixed(4)}`);
});

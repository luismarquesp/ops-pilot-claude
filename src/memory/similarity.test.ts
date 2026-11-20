import { test } from "node:test";
import assert from "node:assert/strict";
import { dot, findDuplicate, fromBlob, rankBySimilarity, toBlob } from "./similarity.js";

const vec = (...values: number[]): Float32Array => Float32Array.from(values);

/** Vetor unitário 2D cujo produto escalar com [1, 0] é exatamente `score`. */
const withScore = (score: number): Float32Array => vec(score, Math.sqrt(1 - score * score));

const candidate = (id: string, embedding: Float32Array, createdAt = "2026-09-30T00:00:00.000Z") => ({
	id,
	embedding,
	createdAt,
});

test("dot calcula o produto escalar", () => {
	assert.equal(dot(vec(1, 2, 3), vec(4, 5, 6)), 32);
	assert.equal(dot(vec(1, 0), vec(0, 1)), 0);
});

test("dot lança erro quando as dimensões diferem", () => {
	assert.throws(() => dot(vec(1, 2), vec(1, 2, 3)));
});

test("rankBySimilarity descarta abaixo do mínimo, inclui o limiar exato e ordena decrescente", () => {
	const query = vec(1, 0);
	const ranked = rankBySimilarity(
		query,
		[candidate("baixo", withScore(0.29)), candidate("limiar", vec(0.3, Math.sqrt(1 - 0.09))), candidate("alto", withScore(0.9))],
		{ limit: 3, minScore: 0.3 },
	);

	assert.deepEqual(
		ranked.map((item) => item.id),
		["alto", "limiar"],
	);
	assert.ok(Math.abs((ranked[0]?.score ?? 0) - 0.9) < 1e-6);
});

test("rankBySimilarity devolve no máximo `limit` itens", () => {
	const query = vec(1, 0);
	const candidates = [0.5, 0.6, 0.7, 0.8, 0.9].map((score) => candidate(`s${score}`, withScore(score)));

	const ranked = rankBySimilarity(query, candidates, { limit: 3, minScore: 0.3 });

	assert.deepEqual(
		ranked.map((item) => item.id),
		["s0.9", "s0.8", "s0.7"],
	);
});

test("rankBySimilarity desempata pelo createdAt mais recente", () => {
	const query = vec(1, 0);
	const ranked = rankBySimilarity(
		query,
		[candidate("antigo", vec(1, 0), "2026-01-01T00:00:00.000Z"), candidate("novo", vec(1, 0), "2026-09-01T00:00:00.000Z")],
		{ limit: 3, minScore: 0.3 },
	);

	assert.deepEqual(
		ranked.map((item) => item.id),
		["novo", "antigo"],
	);
});

test("findDuplicate devolve o mais similar só quando o score passa do limiar", () => {
	const query = vec(1, 0);

	assert.equal(findDuplicate(query, [candidate("igual", withScore(0.99)), candidate("perto", withScore(0.95))], 0.92)?.id, "igual");
	assert.equal(findDuplicate(query, [candidate("no-limiar", vec(0.92, Math.sqrt(1 - 0.92 * 0.92)))], 0.92), undefined);
	assert.equal(findDuplicate(query, [], 0.92), undefined);
});

test("toBlob/fromBlob fazem round-trip de um vetor de 384 posições", () => {
	const vector = Float32Array.from({ length: 384 }, (_, index) => Math.sin(index));

	const blob = toBlob(vector);

	assert.equal(blob.byteLength, 1536);
	assert.deepEqual(fromBlob(blob), vector);
});

test("fromBlob funciona sobre um Uint8Array desalinhado", () => {
	const vector = vec(0.25, -0.5, 1);
	const bytes = toBlob(vector);
	const padded = new Uint8Array(bytes.byteLength + 1);
	padded.set(bytes, 1);

	assert.deepEqual(fromBlob(padded.subarray(1)), vector);
});

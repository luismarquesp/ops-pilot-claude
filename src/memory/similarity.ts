/**
 * Funções puras de similaridade e serialização de embeddings (specs/008,
 * research.md §3/§4). Os vetores do embedder são normalizados, então o
 * produto escalar é o cosseno. Os limiares são comparados na precisão float32
 * dos vetores (`Math.fround`), para que "exatamente 0,3/0,92" se comporte como
 * a spec pede.
 */

export interface RankOptions {
	limit: number;
	minScore: number;
}

export type Scored<T> = T & { score: number };

/** Produto escalar; lança se as dimensões diferirem. */
export function dot(a: Float32Array, b: Float32Array): number {
	if (a.length !== b.length) {
		throw new Error(`Dimensões diferentes: ${a.length} vs ${b.length}`);
	}
	let sum = 0;
	for (let i = 0; i < a.length; i += 1) {
		sum += (a[i] ?? 0) * (b[i] ?? 0);
	}
	return sum;
}

/**
 * Pontua cada candidato contra `query`, ordena do mais para o menos similar
 * (empate: `createdAt` mais recente primeiro), corta em `limit` e descarta os
 * de score abaixo de `minScore` (limiar inclusivo — FR-003).
 */
export function rankBySimilarity<T extends { embedding: Float32Array; createdAt: string }>(
	query: Float32Array,
	candidates: readonly T[],
	{ limit, minScore }: RankOptions,
): Scored<T>[] {
	return candidates
		.map((candidate) => ({ ...candidate, score: dot(query, candidate.embedding) }))
		.sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt))
		.slice(0, limit)
		.filter((candidate) => candidate.score >= Math.fround(minScore));
}

/** O candidato mais similar, se o score passar estritamente de `threshold` (FR-002). */
export function findDuplicate<T extends { embedding: Float32Array }>(
	vector: Float32Array,
	candidates: readonly T[],
	threshold: number,
): Scored<T> | undefined {
	let best: Scored<T> | undefined;
	for (const candidate of candidates) {
		const score = dot(vector, candidate.embedding);
		if (best === undefined || score > best.score) {
			best = { ...candidate, score };
		}
	}
	return best !== undefined && best.score > Math.fround(threshold) ? best : undefined;
}

/** Bytes crus do `Float32Array` para a coluna BLOB. */
export function toBlob(vector: Float32Array): Uint8Array {
	return new Uint8Array(vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength));
}

/**
 * Inverso de `toBlob`. Copia os bytes antes de reinterpretá-los: o
 * `Uint8Array` vindo do SQLite pode ter `byteOffset` não múltiplo de 4.
 */
export function fromBlob(blob: Uint8Array): Float32Array {
	const copy = new Uint8Array(blob.byteLength);
	copy.set(blob);
	return new Float32Array(copy.buffer);
}

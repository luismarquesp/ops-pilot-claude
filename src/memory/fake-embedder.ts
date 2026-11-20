import type { Embedder } from "./embeddings.js";

export interface FakeEmbedder extends Embedder {
	/** Textos já embedados, na ordem das chamadas. */
	readonly calls: string[];
}

/**
 * Embedder determinístico só para testes (specs/008, research.md §8): cada
 * texto usado precisa estar declarado em `table`; o vetor é normalizado.
 */
export function createFakeEmbedder(table: Record<string, number[]>): FakeEmbedder {
	const calls: string[] = [];
	return {
		calls,
		async embed(text: string): Promise<Float32Array> {
			calls.push(text);
			const values = table[text];
			if (values === undefined) {
				throw new Error(`fake embedder: texto sem vetor: ${text}`);
			}
			const norm = Math.hypot(...values);
			return Float32Array.from(values, (value) => value / norm);
		},
	};
}

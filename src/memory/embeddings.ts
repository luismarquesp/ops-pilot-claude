/** Embeddings locais da memória semântica (specs/008, research.md §1/§2). */

export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIMENSIONS = 384;

export interface Embedder {
	/** Vetor unitário (norma 1) do texto. Mesma entrada → mesmo vetor. */
	embed(text: string): Promise<Float32Array>;
}

type Extractor = (text: string, options: { pooling: "mean"; normalize: boolean }) => Promise<{ data: ArrayLike<number> }>;

/**
 * Pipeline compartilhado por todos os embedders locais do processo. Guardamos a
 * *promise* para que chamadas concorrentes esperem o mesmo carregamento; se ele
 * falhar, a promise é descartada e a próxima chamada tenta de novo.
 */
let extractorPromise: Promise<Extractor> | undefined;

function loadExtractor(): Promise<Extractor> {
	extractorPromise ??= (async () => {
		const { pipeline } = await import("@huggingface/transformers");
		const extractor = await pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: "fp32" });
		return extractor as unknown as Extractor;
	})().catch((error: unknown) => {
		extractorPromise = undefined;
		throw error;
	});
	return extractorPromise;
}

/**
 * Embedder real: `all-MiniLM-L6-v2` local, `pooling: "mean"` + `normalize: true`
 * (research.md §1). Singleton preguiçoso — o modelo só é carregado no primeiro
 * `embed`, nunca no boot (research.md §2).
 */
export function createLocalEmbedder(): Embedder {
	return {
		async embed(text: string): Promise<Float32Array> {
			const extractor = await loadExtractor();
			const output = await extractor(text, { pooling: "mean", normalize: true });
			return Float32Array.from(output.data);
		},
	};
}

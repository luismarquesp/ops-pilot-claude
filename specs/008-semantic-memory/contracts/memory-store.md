# Contract: `Embedder` e `MemoryStore`

## `Embedder` (`src/memory/embeddings.ts`)

```ts
export interface Embedder {
	/** Vetor unitário (norma 1) do texto. Mesma entrada → mesmo vetor. */
	embed(text: string): Promise<Float32Array>;
}

export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIMENSIONS = 384;

/** Embedder real: singleton preguiçoso do pipeline (research §2). */
export function createLocalEmbedder(): Embedder;
```

- O pipeline é criado só na primeira chamada de `embed`. Chamadas concorrentes
  compartilham o mesmo carregamento, e uma falha no carregamento permite nova tentativa.
- Parâmetros fixos: `feature-extraction`, `dtype: "fp32"`, `{ pooling: "mean", normalize: true }`.

Fake para testes (`src/memory/fake-embedder.ts`, apenas testes):
`createFakeEmbedder(table: Record<string, number[]>): Embedder` normaliza o vetor
da tabela e lança erro para um texto ausente, para que o teste declare explicitamente cada entrada.

## `MemoryStore` (`src/memory/memory-store.ts`)

```ts
export const RECALL_LIMIT = 3;
export const RECALL_MIN_SCORE = 0.3;
export const DEDUP_THRESHOLD = 0.92;

export interface MemoryStore {
	remember(userId: string, fact: string): Promise<RememberResult>;
	recall(userId: string, query: string, k?: number /* default RECALL_LIMIT */): Promise<RecalledMemory[]>;
	forget(userId: string, memoryId: string): Promise<boolean>;
}

export class SqliteMemoryStore implements MemoryStore {
	constructor(embedder: Embedder, path?: string /* default DEFAULT_DB_PATH */);
}
```

| Operação | Pré-condição | Resultado |
|----------|--------------|-----------|
| `remember(u, f)` | `f` já validado (não vazio) | Se algum fato de `u` tem `dot > 0.92`: `{ memory: existente, created: false }`. Senão, insere e devolve `{ memory: novo, created: true }` |
| `recall(u, q)` | — | Até 3 fatos de `u` com `score >= 0.3`, ordem decrescente de score (empate: mais recente primeiro). Usuário sem fatos → `[]`, **sem** chamar o embedder |
| `forget(u, id)` | — | `true` se removeu um fato de `u` com esse id; `false` se não existe **ou** pertence a outro usuário |

Invariantes:
- Nenhuma operação lê ou altera fatos de outro `userId` (SC-002).
- Reabrir o store no mesmo arquivo preserva os fatos e não os duplica (FR-010/FR-011).
- Erros do embedder propagam sem tradução (research §9).

## Funções puras (`src/memory/similarity.ts`)

```ts
export function dot(a: Float32Array, b: Float32Array): number;           // lança erro se length difere
export function rankBySimilarity<T extends { embedding: Float32Array; createdAt: string }>(
	query: Float32Array, candidates: readonly T[], opts: { limit: number; minScore: number },
): Array<T & { score: number }>;
export function findDuplicate<T extends { embedding: Float32Array }>(
	vector: Float32Array, candidates: readonly T[], threshold: number,
): (T & { score: number }) | undefined;
export function toBlob(vector: Float32Array): Uint8Array;
export function fromBlob(blob: Uint8Array): Float32Array;             // copia (alinhamento)
```

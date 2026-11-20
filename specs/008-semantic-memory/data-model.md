# Data Model: Memória Semântica por Usuário

## Tabela `memories`

Mesmo arquivo `OPSPILOT_DB` das operações e conversas; DDL idempotente executado
pelo construtor do `SqliteMemoryStore` (research §3).

```sql
CREATE TABLE IF NOT EXISTS memories (
	id         TEXT PRIMARY KEY,                               -- UUID (crypto.randomUUID)
	user_id    TEXT NOT NULL CHECK (length(user_id) > 0),
	fact       TEXT NOT NULL CHECK (length(fact) > 0),
	embedding  BLOB NOT NULL,                                  -- Float32Array LE, 384 × 4 = 1536 bytes
	created_at TEXT NOT NULL                                   -- ISO-8601 UTC
);

CREATE INDEX IF NOT EXISTS memories_user_id ON memories (user_id);
```

Sem FK: não existe tabela de usuários (spec, Key Entities).

## Tipos de domínio (`src/memory/memory-store.ts`)

| Tipo | Campos | Notas |
|------|--------|-------|
| `Memory` | `id: string`, `userId: string`, `fact: string`, `createdAt: string` | O vetor **não** sai do store |
| `RememberResult` | `memory: Memory`, `created: boolean` | `created: false` → dedup devolveu o existente |
| `RecalledMemory` | `Memory & { score: number }` | `score` = produto escalar ∈ [-1, 1] |

## Regras de validação

| Regra | Onde | Origem |
|-------|------|--------|
| `userId`: string, trim, 1..128 | zod no `/chat` | FR-006, research §9 |
| `fact`: string, trim, 1..500 | zod na tool `remember_fact` + `CHECK` no SQL | edge case "fato vazio" |
| `memoryId`: UUID | zod na tool `forget_fact` | FR-005 |
| dedup: `score > 0.92` com fato **do mesmo usuário** | `findDuplicate` (puro) | FR-002 |
| recall: `score >= 0.3`, top 3, ordem decrescente (empate → mais recente) | `rankBySimilarity` (puro) | FR-003 |
| forget: `DELETE ... WHERE id = ? AND user_id = ?` | `SqliteMemoryStore` | FR-005, US3 cenário 2 |

## Ciclo de vida de um fato

```text
(inexistente) --remember, sem duplicata--> guardado --forget (dono)--> removido
                  remember, com duplicata --> (devolve o existente, nada muda)
```

Não há atualização de texto nem expiração (spec, Assumptions).

## Métrica nova

`ChatMetrics.memoryFacts: number` — quantos fatos foram injetados no turno (0..3),
ao lado de `historyMessages` (specs/007).

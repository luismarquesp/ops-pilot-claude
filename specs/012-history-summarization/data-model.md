# Data Model: Sumarização de Histórico (Pruning)

## Tabela `conversation_summaries` (SQLite, mesmo `OPSPILOT_DB`)

Criada pelo DDL idempotente do `SqliteConversationStore` (research.md §1).

```sql
CREATE TABLE IF NOT EXISTS conversation_summaries (
	conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
	summary TEXT NOT NULL CHECK (length(summary) > 0),
	covered_until INTEGER NOT NULL CHECK (covered_until > 0),
	messages_covered INTEGER NOT NULL CHECK (messages_covered > 0),
	updated_at TEXT NOT NULL
);
```

| Coluna | Significado |
|--------|-------------|
| `conversation_id` | conversa dona; no máximo um resumo por conversa (FR-001); `ON DELETE CASCADE` evita órfãos (FR-010) |
| `summary` | texto do resumo mesclado (meta ~150 tokens) |
| `covered_until` | `messages.id` da última mensagem absorvida (research.md §2) |
| `messages_covered` | total acumulado de mensagens absorvidas |
| `updated_at` | ISO 8601 da última gravação |

Regra de gravação (research.md §6): só substitui se `covered_until` novo >
atual — a cobertura nunca retrocede.

## Tipos (`src/store/conversation-store.ts`)

```ts
/** Mensagem com posição estável na conversa (messages.id no SQLite). */
interface StoredMessage extends ConversationMessage { seq: number }

interface ConversationSummary {
	summary: string;
	coveredUntil: number;     // seq da última mensagem absorvida
	messagesCovered: number;
	updatedAt: string;
}

type NewConversationSummary = Omit<ConversationSummary, "updatedAt">;
```

## Plano de histórico (`src/agents/history.ts`, puro)

```ts
const RECENT_WINDOW = 8;
const SUMMARY_BATCH = 8;

interface HistoryPlan<T> { toSummarize: T[]; recent: T[] }
planHistory<T>(unsummarized: readonly T[], opts?) : HistoryPlan<T>
```

Estados por turno (`u` = mensagens não resumidas no início do turno):

| `u` | Ação | Por extenso |
|-----|------|-------------|
| 0–15 | nenhuma | `u` |
| ≥ 16 | resume as `u − 8` mais antigas, mescladas ao resumo anterior | 8 |
| ≥ 16, resumidor falha | nenhuma gravação | `u` |

## Contexto da conversa (`src/services/history-service.ts`)

```ts
interface ConversationContext {
	summary?: string;               // resumo vigente (novo ou guardado)
	recent: HistoryMessage[];       // mensagens por extenso
	event?: SummarizeEvent;         // só no turno que gerou resumo novo
}
```

## Evento de rastro (`src/agents/strategy.ts`)

```ts
| { type: "summarize"; content: string; messagesSummarized: number }
```

`content` = resumo novo; `messagesSummarized` = mensagens absorvidas **neste**
turno.

## Métricas (emenda a specs/011)

`ContextBreakdown` ganha `summary: number`; `total = question + history +
memory + summary`. `historyMessages` = `recent.length`.

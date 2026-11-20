# Data Model: Conversa Persistente no Chat

## Tipos de domínio (`src/store/conversation-store.ts`)

```ts
type MessageRole = "user" | "assistant";

interface Conversation {
  id: string;          // UUID v4 (crypto.randomUUID)
  createdAt: string;   // ISO-8601
}

interface ConversationMessage {
  role: MessageRole;
  content: string;     // não vazio
  createdAt: string;   // ISO-8601
}

```

Relação: uma `Conversation` tem 0..N `ConversationMessage`, ordenadas pela ordem de
gravação. Mensagens nunca são editadas nem apagadas (sem transições de estado).

Ver a interface `ConversationStore` em
[contracts/conversation-store.md](./contracts/conversation-store.md).

## Tabelas SQLite (DDL idempotente no construtor)

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL CHECK (length(content) > 0),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS messages_conversation_id_id
  ON messages (conversation_id, id);
```

- **Ordem cronológica** = `messages.id` crescente (AUTOINCREMENT é monotônico);
  `created_at` é informativo, não é usado para ordenar (evita empate no mesmo ms).
- **Últimas N**: `SELECT ... WHERE conversation_id = ? ORDER BY id DESC LIMIT ?`,
  depois invertido para ordem cronológica.
- `CHECK` em `role` (domínio fechado) seguindo a regra do specs/004.

## Validação na fronteira (`src/http/server.ts`)

```ts
const chatRequestSchema = z.object({
  message: z.string().min(1),
  strategy: z.string().optional(),
  reflect: z.boolean().optional(),
  conversationId: z.uuid().optional(),   // novo
});
```

## Histórico e métrica (`src/agents/history.ts`)

```ts
const HISTORY_LIMIT = 12;
type HistoryMessage = Pick<ConversationMessage, "role" | "content">;

// pura: history vazio → question inalterada
function formatQuestionWithHistory(history: readonly HistoryMessage[], question: string): string;

function withHistory(
  strategy: ReasoningStrategy,
  history: readonly HistoryMessage[],
): ReasoningStrategy;
```

## Turno de chat (`src/services/chat-service.ts`)

```ts
interface ChatMetrics extends Metrics { historyMessages: number }

// historyMessages = número de mensagens carregadas por lastMessages
function runChat(input: { message; conversationId? }, deps: { strategy; conversations; timeoutMs }):
  Promise<StrategyResult & { conversationId: string; metrics: ChatMetrics }>;
```

## Erro de domínio (`src/services/errors.ts`)

```ts
class ConversationNotFoundError extends Error {
  constructor(public readonly conversationId: string);
}
```

Traduzido em `404 { error: "conversation_not_found", conversationId }` no Controller.

## Mapeamento requisitos → modelo

| Requisito | Onde |
|-----------|------|
| FR-001, FR-003 | `chatRequestSchema.conversationId`, resposta `conversationId` |
| FR-002 | `ConversationStore.create()` após sucesso |
| FR-004 | `ConversationNotFoundError` → 404 |
| FR-005, FR-006, FR-012 | `append(id, "user", …)` + `append(id, "assistant", answer)` só após sucesso, em `runChat` |
| FR-007, FR-008 | `lastMessages(id, HISTORY_LIMIT)` + `withHistory` |
| FR-009 | `metrics.historyMessages` (em `runChat`) |
| FR-010, FR-011 | tabelas `conversations`/`messages`, DDL idempotente |
| FR-013 | `":memory:"` + `createMockConversationStore` + estratégia fake |

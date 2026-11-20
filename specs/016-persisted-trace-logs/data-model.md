# Data Model: Rastro persistido + logs estruturados

## Tabelas (SQLite, `OPSPILOT_DB`, DDL idempotente no `SqliteRequestStore`)

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS requests (
	id               TEXT PRIMARY KEY,                 -- requestId (UUID)
	started_at       TEXT NOT NULL,                    -- ISO-8601
	duration_ms      INTEGER NOT NULL CHECK (duration_ms >= 0),
	status           INTEGER NOT NULL,                 -- status HTTP devolvido
	outcome          TEXT NOT NULL CHECK (outcome IN ('ok','error')),
	error_code       TEXT,                             -- null em 200; "conversation_not_found" | "model_unavailable" | "timeout" | "internal_error"
	conversation_id  TEXT,                             -- da resposta (200) ou do pedido; sem FK (conversa pode não existir no 404)
	user_id          TEXT,
	route            TEXT,                             -- do evento "route" do rastro; null sem rastro
	route_source     TEXT,                             -- "router" | "override" | "fallback"; null sem rastro
	model_used       TEXT,                             -- metrics.modelUsed; null em erro ou sem chamada
	prompt_tokens    INTEGER,                          -- metrics.promptTokens; null em erro ou sem uso informado
	latency_ms       INTEGER,                          -- metrics.latencyMs; null em erro
	metrics_json     TEXT                              -- JSON de ChatMetrics completo; null em erro
);

CREATE TABLE IF NOT EXISTS trace_events (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	request_id  TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
	seq         INTEGER NOT NULL CHECK (seq >= 0),     -- posição no trace (índice)
	type        TEXT NOT NULL,
	node        TEXT NOT NULL,
	payload     TEXT NOT NULL,                         -- JSON do GraphTraceEvent inteiro
	UNIQUE (request_id, seq)
);
```

## Tipos (`src/store/request-store.ts`)

```ts
type RequestErrorCode = "conversation_not_found" | "model_unavailable" | "timeout" | "internal_error";

interface RequestRecord {
	id: string;
	startedAt: string;
	durationMs: number;
	status: number;
	outcome: "ok" | "error";
	errorCode: RequestErrorCode | null;
	conversationId: string | null;
	userId: string | null;
	route: string | null;
	routeSource: string | null;
	modelUsed: string | null;
	promptTokens: number | null;
	latencyMs: number | null;
	metrics: ChatMetrics | null;
}

interface StoredRequest { request: RequestRecord; trace: GraphTraceEvent[] }

interface RequestStore {
	/** Registro + rastro numa transação: ambos ou nenhum (FR-006). Id repetido → lança. */
	save(record: RequestRecord, trace: readonly GraphTraceEvent[]): Promise<void>;
	/** Rastro em `seq` crescente; `undefined` se não existe. */
	get(id: string): Promise<StoredRequest | undefined>;
}
```

## Regras de validação

- Um `status` 200 tem `errorCode = null` e `metrics != null`. Um status ≠ 200
  tem `errorCode != null`, `metrics = null` e rastro vazio.
- `outcome` é `"ok"` com status 200 e `"error"` nos demais. `modelUsed`,
  `promptTokens` e `latencyMs` são colunas planas copiadas de `metrics`, para
  consultas por SQL sem parse de JSON (decisão de 2026-11-17, a partir do esboço
  do usuário); `metrics_json` guarda o `ChatMetrics` completo para o `GET`.
- `route` e `routeSource` vêm de `routeOf(trace)` (pura): o primeiro evento
  `type: "route"`. Sem evento, ficam `null`.
- `conversationId`:
  - em 200, o da resposta (inclusive uma conversa nova);
  - em erro, o do pedido, quando houver.
- O rastro gravado é exatamente o `ChatResult.trace` devolvido, na mesma ordem.

## Linha de log (`src/obs/logger.ts`)

```ts
type LogLevel = "info" | "warn" | "error";
type LogValue = string | number | boolean | null | readonly string[];
type LogFields = Record<string, LogValue | undefined>;   // undefined é omitido

// linha = JSON.stringify({ time, level, event, ...fields }) — uma por chamada
```

Eventos e campos: ver [contracts/logs.md](./contracts/logs.md).

## Ciclo de vida de uma requisição `/chat`

```text
middleware: id + header + log start
  ├─ JSON inválido / 400 / 422 ─────────────────────────────→ resposta (sem registro)
  └─ runChat
       ├─ sucesso ─→ recordRequest(200, metrics, trace) ─→ resposta 200
       └─ erro ────→ recordRequest(404|503|504|500, sem rastro) ─→ resposta de erro
finish: log end (status, durationMs, métricas numéricas se houver)
```

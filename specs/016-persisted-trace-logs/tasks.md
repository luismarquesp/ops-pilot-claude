---

description: "Task list for 016-persisted-trace-logs"
---

# Tasks: Rastro persistido + logs estruturados

**Input**: Design documents from `specs/016-persisted-trace-logs/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: obrigatórios pela constituição (Princípio II) e pelo FR-016
(montagem pura, testável sem banco nem rede). Os testes usam `node:test` via
`tsx`, com SQLite `:memory:`, `createMockRequestStore` e logger com destino em
array. Nunca rede. Escrever o teste, vê-lo falhar e só então implementar.

**Organization**:

- US1: `requestId` no corpo e no cabeçalho `X-Request-Id` de toda resposta do `/chat`.
- US2: persistência (`requests` e `trace_events`) e `GET /requests/:id`.
- US3: logs JSON de uma linha, só com metadados.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência pendente)
- **[Story]**: US1, US2, US3

## Path Conventions

Projeto único: `src/`, com testes `*.test.ts` ao lado do código. Estilo:

- tabs, ESM com imports `.js`;
- JSDoc curto em português citando `specs/016` e a seção do [research.md](./research.md);
- preservar o fim de linha de cada arquivo. São CRLF: `src/http/server.ts`,
  `src/http/server.test.ts`, `src/index.ts` e `AGENTS.md`. Os demais são LF,
  e arquivos novos também são LF.

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Conferir que `npm run typecheck` e `OPSPILOT_SKIP_MODEL_TESTS=1 npm test` estão verdes antes de começar (baseline). Nenhuma dependência nova. Criar o diretório `src/obs/`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: logger e erro de domínio usados por todas as stories
([contracts/logs.md](./contracts/logs.md), research §6).

- [X] T002 [P] Em `src/services/errors.ts`, adicionar `RequestNotFoundError extends Error`:
  - `constructor(public readonly requestId: string)`;
  - `this.name = "RequestNotFoundError"`;
  - mensagem `Requisição não encontrada: <id>`.
- [X] T003 [P] Criar `src/obs/logger.test.ts`. Deve falhar até o T004:
  - (a) `formatLogLine({ time, level, event, ...fields })` devolve JSON válido sem `\n`, mesmo com valores contendo quebras de linha;
  - (b) campos `undefined` são omitidos e listas de strings são preservadas;
  - (c) `createLogger({ sink, clock })`: `info`, `warn` e `error` chamam o `sink` exatamente uma vez cada, com `time` do `clock` (ISO), o `level` certo e o `event`;
  - (d) `silentLogger` não lança e não escreve nada.
- [X] T004 Criar `src/obs/logger.ts`:
  - tipos `LogLevel`, `LogValue = string | number | boolean | null | readonly string[]` e `LogFields = Record<string, LogValue | undefined>`;
  - `interface Logger { info(event: string, fields?: LogFields): void; warn(...); error(...) }`;
  - `formatLogLine` (pura);
  - `createLogger({ sink = (line) => process.stdout.write(line + "\n"), clock = () => new Date() } = {})`;
  - `silentLogger`.

**Checkpoint**: logger pronto. As stories podem começar.

---

## Phase 3: User Story 1 - Toda requisição ao chat tem um identificador (Priority: P1) 🎯 MVP

**Goal**: todo corpo e todo cabeçalho de resposta do `/chat` trazem o mesmo
`requestId` gerado pelo servidor ([contracts/chat-api.md](./contracts/chat-api.md), research §1).

**Independent Test**: um POST válido e um inválido devolvem `requestId` UUID,
igual no corpo e no `X-Request-Id`, e diferente entre os dois.

### Tests for User Story 1

- [X] T005 [P] [US1] Criar `src/obs/request-context.test.ts`. Deve falhar até o T007:
  - (a) `withRequestId({ a: 1 }, "id")` devolve `{ requestId: "id", a: 1 }` sem mutar a entrada;
  - (b) `requestIdOf(res)` devolve `res.locals.requestId` quando é string, senão `undefined`;
  - (c) com um app Express mínimo, o middleware `requestContext({ newId: () => "fixo" })` põe `X-Request-Id: fixo` e `res.locals.requestId`, e ignora um `X-Request-Id` enviado pelo cliente.
- [X] T006 [US1] Em `src/http/server.test.ts`, adicionar testes de `requestId`:
  - 200, 400 (corpo inválido), 422 (`unknown_strategy`), 404 (`conversation_not_found`), 503 (estratégia que lança `ModelUnavailableError`), 504 (`hangingStrategy` com `timeoutMs` curto), 500 por JSON malformado (corpo `"{"` com `content-type: application/json`) e 500 por erro inesperado no turno (estratégia que lança `Error`);
  - em todos, `body.requestId` casa `/^[0-9a-f-]{36}$/` e é igual a `res.headers.get("x-request-id")`;
  - os demais campos do corpo seguem como antes;
  - duas requisições têm ids diferentes;
  - um `X-Request-Id: cliente` enviado não é devolvido.

### Implementation for User Story 1

- [X] T007 [US1] Criar `src/obs/request-context.ts`:
  - `withRequestId(body, id)` (pura);
  - `requestIdOf(res)`;
  - `requestContext({ newId = randomUUID, logger = silentLogger, clock = Date.now } = {})`: gera o id, grava em `res.locals.requestId`, faz `res.setHeader("X-Request-Id", id)` e chama `next()`. Os logs de start e end entram no T025.
- [X] T008 [US1] Em `src/http/server.ts`:
  - registrar `app.use("/chat", requestContext({ newId: opts.newRequestId }))` **antes** de `app.use(express.json())`;
  - adicionar `newRequestId?: () => string` em `CreateAppOptions`;
  - embrulhar todo `res.status(...).json(body)` do handler `/chat` com `withRequestId(body, requestIdOf(res)!)`;
  - na rede de segurança, responder `requestIdOf(res) ? withRequestId({ error: "internal_error" }, id) : { error: "internal_error" }`;
  - para o 500 de erro inesperado dentro do turno, manter o `throw error` (a rede de segurança acrescenta o id).

**Checkpoint**: US1 completa. Rodar `npm run typecheck` e `npm test`.

---

## Phase 4: User Story 2 - Consultar depois o que aconteceu num turno (Priority: P2)

**Goal**: turnos validados são persistidos (registro + rastro, numa
transação) e consultáveis por `GET /requests/:id`
([data-model.md](./data-model.md), [contracts/requests-api.md](./contracts/requests-api.md), research §2 a §5).

**Independent Test**: um turno bem-sucedido, consultado pelo id, devolve
`trace` e `metrics` iguais (`deepEqual`) aos da resposta do `/chat`.

### Tests for User Story 2

- [X] T009 [P] [US2] Criar `src/store/request-store.contract-tests.ts` com `runRequestStoreContractTests(label, createStore)`, no molde de `src/store/conversation-store.contract-tests.ts`:
  - (a) `save` + `get` devolve o mesmo `RequestRecord` (`metrics` inclusive) e o rastro na mesma ordem e com o mesmo conteúdo (`deepEqual`);
  - (b) registro de erro com `metrics: null` e rastro vazio → `get` devolve `trace: []`;
  - (c) `get` de id inexistente → `undefined`;
  - (d) `save` com id repetido lança, e o registro original não muda.
- [X] T010 [P] [US2] Criar `src/store/mock-request-store.test.ts`:
  - rodar o contract test contra `createMockRequestStore()`;
  - com `failOnSave: true`, `save` rejeita e nada é gravado.
- [X] T011 [P] [US2] Criar `src/store/sqlite-request-store.test.ts`:
  - rodar o contract test contra `new SqliteRequestStore(":memory:")`;
  - persistência entre instâncias com arquivo temporário (`mkdtempSync` em `os.tmpdir()`, apagado no fim);
  - atomicidade: um evento com `seq` duplicado forçado não deixa registro gravado;
  - `ON DELETE CASCADE`: `DELETE FROM requests` remove os `trace_events`;
  - DDL idempotente: dois construtores sobre o mesmo arquivo.
- [X] T012 [P] [US2] Criar `src/services/request-service.test.ts`:
  - (a) `routeOf(trace)` devolve `{ route, routeSource }` do primeiro evento `route`, ou `null`s sem ele;
  - (b) `buildRequestRecord` em sucesso: `status` 200, `outcome: "ok"`, `errorCode` `null`, `metrics` do resultado, `modelUsed`/`promptTokens`/`latencyMs` copiados de `metrics`, `conversationId` da resposta e rota do rastro;
  - (c) `buildRequestRecord` em erro: `outcome: "error"`, `metrics`, `modelUsed`, `promptTokens`, `latencyMs` e `route` `null`, `conversationId` do pedido e o `errorCode` dado;
  - (d) `recordRequest` com store saudável grava;
  - (e) `recordRequest` com `failOnSave` não lança e loga uma linha `request.persist.failed` com `requestId` e `errorName`, sem a mensagem do erro;
  - (f) `getRequest` de id inexistente lança `RequestNotFoundError`.
- [X] T013 [P] [US2] Criar `src/http/request-routes.test.ts` (app com `createRequestRouter(store)` sobre `createMockRequestStore()` pré-populado):
  - 200 `{ request, trace }`;
  - 400 `{ issues }` para id não-UUID;
  - 404 `{ error: "request_not_found", requestId }`.
- [X] T014 [US2] Em `src/http/server.test.ts`, estender `withServer` com `extra.requests` e adicionar:
  - 200 seguido de `GET /requests/:requestId` → `trace` e `metrics` `deepEqual` aos da resposta, `request.status === 200` e `route` igual ao da rota tomada;
  - 404 de conversa, 503 e 504 → registro com `status` e `errorCode` certos, `metrics: null` e `trace: []`;
  - 500 por erro inesperado no turno → registro `internal_error`;
  - 400 e 422 → `GET` devolve 404 (não persistidos);
  - `createMockRequestStore({ failOnSave: true })` → a resposta do `/chat` é idêntica (status e corpo) e o `GET` devolve 404;
  - sem `requests` nas deps, `GET /requests/<uuid>` devolve 404 do Express (rota não montada).

### Implementation for User Story 2

- [X] T015 [US2] Criar `src/store/request-store.ts` com `RequestErrorCode`, `RequestRecord`, `StoredRequest` e `RequestStore` conforme o [data-model.md](./data-model.md).
- [X] T016 [P] [US2] Criar `src/store/mock-request-store.ts`:
  - `createMockRequestStore({ failOnSave = false } = {})`, em memória (`Map`);
  - guardar cópias com `structuredClone`;
  - id repetido lança `Error`.
- [X] T017 [P] [US2] Criar `src/store/sqlite-request-store.ts`, no padrão do `SqliteConversationStore`:
  - construtor `(path = DEFAULT_DB_PATH)` com `mkdirSync` e DDL do data-model;
  - colunas planas `outcome`, `model_used`, `prompt_tokens` e `latency_ms` além de `metrics_json` (decisão de 2026-11-17, a partir do esboço do usuário);
  - `save` com `BEGIN` → `INSERT requests` → um `INSERT trace_events` por evento (`seq` = índice, `type`, `node`, `payload = JSON.stringify(event)`) → `COMMIT`, e `ROLLBACK` + relançar no `catch`;
  - `get` lê o registro e os eventos em `ORDER BY seq`, faz o parse do `payload` e do `metrics_json`;
  - `close()`.
- [X] T018 [US2] Criar `src/services/request-service.ts`:
  - `routeOf` e `buildRequestRecord({ requestId, startedAt, durationMs, status, errorCode, input, result? })` (puras);
  - `recordRequest({ requests, logger }, record, trace)`: `try { await requests.save(...) } catch (e) { logger.error("request.persist.failed", { requestId, errorName }) }`, nunca rejeita;
  - `getRequest(requests, id)` lança `RequestNotFoundError`.
- [X] T019 [US2] Criar `src/http/request-routes.ts`:
  - `createRequestRouter(requests)` com `GET /:id`;
  - validar com `z.object({ id: z.uuid() })`, chamar `getRequest` e responder `{ request, trace }`;
  - `RequestNotFoundError` → 404 `{ error: "request_not_found", requestId }`.
- [X] T020 [US2] Em `src/http/server.ts`:
  - adicionar `requests?: RequestStore` e `logger?: Logger` em `AppDeps` (`logger` padrão `silentLogger`);
  - no handler `/chat`, marcar `startedAt` e `t0` antes do `runChat`;
  - em sucesso, `await recordRequest(...)` com status 200 e `result.trace` antes do `res.json`;
  - no `catch`, para 404, 503 e 504, gravar com o `errorCode` correspondente antes de responder;
  - para erro inesperado, gravar `internal_error` com status 500 e depois `throw`;
  - só gravar quando `deps.requests` existir;
  - montar `app.use("/requests", createRequestRouter(deps.requests))` quando houver store.
- [X] T021 [US2] Em `src/index.ts`, criar `const requests = new SqliteRequestStore()` e passar `requests` ao `createApp`.

**Checkpoint**: US2 completa. Rodar `npm run typecheck` e `npm test`.

---

## Phase 5: User Story 3 - Logs estruturados e seguros para máquinas (Priority: P3)

**Goal**: uma linha JSON por acontecimento, com `requestId`, só com metadados
([contracts/logs.md](./contracts/logs.md), research §6 a §8).

**Independent Test**: com logger em array, um turno gera `start`, um
`chat.trace.event` por evento e `end`, todos com o mesmo `requestId` e sem
nenhum marcador de conteúdo.

### Tests for User Story 3

- [X] T022 [P] [US3] Criar `src/obs/log-fields.test.ts`:
  - (a) `traceEventLogFields(event, seq, requestId)` para cada tipo:
    - `thought`, `observation`, `answer`, `critique` → só `requestId`, `seq`, `type` e `node`;
    - `action` → + `tool`, sem `args`;
    - `route` → + `route` e `source`, sem `reason`;
    - `fallback` → + `from`, `to` e `reason`;
    - `summarize` → + `messagesSummarized`, sem `content`;
    - `plan` → + `steps` como número;
  - (b) um tipo desconhecido (cast) sai só com os campos base;
  - (c) `requestEndLogFields({ requestId, status, durationMs, errorCode?, route?, metrics? })` inclui `route`, `llmCalls`, `promptTokens`, `modelUsed`, `historyMessages` e `memoryFacts` só quando há `metrics`.
- [X] T023 [US3] Em `src/http/server.test.ts`, com `logger: createLogger({ sink: (l) => lines.push(l) })` em `extra`:
  - (a) turno 200 com estratégia cujo rastro tem `action` (args com marcador), `observation` e `answer` com marcadores únicos (ex.: `MARCADOR-OBS-123`), e pergunta com `MARCADOR-PERGUNTA-456`. Toda linha passa no `JSON.parse`. A ordem é `chat.request.start`, N × `chat.trace.event` (N = `trace.length`, `seq` 0..N-1) e `chat.request.end` com `status: 200`. Todas têm o mesmo `requestId`. Nenhuma linha contém um marcador;
  - (b) 503 → linha `model.unavailable` com `modelsTried` e `end` com `level: "warn"` e `errorCode`;
  - (c) erro inesperado com mensagem marcada → `http.unexpected_error` com `errorName`, sem o marcador;
  - (d) 400 → `start` e `end` com `status: 400`, sem `chat.trace.event`.

### Implementation for User Story 3

- [X] T024 [P] [US3] Criar `src/obs/log-fields.ts` com `traceEventLogFields` e `requestEndLogFields` (puras, lista permitida da research §7).
- [X] T025 [US3] Em `src/obs/request-context.ts`, completar o middleware:
  - logar `chat.request.start { requestId, method, path }` ao entrar;
  - em `res.on("finish")`, logar `chat.request.end` com `requestEndLogFields({ requestId, status: res.statusCode, durationMs: clock() - t0, errorCode: res.locals.errorCode, route: res.locals.route, metrics: res.locals.metrics })`;
  - nível `warn` quando `status >= 500`.
- [X] T026 [US3] Em `src/http/server.ts`:
  - passar `deps.logger` ao `requestContext`;
  - no sucesso, `res.locals.metrics = result.metrics`, `res.locals.route = routeOf(result.trace).route` e um `logger.info("chat.trace.event", traceEventLogFields(e, i, id))` por evento;
  - nos erros, `res.locals.errorCode = <código>`;
  - trocar o `console.warn` do 503 por `logger.warn("model.unavailable", { requestId, modelsTried })`;
  - trocar o `console.error(err)` da rede de segurança por `logger.error("http.unexpected_error", { requestId: requestIdOf(res), errorName: err instanceof Error ? err.name : typeof err })`;
  - repassar o `logger` ao `recordRequest`.
- [X] T027 [US3] Em `src/index.ts`, criar `const logger = createLogger()` e passar ao `createApp`. Os demais `console.*` do `index.ts` ficam como estão (research §8).

**Checkpoint**: US3 completa. Rodar `npm run typecheck` e `npm test`.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T028 [P] Em `AGENTS.md`, adicionar a seção "Rastro persistido e logs" (specs/016), no estilo das demais:
  - `requestId` e `X-Request-Id`;
  - tabelas `requests` e `trace_events`, `RequestStore`, `SqliteRequestStore` e `createMockRequestStore`;
  - gravação antes da resposta, com falha engolida;
  - `GET /requests/:id`;
  - `src/obs/logger.ts` e os eventos do contracts/logs.md;
  - só metadados.
- [X] T029 [P] Em `scripts/conversa-long.sh`, adicionar a coluna `req` com os 8 primeiros caracteres de `requestId` (ou `n/d` se ausente).
- [X] T030 Rodar `npm run typecheck` e `OPSPILOT_SKIP_MODEL_TESTS=1 npm test`: tudo verde. Executar o roteiro manual do [quickstart.md](./quickstart.md) se houver chave de API e registrar o resultado aqui.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001)** → **Foundational (T002–T004)** → stories.
- **US1 (T005–T008)**: depende só do Foundational.
- **US2 (T009–T021)**: depende de US1 (usa `requestIdOf` e o id do middleware como chave do registro).
- **US3 (T022–T027)**: depende de US1 (middleware). O T026 também toca o fluxo de gravação do T020, então fazer depois de US2 evita conflito em `server.ts`.
- **Polish (T028–T030)**: depois de todas as stories.

### Within Each User Story

- Testes antes da implementação (falhar primeiro).
- Interface do store (T015) → mock e SQLite (T016, T017) → Service (T018) → router (T019) → Controller (T020) → wiring (T021).

### Parallel Opportunities

- T002 ∥ T003.
- T005 em paralelo com o T006 (arquivos diferentes).
- US2: T009, T010, T011, T012 e T013 em paralelo; depois do T015, T016 ∥ T017.
- US3: T022 ∥ T024 (teste e função pura em arquivos distintos; o teste deve falhar primeiro).
- T028 ∥ T029.

## Parallel Example: User Story 2

```text
Task: "T009 contract tests em src/store/request-store.contract-tests.ts"
Task: "T011 testes do SQLite em src/store/sqlite-request-store.test.ts"
Task: "T012 testes do Service em src/services/request-service.test.ts"
Task: "T013 testes do router em src/http/request-routes.test.ts"
# depois do T015:
Task: "T016 createMockRequestStore em src/store/mock-request-store.ts"
Task: "T017 SqliteRequestStore em src/store/sqlite-request-store.ts"
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + Phase 2 (logger e erro).
2. Phase 3: `requestId` em toda resposta.
3. **Parar e validar**: `curl -si` no `/chat` mostra o cabeçalho e o campo iguais.

### Incremental Delivery

1. US1 → id citável em qualquer relato.
2. US2 → o id vira consulta completa (registro + rastro), sobrevivendo a reinícios.
3. US3 → logs JSON filtráveis por id, sem conteúdo.

Cada story mantém `npm run typecheck` e `npm test` verdes antes de seguir.

## Resultado da validação (2026-11-17)

- `npm run typecheck` verde; `OPSPILOT_SKIP_MODEL_TESTS=1 npm test`: 405 testes, 403 pass, 0 fail, 2 skipped (baseline: 353 pass; +50 novos).
- Quickstart manual com a API real (`OPSPILOT_DB` temporário, porta 3917):
  - `POST /chat` → 200, `X-Request-Id` igual ao `requestId` do corpo, `trace` com 4 eventos (`roteador:route`, `react:action`, `react:observation`, `react:answer`);
  - `GET /requests/:id` → `status 200`, `outcome ok`, `route react`, `modelUsed` e `promptTokens` preenchidos, mesmo rastro;
  - após reiniciar a API sobre o mesmo arquivo, o `GET` devolve o mesmo registro;
  - `GET /requests/nao-e-uuid` → 400; UUID inexistente → 404 `request_not_found`;
  - logs: 6 linhas JSON (start, 4 × `chat.trace.event`, end), nenhuma com o texto da pergunta ou da resposta.
- Decisão de 2026-11-17 (esboço do usuário): colunas planas `outcome`, `model_used`, `prompt_tokens`, `latency_ms` em `requests` e `route` no `chat.request.end`; a gravação ficou no Controller (não no nó `resposta`) para registrar também os erros de turno.

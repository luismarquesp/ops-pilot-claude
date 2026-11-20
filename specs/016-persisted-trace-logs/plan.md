# Implementation Plan: Rastro persistido + logs estruturados

**Branch**: `016-persisted-trace-logs` | **Date**: 2026-11-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/016-persisted-trace-logs/spec.md`

## Summary

Um middleware `requestContext`, montado em `/chat` **antes** do
`express.json()`, gera o `requestId` (`randomUUID`) e:

- grava o id em `res.locals`;
- escreve o cabeçalho `X-Request-Id`;
- loga `chat.request.start`;
- no `finish` da resposta, loga `chat.request.end` com status, duração e as
  métricas numéricas que o handler deixou em `res.locals`.

Todo corpo do `/chat`, inclusive o 500 da rede de segurança, ganha
`requestId` via a função pura `withRequestId`.

Depois de `runChat` (sucesso) ou de um erro de turno (404, 503, 504 e 500),
o Controller chama o Service `recordRequest`:

- monta o registro com funções puras (`buildRequestRecord`, `routeOf`);
- grava registro + rastro numa transação via `RequestStore.save`;
- engole e loga falhas de gravação (FR-007).

A gravação acontece **antes** do `res.json`, para que um `GET` logo em seguida
já encontre o registro. As linhas por evento do rastro saem de
`traceEventLogFields`, pura, que só copia campos de uma lista permitida.

`SqliteRequestStore` cria as tabelas `requests` e `trace_events` (FK
`ON DELETE CASCADE`) no mesmo `OPSPILOT_DB`. O router `GET /requests/:id`
(zod `uuid`) devolve `{ request, trace }`, e só é montado quando há
`RequestStore`, como o `/memories`.

O logger (`src/obs/logger.ts`) é uma fábrica com destino injetável:
`formatLogLine` é pura, e os campos aceitam só escalares e listas de strings.

## Technical Context

**Language/Version**: TypeScript (ESM, `strict: true`) sobre Node.js 22 LTS

**Primary Dependencies**:
- Express 5.2: middleware, `res.locals`, evento `finish` e erro assíncrono
  propagado à rede de segurança;
- `node:sqlite` (`DatabaseSync`), `node:crypto` (`randomUUID`) e zod 4.

Nenhuma dependência nova.

**Storage**: SQLite. Tabelas novas `requests` e `trace_events` no
`OPSPILOT_DB`, com DDL idempotente no construtor. Testes usam `:memory:`.

**Testing**: `node:test` via `tsx`, com:
- `createMockRequestStore` (com modo "falha ao gravar");
- logger com destino em array;
- um contract test compartilhado entre o mock e o SQLite, como o
  `conversation-store.contract-tests.ts`.

Sem rede.

**Target Platform**: servidor Node (API HTTP local)

**Project Type**: web-service (API Express) com agente LangChain/LangGraph

**Performance Goals**: sobrecarga desprezível frente às chamadas ao modelo.
A transação é síncrona e roda uma vez por turno (dezenas de linhas).

**Constraints**:
- resposta do `/chat` inalterada, exceto pelo `requestId` (FR-002);
- falha de persistência não muda a resposta (FR-007);
- logs só com metadados (FR-013);
- o grafo e as estratégias não mudam.

**Scale/Scope**:
- Novos:
  - `src/obs/logger.ts`, `src/obs/log-fields.ts`, `src/obs/request-context.ts`;
  - `src/store/request-store.ts`, `sqlite-request-store.ts`,
    `mock-request-store.ts` e os contract tests;
  - `src/services/request-service.ts`, `src/http/request-routes.ts`;
  - todos com teste.
- Ajustes:
  - `server.ts` (+ teste): middleware, `requestId` nos corpos, gravação e
    logger na rede de segurança e no 503;
  - `index.ts`: `SqliteRequestStore` e `createLogger()`;
  - `AGENTS.md`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Avaliação |
|-----------|-----------|
| I. Validação na Fronteira | ✅ `:id` do `GET /requests/:id` é validado com `z.uuid()`. O `X-Request-Id` do cliente não é lido. O corpo do `/chat` continua no `chatRequestSchema`. |
| II. Test-First | ✅ Funções puras (`formatLogLine`, `traceEventLogFields`, `requestEndLogFields`, `buildRequestRecord`, `routeOf`, `withRequestId`), stores (contract test), Service (falha engolida), router e Controller nascem com teste. |
| III. MVC | ✅ SQL só no `SqliteRequestStore` (Model). `recordRequest` (Service) monta e grava. Os routers só validam, traduzem e respondem. |
| IV. Erros de domínio na borda | ✅ `RequestNotFoundError` em `services/errors.ts`, traduzido para 404 `request_not_found` só no router. |
| V. Funções puras | ✅ Montagem de registro, linhas e campos de log é pura. O I/O (SQLite, stdout, relógio, UUID) fica em store, logger e middleware, com injeção de destino e relógio. |
| VI. Segredos | ✅ Logs com lista permitida de campos, sem conteúdo nem mensagens de erro. O payload do rastro persistido é o mesmo que o cliente já recebe. Nada é lido do `.env`. |

**Resultado**: aprovado. Reavaliado após research, data model e contracts:
continua aprovado, sem violações.

## Project Structure

### Documentation (this feature)

```text
specs/016-persisted-trace-logs/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── chat-api.md        # requestId no corpo + X-Request-Id
│   ├── requests-api.md    # GET /requests/:id
│   └── logs.md            # formato das linhas JSON e campos permitidos
├── checklists/
│   └── requirements.md
└── tasks.md               # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── obs/
│   ├── logger.ts                    # NOVO: Logger, createLogger(sink?, clock?), silentLogger, formatLogLine
│   ├── logger.test.ts               # NOVO
│   ├── log-fields.ts                # NOVO: traceEventLogFields, requestEndLogFields (puras, lista permitida)
│   ├── log-fields.test.ts           # NOVO
│   ├── request-context.ts           # NOVO: middleware requestContext, withRequestId, requestIdOf
│   └── request-context.test.ts      # NOVO
├── store/
│   ├── request-store.ts             # NOVO: RequestStore, RequestRecord, StoredRequest
│   ├── sqlite-request-store.ts      # NOVO: tabelas requests/trace_events, save transacional, get
│   ├── mock-request-store.ts        # NOVO: createMockRequestStore({ failOnSave? })
│   ├── request-store.contract-tests.ts  # NOVO
│   ├── sqlite-request-store.test.ts # NOVO
│   └── mock-request-store.test.ts   # NOVO
├── services/
│   ├── errors.ts                    # RequestNotFoundError
│   ├── request-service.ts           # NOVO: buildRequestRecord, routeOf, recordRequest, getRequest
│   └── request-service.test.ts      # NOVO
├── http/
│   ├── request-routes.ts            # NOVO: GET /requests/:id
│   ├── request-routes.test.ts       # NOVO
│   ├── server.ts                    # middleware, requestId nos corpos, recordRequest, logger
│   └── server.test.ts
└── index.ts                         # SqliteRequestStore + createLogger()

AGENTS.md                            # seção "Rastro persistido e logs"
```

**Structure Decision**: projeto único (`src/`) com testes colocalizados. Novo
diretório `src/obs/`, pedido pelo usuário, para logger e contexto de
requisição. O store segue o padrão de `src/store/` (interface + SQLite + mock
+ contract test).

## Complexity Tracking

Sem violações a justificar.

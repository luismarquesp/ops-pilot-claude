# Implementation Plan: Conversa Persistente no Chat

**Branch**: `007-persistent-conversation` | **Date**: 2026-09-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/007-persistent-conversation/spec.md`

## Summary

O `/chat` passa a aceitar um `conversationId` opcional e a devolvê-lo na resposta.
Um novo `ConversationStore` (`create`/`append`/`lastMessages`) persiste conversas e
mensagens em SQLite (tabelas `conversations` e `messages`, mesmo padrão do
`SqliteOpsStore`), com um fake em memória para testes. As 12 últimas mensagens entram
no prompt por composição — o decorador puro `withHistory` envolve a estratégia (por
fora da reflexão), reescreve a pergunta com o histórico e adiciona
`metrics.historyMessages`. Pergunta e resposta final só são gravadas quando o turno
termina com sucesso. Ver [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript (ESM, `strict: true`) sobre Node.js 22 LTS

**Primary Dependencies**: `express`, `zod` (v4 — `z.uuid()`), `@langchain/*` (inalterados); `node:sqlite`, `node:crypto` nativos

**Storage**: SQLite via `node:sqlite` (`DatabaseSync`), mesmo arquivo `OPSPILOT_DB` (default `./data/opspilot.db`); `:memory:` nos testes

**Testing**: `node:test` via `tsx`; suíte de contrato compartilhada (SQLite `:memory:` + fake); estratégia fake determinística no teste HTTP

**Target Platform**: servidor Node (Linux/Windows), processo único

**Project Type**: web-service (API HTTP de um agente)

**Performance Goals**: overhead de histórico desprezível frente à latência do LLM — leitura indexada limitada a 12 linhas por turno

**Constraints**: nenhuma dependência nova; estratégias existentes sem mudança de contrato; teto de 180s do chat inalterado

**Scale/Scope**: poucos operadores simultâneos; conversas de dezenas a centenas de mensagens

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Status | Como o design atende |
|-----------|--------|----------------------|
| I. Validação na Fronteira (Zod) | ✅ | `conversationId: z.uuid().optional()` no `chatRequestSchema`; nada chega ao store sem passar pelo schema |
| II. Test-First | ✅ | Suíte de contrato do store (`:memory:` + fake), testes puros de `history.ts`, integração HTTP com estratégia fake; `typecheck`/`test` verdes |
| III. Camadas (MVC) | ✅ | SQL só em `SqliteConversationStore` (Model); formatação/teto de histórico em `agents/history.ts`; Controller só valida, compõe e traduz |
| IV. Erros como classes na borda | ✅ | `ConversationNotFoundError` em `services/errors.ts`, traduzido em 404 só no Controller |
| V. Funções puras | ✅ | `formatQuestionWithHistory` e `withHistory` são puros; I/O isolado no store e no Controller |
| VI. Segredos | ✅ | Nenhum segredo novo; `.env` não é lido |
| Stack (node:sqlite, DDL idempotente, sem deps) | ✅ | `DatabaseSync` nativo, `CREATE ... IF NOT EXISTS`, `crypto.randomUUID()` nativo |

**Re-check pós-design**: ✅ nenhuma violação; Complexity Tracking vazio.

## Project Structure

### Documentation (this feature)

```text
specs/007-persistent-conversation/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── chat-api.md            # emenda ao contrato do specs/003
│   └── conversation-store.md
├── checklists/requirements.md
└── tasks.md                   # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── agents/
│   ├── history.ts                          # NOVO: HISTORY_LIMIT, formatQuestionWithHistory, withHistory
│   └── history.test.ts                     # NOVO
├── http/
│   ├── server.ts                           # conversationId, resolve estratégia, delega a runChat, traduz 404/504
│   └── server.test.ts                      # novos casos + createApp recebe ConversationStore
├── services/
│   ├── chat-service.ts                     # NOVO: runChat (histórico, timeout, gravação pós-sucesso, historyMessages)
│   ├── chat-service.test.ts                # NOVO
│   └── errors.ts                           # + ConversationNotFoundError, TimeoutError
├── store/
│   ├── conversation-store.ts               # NOVO: tipos + interface ConversationStore
│   ├── conversation-store.contract-tests.ts# NOVO: suíte de contrato compartilhada
│   ├── sqlite-conversation-store.ts        # NOVO: backend real (tabelas conversations/messages)
│   ├── sqlite-conversation-store.test.ts   # NOVO: contrato sobre ":memory:" + persistência em arquivo temporário
│   ├── mock-conversation-store.ts          # NOVO: createMockConversationStore (fake em memória)
│   ├── mock-conversation-store.test.ts     # NOVO: contrato sobre o fake
│   └── sqlite-ops-store.ts                 # só extrai DEFAULT_DB_PATH compartilhado
└── index.ts                                # composição: new SqliteConversationStore() → createApp
```

**Structure Decision**: projeto único existente; a feature segue os diretórios já
usados (`agents/` para composição de estratégia, `store/` para Model, `http/` para
Controller). `createApp` passa a receber o `ConversationStore` como dependência
explícita — `createApp(registry, conversations, opts)` — para que a composição em
`src/index.ts` injete o SQLite e os testes injetem o fake. `arena`, `bench` e o
servidor MCP não mudam.

## Complexity Tracking

Nenhuma violação a justificar.

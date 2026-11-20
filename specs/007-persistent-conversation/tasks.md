---

description: "Task list for Conversa Persistente no Chat"
---

# Tasks: Conversa Persistente no Chat

**Input**: Design documents from `specs/007-persistent-conversation/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/chat-api.md](./contracts/chat-api.md), [contracts/conversation-store.md](./contracts/conversation-store.md), [quickstart.md](./quickstart.md)

**Tests**: incluídos e obrigatórios — constitution Princípio II (Test-First), FR-013
e o pedido original ("testes: `:memory:` + fake"). Em cada fase, escrever o teste
primeiro e vê-lo falhar antes de implementar.

**Organization**: tarefas agrupadas por user story (spec.md) para permitir
implementação e teste independentes de cada uma.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: a qual user story esta tarefa pertence (US1, US2, US3)
- Caminhos de arquivo exatos em cada descrição

## Path Conventions

Projeto único Node/TypeScript (ver [plan.md](./plan.md#project-structure)):
`src/agents/`, `src/store/`, `src/http/`, `src/services/`; testes colocalizados como
`*.test.ts` (sem diretório `tests/`). Imports ESM com sufixo `.js`; indentação com tab.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: caminho default do banco compartilhado entre os dois stores SQLite (research.md §7)

- [X] T001 Extrair o default `process.env.OPSPILOT_DB ?? "./data/opspilot.db"` para uma constante exportada `DEFAULT_DB_PATH` em src/store/sqlite-ops-store.ts e usá-la no construtor do `SqliteOpsStore` (sem mudança de comportamento; `npm test` continua verde)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: tipos, interface, erro de domínio e fake do `ConversationStore` — usados por todas as histórias

**⚠️ CRITICAL**: nenhuma user story começa antes desta fase

- [X] T002 [P] Criar src/store/conversation-store.ts com `MessageRole = "user" | "assistant"`, interfaces `Conversation { id; createdAt }`, `ConversationMessage { role; content; createdAt }` e a interface `ConversationStore { create(); append(conversationId, role, content); lastMessages(conversationId, limit) }` (assinatura de `append` conforme o esboço de referência do /speckit-implement) com JSDoc conforme contracts/conversation-store.md
- [X] T003 [P] Adicionar `ConversationNotFoundError` (campo `public readonly conversationId: string`, mensagem `Conversa não encontrada: <id>`, `name = "ConversationNotFoundError"`) em src/services/errors.ts, no mesmo estilo das classes existentes
- [X] T004 Criar a suíte de contrato `runConversationStoreContractTests(label, createStore)` em src/store/conversation-store.contract-tests.ts cobrindo as regras 1–6 de contracts/conversation-store.md: ids distintos e conversa nova vazia; `append` + `lastMessages` preserva ordem/role/content; `lastMessages(id, n)` devolve só as n últimas em ordem cronológica (ex.: 15 mensagens, limit 12 → mensagens 4..15); `append`/`lastMessages` com id desconhecido rejeitam com `ConversationNotFoundError` com `conversationId` preenchido; isolamento entre conversas (depende de T002, T003)
- [X] T005 Criar src/store/mock-conversation-store.test.ts chamando `runConversationStoreContractTests("mock", () => createMockConversationStore())` — deve falhar até T006
- [X] T006 Implementar `createMockConversationStore()` (fake em memória: `Map<string, ConversationMessage[]>`, ids via `randomUUID` de `node:crypto`, `createdAt` ISO, `lastMessages` devolve cópia `slice(-limit)`) em src/store/mock-conversation-store.ts até T005 passar

**Checkpoint**: interface estável e fake verificado pelo contrato — US1 pode começar

---

## Phase 3: User Story 1 - Continuar uma conversa com o OpsPilot (Priority: P1) 🎯 MVP

**Goal**: `/chat` aceita `conversationId` opcional, devolve-o na resposta, e as até 12 últimas mensagens da conversa entram no raciocínio do turno seguinte.

**Independent Test**: com estratégia fake que registra a `question` recebida e `MockConversationStore`, enviar um turno sem id, pegar o `conversationId` devolvido, enviar um segundo turno com ele e verificar que a `question` do segundo contém pergunta e resposta do primeiro.

### Tests for User Story 1 ⚠️

- [X] T007 [P] [US1] Criar src/agents/history.test.ts com testes de `formatQuestionWithHistory`: histórico vazio devolve a pergunta inalterada; com histórico, devolve exatamente o formato de research.md §3 (`Histórico recente desta conversa (mais antigo primeiro):`, linhas `Plantonista: ...`/`OpsPilot: ...`, linha em branco, `Pergunta atual: ...`); e de `withHistory`: a estratégia interna recebe a pergunta formatada, `answer`/`trace` repassados sem mudança, `name` preservado, demais campos de `StrategyInput` (ex.: `maxIterations`) repassados
- [X] T008 [P] [US1] Criar src/store/sqlite-conversation-store.test.ts chamando `runConversationStoreContractTests("sqlite", () => new SqliteConversationStore(":memory:"))` e um teste de que o `CHECK` do banco rejeita `role` fora do enum (`"system" as never`)
- [X] T009 [US1] Atualizar src/http/server.test.ts: `createApp(registry, new MockConversationStore(), opts)` em todos os testes existentes; adicionar estratégia fake que grava cada `input.question` recebida; novos casos — (a) turno sem id → 200 com `conversationId` UUID e 2 mensagens gravadas (`user`=message, `assistant`=answer); (b) segundo turno com o id → mesmo `conversationId` devolvido e `question` contém o turno anterior; (c) id UUID inexistente → 404 `{ error: "conversation_not_found", conversationId }` e estratégia não chamada; (d) id malformado (`"abc"`) → 400 com `issues`; (e) 504 (hangingStrategy) e 422 não criam conversa nem gravam mensagens; (f) com `reflect: true` e crítico fake aprovando, o turno é gravado com o `answer` final; (g) com 8 turnos anteriores (16 mensagens), a `question` do próximo contém só as 12 últimas; (h) o `trace` nunca é gravado como mensagem

### Implementation for User Story 1

- [X] T010 [P] [US1] Implementar `SqliteConversationStore` em src/store/sqlite-conversation-store.ts no padrão do `SqliteOpsStore`: construtor `(path = DEFAULT_DB_PATH)`, `mkdirSync(dirname(path), { recursive: true })` se não for `:memory:`, DDL idempotente de data-model.md (tabelas `conversations`, `messages` com `CHECK` em `role` e `content`, índice `messages_conversation_id_id`), `create()` com `randomUUID()`, `append` de uma mensagem verificando existência da conversa antes (`ConversationNotFoundError`), `lastMessages` com `ORDER BY id DESC LIMIT ?` invertido, prepared statements em toda query, `close()` — até T008 passar
- [X] T011 [P] [US1] Implementar src/agents/history.ts: `export const HISTORY_LIMIT = 12`, função pura `formatQuestionWithHistory(history: readonly NewMessage[], question: string): string` e decorador `withHistory(strategy, history): ReasoningStrategy` que chama `strategy.run({ ...input, question: formatQuestionWithHistory(history, input.question) })` — até T007 passar (métrica fica para US3)
- [X] T012 [US1] Criar o serviço `runChat` em src/services/chat-service.ts (forma do esboço de referência; dono do `runWithTimeout` e de `TimeoutError`, movido para src/services/errors.ts) e atualizar src/http/server.ts para validar, resolver a estratégia, delegar a `runChat` e traduzir `ConversationNotFoundError` → 404 / `TimeoutError` → 504. Comportamento: assinatura `createApp(registry, conversations: ConversationStore, opts)`; `conversationId: z.uuid().optional()` no `chatRequestSchema`; após resolver a estratégia (422), se houver id carregar `conversations.lastMessages(id, HISTORY_LIMIT)` traduzindo `ConversationNotFoundError` em 404; compor `withHistory(reflect ? withReflection(base, opts.reflectionOptions) : base, history)`; após `runWithTimeout` com sucesso, `const id = conversationId ?? (await conversations.create()).id`, `append(id, "user", message)` e `append(id, "assistant", result.answer)` e responder `{ ...result, conversationId: id }` — até T009 passar (depende de T006 e T011; não depende de T010)
- [X] T013 [US1] Atualizar a composição em src/index.ts: `const conversations = new SqliteConversationStore();` e `createApp(registry, conversations)`

**Checkpoint**: US1 funcional — conversa de ponta a ponta via `npm run dev` (quickstart.md §2)

---

## Phase 4: User Story 2 - A conversa sobrevive a um restart (Priority: P2)

**Goal**: conversas e mensagens persistem no arquivo `OPSPILOT_DB` entre reinícios, sem duplicar nem apagar.

**Independent Test**: gravar uma conversa em um arquivo temporário, fechar o store, abrir outra instância sobre o mesmo arquivo e ler o mesmo histórico.

### Tests for User Story 2 ⚠️

- [X] T014 [US2] Em src/store/sqlite-conversation-store.test.ts, adicionar teste com `mkdtempSync(join(tmpdir(), "opspilot-"))`: instância A cria conversa e grava 4 mensagens, `close()`; instância B sobre o mesmo arquivo devolve as 4 mensagens na mesma ordem via `lastMessages`, e `append` continua funcionando; limpar com `rmSync(dir, { recursive: true, force: true })` no `finally` (mesmo padrão de src/store/sqlite-ops-store.test.ts)
- [X] T015 [US2] Em src/store/sqlite-conversation-store.test.ts, adicionar teste de que `SqliteOpsStore` e `SqliteConversationStore` abertos sobre o mesmo arquivo temporário coexistem (DDLs não conflitam; seed do Mercadinho intacto e conversa gravada legível)

### Implementation for User Story 2

- [X] T016 [US2] Ajustar src/store/sqlite-conversation-store.ts apenas se T014/T015 falharem — passaram de primeira, nenhuma mudança necessária

**Checkpoint**: US1 + US2 — quickstart.md §3 (restart) validável

---

## Phase 5: User Story 3 - Visibilidade de quanto histórico foi usado (Priority: P3)

**Goal**: toda resposta de sucesso do `/chat` traz `metrics.historyMessages` (0–12).

**Independent Test**: turnos sucessivos na mesma conversa devolvem `historyMessages` 0, 2, 4, …, estabilizando em 12.

### Tests for User Story 3 ⚠️

- [X] T017 [P] [US3] Criar src/services/chat-service.test.ts com testes de que `runChat` devolve `metrics` com `llmCalls`/`latencyMs` da estratégia e `historyMessages` = mensagens carregadas (0 em conversa nova), inclusive quando a estratégia é `withReflection(...)` com crítico fake
- [X] T018 [P] [US3] Em src/http/server.test.ts, adicionar caso que faz 8 turnos na mesma conversa e verifica `metrics.historyMessages` = 0, 2, 4, 6, 8, 10, 12, 12

### Implementation for User Story 3

- [X] T019 [US3] Em src/services/chat-service.ts, exportar `interface ChatMetrics extends Metrics { historyMessages: number }` e fazer `runChat` devolver `metrics: { ...result.metrics, historyMessages: history.length }` (como no esboço de referência) — até T017 e T018 passarem

**Checkpoint**: todas as histórias funcionais e independentes

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T020 [P] Atualizar AGENTS.md: mencionar `ConversationStore` (`src/store/conversation-store.ts`), `SqliteConversationStore`/`MockConversationStore`, e que o `/chat` aceita `conversationId` e usa as 12 últimas mensagens
- [X] T021 [P] Conferir que src/arena.ts, src/bench.ts e src/mcp/server.ts não precisam de mudança (não usam `createApp`); ajustar só se o typecheck acusar
- [X] T022 Rodar `npm run typecheck` e `npm test` — ambos verdes (constitution Princípio II)
- [ ] T023 Executar manualmente (parcial: 404/400 e criação das tabelas validados num servidor real com banco temporário; turnos com LLM pendentes) os cenários de quickstart.md §2–§4 com `npm run dev` (requer chave OpenRouter no ambiente)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências
- **Foundational (Phase 2)**: independe do Setup; T002/T003 podem começar já (T010, na US1, é quem usa o `DEFAULT_DB_PATH` de T001)
- **US1 (Phase 3)**: depende da Phase 2 completa
- **US2 (Phase 4)**: depende de T010 (SQLite store da US1)
- **US3 (Phase 5)**: depende de T011 e T012 (US1)
- **Polish (Phase 6)**: depende das histórias desejadas

### User Story Dependencies

- **US1 (P1)**: independente — é o MVP
- **US2 (P2)**: só testes sobre o store da US1; não depende do Controller
- **US3 (P3)**: estende `withHistory` da US1; pode ser feita em paralelo com US2

### Within Each User Story

- Testes escritos e falhando antes da implementação
- Store/decorador antes do Controller; Controller antes da composição em `index.ts`

### Parallel Opportunities

- T002 ∥ T003 (arquivos diferentes)
- T007 ∥ T008 (testes de arquivos diferentes); depois T010 ∥ T011
- Phase 4 (US2) ∥ Phase 5 (US3) depois da US1
- T017 ∥ T018; T020 ∥ T021

---

## Parallel Example: User Story 1

```text
# Testes em paralelo:
T007 src/agents/history.test.ts
T008 src/store/sqlite-conversation-store.test.ts

# Implementações em paralelo:
T010 src/store/sqlite-conversation-store.ts
T011 src/agents/history.ts

# Sequencial:
T009 → T012 (src/http/server.ts) → T013 (src/index.ts)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + Phase 2
2. Phase 3 (US1)
3. **STOP and VALIDATE**: `npm test` + quickstart.md §2

### Incremental Delivery

1. US1 → conversa funcional com histórico (MVP)
2. US2 → prova de persistência entre reinícios
3. US3 → métrica `historyMessages`
4. Polish → docs + validação final

---

## Notes

- [P] = arquivos diferentes, sem dependência de tarefa incompleta
- Nunca ler `.env`; nunca commitar sem `npm run typecheck` e `npm test` verdes
- Nenhuma dependência nova no `package.json`

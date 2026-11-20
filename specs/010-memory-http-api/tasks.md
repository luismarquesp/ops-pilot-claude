---

description: "Task list for API HTTP de Memória"
---

# Tasks: API HTTP de Memória

**Input**: Design documents from `specs/010-memory-http-api/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/memories-api.md](./contracts/memories-api.md), [quickstart.md](./quickstart.md)

**Tests**: incluídos e obrigatórios. A obrigação vem da constituição (Princípio II, Test-First) e do FR-010. Em cada fase, o teste é escrito primeiro e precisa falhar antes da implementação.

**Organization**: uma fase por user story:
- **US1 (P1)**: `POST /memories`.
- **US2 (P2)**: `GET /memories`.
- **US3 (P3)**: `DELETE /memories/:id`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: user story da tarefa (US1, US2, US3)

## Path Conventions

Projeto único Node/TypeScript, com testes ao lado do código (`*.test.ts`). Imports ESM usam sufixo `.js`, a indentação é com tab e o JSDoc é em português, citando `specs/010` e a seção do research. Os fakes da 008 são reaproveitados: `createFakeEmbedder` (src/memory/fake-embedder.ts) e `new SqliteMemoryStore(embedder, ":memory:")`. Os testes HTTP sobem o app numa porta efêmera, como o helper `withServer` de src/http/server.test.ts.

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Confirmar a linha de base: `npm run typecheck` e `OPSPILOT_SKIP_MODEL_TESTS=1 npm test` verdes antes de qualquer mudança

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: schemas compartilhados, erros de domínio, o router vazio montado no `createApp` e o helper de teste HTTP

**⚠️ CRITICAL**: nenhuma user story começa antes desta fase

- [X] T002 [P] Criar src/http/schemas.ts exportando `userIdSchema = z.string().trim().min(1).max(128)`, com JSDoc citando specs/008 (regra do `/chat`) e specs/010 research §3. Em src/http/server.ts, trocar `userId: z.string().trim().min(1).max(128).optional()` do `chatRequestSchema` por `userId: userIdSchema.optional()`. Os testes existentes do `/chat` devem continuar verdes.
- [X] T003 [P] Em src/memory/memory-tools.ts, extrair o schema de fato da tool `remember_fact` para `export const factSchema = z.string().trim().min(1).max(500)` e usar `factSchema.describe(...)` (mesma descrição de hoje) no schema da tool. Os testes de src/memory/memory-tools.test.ts devem continuar verdes.
- [X] T004 [P] Em src/services/errors.ts, no estilo das classes existentes, adicionar:
  - `SecretDetectedError`, sem campos, com mensagem `"Fato contém um possível segredo"` (sem o texto) e `name = "SecretDetectedError"`;
  - `MemoryNotFoundError`, com `public readonly memoryId: string`, mensagem `Memória não encontrada: <id>` e `name = "MemoryNotFoundError"`.
- [X] T005 Criar src/http/memory-routes.test.ts com:
  - o helper `withMemoryServer(callback, { memory?, table? })`. Ele monta `createApp({ strategiesFor: () => new Map([["react", fakeStrategy]]), conversations: createMockConversationStore(), memory }, {})` com `memory = new SqliteMemoryStore(createFakeEmbedder(table), ":memory:")` por padrão, sobe na porta 0 e chama `callback(baseUrl, memory)`. A `fakeStrategy` é uma estratégia espiã que registra as perguntas recebidas.
  - o helper `request(baseUrl, method, path, body?)`.
  - o primeiro caso: sem `memory` no `createApp`, `GET /memories?userId=luis` → 404.

  Depende de T002.
- [X] T006 Criar src/http/memory-routes.ts com `createMemoryRouter(memory: MemoryStore): Router` (`express.Router()`, ainda sem rotas) e JSDoc citando specs/010 contracts/memories-api.md. Em src/http/server.ts, no `createApp`, montar `app.use("/memories", createMemoryRouter(memory))` só quando `memory` existir, **antes** do handler de erro final. Faz T005 passar.

**Checkpoint**: typecheck + testes verdes; `/memories` montado e vazio

---

## Phase 3: User Story 1 - Registrar um fato diretamente (Priority: P1) 🎯 MVP

**Goal**: `POST /memories` grava com dedup (201/200), rejeita segredo (422) e entrada inválida (400), sem LLM.

**Independent Test**: um `POST` com `{ userId: "luis", fact }` devolve 201 e o fato; repetido, devolve 200 com o mesmo `id`; com `"minha senha: hunter2"`, devolve 422 e nada é gravado.

### Tests for User Story 1 ⚠️

- [X] T007 [P] [US1] Criar src/services/memory-service.test.ts com os casos de `registerFact`, sobre `SqliteMemoryStore(":memory:")` e um fake embedder que registra as chamadas:
  - um fato novo resulta em `created: true`;
  - um fato repetido resulta em `created: false`, com o mesmo `id`;
  - um fato com segredo (`"minha senha: hunter2"`) rejeita com `SecretDetectedError`, o embedder **não** é chamado e a mensagem do erro não contém `"hunter2"`.
- [X] T008 [US1] Acrescentar a src/http/memory-routes.test.ts:
  - `POST` válido (fact com espaços nas pontas) → 201, `{ memory: { id (UUID), userId: "luis", fact (com trim), createdAt } }`, **sem** campo `embedding`.
  - `POST` repetido → 200, com o mesmo `memory.id`.
  - O mesmo fato para outro `userId` → 201.
  - `POST` com segredo → 422 `{ error: "secret_detected" }`, o corpo serializado não contém `"hunter2"`, e `memory.recall`/`list` continua vazio.
  - `POST` inválido → 400 `{ issues }` para: sem `userId`, `userId: ""`, sem `fact`, `fact: "   "` e `fact` com 501 caracteres.
  - Embedder que lança (texto fora da tabela do fake) → 500 `{ error: "internal_error" }`, silenciando `console.error` durante o caso.
  - **Integração com o chat (SC-005)**: depois do `POST`, um `POST /chat` com o mesmo `userId` e uma mensagem mapeada no fake para um vetor próximo faz a estratégia espiã receber `"- <fato>"` na pergunta.

### Implementation for User Story 1

- [X] T009 [US1] Criar src/services/memory-service.ts com `registerFact(memory, { userId, fact }): Promise<RememberResult>`: se `containsSecret(fact)` (de src/memory/secrets.ts), lança `new SecretDetectedError()`; senão, devolve `memory.remember(userId, fact)`. O JSDoc cita specs/010 research §1/§2. Faz T007 passar.
- [X] T010 [US1] Em src/http/memory-routes.ts, adicionar `router.post("/", ...)`:
  1. Valida o body com `z.object({ userId: userIdSchema, fact: factSchema })`; em caso de falha, responde 400 `{ issues }`.
  2. Chama `registerFact` e responde `res.status(created ? 201 : 200).json({ memory })`.
  3. Em `catch`, `SecretDetectedError` vira 422 `{ error: "secret_detected" }`; outros erros são relançados para o handler 500 do app.

  Faz T008 passar.

**Checkpoint**: US1 funcional, e o comando do usuário `Invoke-RestMethod -Uri http://localhost:3000/memories -Method POST ...` passa a funcionar

---

## Phase 4: User Story 2 - Consultar o que o OpsPilot sabe sobre um usuário (Priority: P2)

**Goal**: `GET /memories?userId=` lista os fatos do usuário, do mais recente para o mais antigo, sem o embedding.

**Independent Test**: cadastrar 2 fatos para `luis` e 1 para `ana`. `GET ?userId=luis` devolve só os 2 de `luis`, o mais recente primeiro; `GET ?userId=ninguem` devolve `{ memories: [] }`.

### Tests for User Story 2 ⚠️

- [X] T011 [P] [US2] Acrescentar a src/memory/memory-store.test.ts os casos de `list`:
  - Devolve todos os fatos do usuário, do mais recente para o mais antigo. Inserir 3 fatos com vetores distintos (sem dedup) e esperar a ordem inversa da inserção. O empate de `created_at` no mesmo milissegundo é desfeito por inserção.
  - Usuário sem fatos → `[]`.
  - Isolamento: fatos de `bob` não aparecem em `list("alice")`.
  - Nenhum item tem `embedding`.
  - `list` não chama o embedder (`calls` do fake inalterado após a chamada).
- [X] T012 [P] [US2] Acrescentar a src/services/memory-service.test.ts: `listFacts(memory, "alice")` devolve o mesmo que `memory.list("alice")`.
- [X] T013 [US2] Acrescentar a src/http/memory-routes.test.ts:
  - `GET ?userId=luis` → 200 `{ memories }`, só os fatos de luis, com o mais recente primeiro e sem `embedding`.
  - `GET ?userId=ninguem` → 200 `{ memories: [] }`.
  - `GET` sem `userId` ou com `userId=` vazio → 400 `{ issues }`.

### Implementation for User Story 2

- [X] T014 [US2] Em src/memory/memory-store.ts:
  - Adicionar `list(userId: string): Promise<Memory[]>` à interface `MemoryStore`, com JSDoc conforme data-model.md.
  - Implementar no `SqliteMemoryStore` com prepared statement `SELECT id, user_id, fact, created_at FROM memories WHERE user_id = ? ORDER BY created_at DESC, rowid DESC` (sem a coluna `embedding`), mapeando para `Memory`.

  Faz T011 passar.
- [X] T015 [US2] Em src/services/memory-service.ts, adicionar `listFacts(memory, userId)`, que devolve `memory.list(userId)`. Em src/http/memory-routes.ts, adicionar `router.get("/", ...)`: valida `req.query` com `z.object({ userId: userIdSchema })` (400 se falhar) e responde 200 `{ memories: await listFacts(...) }`. Faz T012 e T013 passarem.

**Checkpoint**: US1 + US2 verdes

---

## Phase 5: User Story 3 - Remover um fato específico (Priority: P3)

**Goal**: `DELETE /memories/:id?userId=` remove só fatos do dono (204). Para fato inexistente ou de outro usuário, responde 404 indistinguível.

**Independent Test**: criar um fato de `luis`. `DELETE` com `userId=ana` → 404, e o fato continua no `GET`. `DELETE` com `userId=luis` → 204, e o fato some do `GET`.

### Tests for User Story 3 ⚠️

- [X] T016 [P] [US3] Acrescentar a src/services/memory-service.test.ts:
  - `removeFact` do próprio fato resolve, e `list` fica vazio.
  - `removeFact` de fato alheio rejeita com `MemoryNotFoundError`, com `memoryId` preenchido, e o fato permanece.
  - `removeFact` de UUID inexistente rejeita com `MemoryNotFoundError`.
- [X] T017 [US3] Acrescentar a src/http/memory-routes.test.ts:
  - `DELETE /memories/<id>?userId=luis` → 204 sem corpo, e o `GET` não traz mais o fato.
  - Com `userId=ana` → 404 `{ error: "memory_not_found", id }`, e o fato permanece.
  - UUID inexistente → 404 com o **mesmo formato** do caso anterior.
  - `id` não-UUID (`/memories/abc?userId=luis`) → 400 `{ issues }`.
  - Sem `userId` → 400 `{ issues }`.

### Implementation for User Story 3

- [X] T018 [US3] Em src/services/memory-service.ts, adicionar `removeFact(memory, { userId, memoryId }): Promise<void>`: se `!(await memory.forget(userId, memoryId))`, lança `new MemoryNotFoundError(memoryId)`. Faz T016 passar.
- [X] T019 [US3] Em src/http/memory-routes.ts, adicionar `router.delete("/:id", ...)`:
  1. Valida `req.params` com `z.object({ id: z.uuid() })` e `req.query` com `z.object({ userId: userIdSchema })`, juntando os `issues` de ambos num único 400.
  2. Chama `removeFact` e responde `res.status(204).end()`.
  3. Em `catch`, `MemoryNotFoundError` vira 404 `{ error: "memory_not_found", id: error.memoryId }`; outros erros são relançados.

  Faz T017 passar.

**Checkpoint**: as três histórias verdes

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T020 [P] Atualizar AGENTS.md, na seção "Memória semântica", com uma linha sobre a API direta (specs/010):
  - `POST /memories` (201 criado / 200 duplicado / 422 `secret_detected`);
  - `GET /memories?userId=`;
  - `DELETE /memories/:id?userId=` (204 / 404 indistinguível);
  - Service em `src/services/memory-service.ts` e router em `src/http/memory-routes.ts`, sem LLM.
- [X] T021 Rodar `npm run typecheck` e `npm test` completos, incluindo o modelo real, e garantir que tudo passa.
- [ ] T022 Executar manualmente os passos 1–6 de specs/010-memory-http-api/quickstart.md em PowerShell, com `npm run dev`. O passo 5 precisa do LLM configurado.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001)** → **Foundational (T002–T006)** → **US1 (T007–T010)** → **US2 (T011–T015)** → **US3 (T016–T019)** → **Polish (T020–T022)**
- As histórias são independentes em comportamento. Na prática, todas editam src/http/memory-routes.ts, src/http/memory-routes.test.ts e src/services/memory-service.ts, então devem ser feitas em sequência (P1 → P2 → P3). O que pode ir em paralelo são os testes em arquivos diferentes.
- US3 usa o `GET` (US2) nos testes HTTP de verificação. Se US3 for feita antes, verifique via `memory.list`/`recall` direto no store.

### Parallel Opportunities

- Foundational: T002, T003 e T004 em paralelo (arquivos diferentes).
- US1: T007 (service test) ∥ T008 (routes test).
- US2: T011 (store test) ∥ T012 (service test).
- Polish: T020 ∥ T021.

---

## Parallel Example: Foundational

```bash
Task: "T002 userIdSchema em src/http/schemas.ts (+ uso em server.ts)"
Task: "T003 factSchema em src/memory/memory-tools.ts"
Task: "T004 SecretDetectedError e MemoryNotFoundError em src/services/errors.ts"
```

## Parallel Example: User Story 2

```bash
Task: "T011 list em src/memory/memory-store.test.ts"
Task: "T012 listFacts em src/services/memory-service.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. T001–T006.
2. US1 (T007–T010).
3. **STOP and VALIDATE**: `npm test` verde, e o `Invoke-RestMethod ... /memories -Method POST` do usuário responde 201.

### Incremental Delivery

1. US1 → cadastro direto (desbloqueia semear a memória).
2. US2 → auditoria do que foi aprendido.
3. US3 → remoção precisa.
4. Polish → documentação e validação manual.

### Notes

- `npm run typecheck` e `npm test` verdes ao fim de cada fase.
- Não commitar nem ler `.env`.

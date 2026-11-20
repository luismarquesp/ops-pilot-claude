---

description: "Task list for Memória Semântica por Usuário"
---

# Tasks: Memória Semântica por Usuário

**Input**: Design documents from `specs/008-semantic-memory/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/memory-store.md](./contracts/memory-store.md), [contracts/memory-tools.md](./contracts/memory-tools.md), [contracts/chat-api.md](./contracts/chat-api.md), [quickstart.md](./quickstart.md)

**Tests**: incluídos e obrigatórios. A obrigação vem da constituição (Princípio II, Test-First), do FR-014 e do pedido original ("teste: recall acha fato sem palavra em comum"). Em cada fase, o teste é escrito primeiro e precisa falhar antes da implementação.

**Organization**: as tarefas estão agrupadas por user story, na ordem de prioridade da spec. US1 = recall injetado no chat, US2 = dedup, US3 = forget.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: user story da tarefa (US1, US2, US3)
- Toda descrição traz o caminho exato do arquivo

## Path Conventions

Projeto único Node/TypeScript (ver [plan.md](./plan.md#project-structure)). Os arquivos novos ficam em `src/memory/` (caminho pedido pelo usuário), e os testes ficam ao lado do código como `*.test.ts`. Imports ESM usam sufixo `.js`, a indentação é com tab e os comentários/JSDoc seguem o padrão existente, em português e com referência à spec/research.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: dependência nova (research §1)

- [X] T001 Adicionar `@huggingface/transformers` (v3) às `dependencies` em package.json via `npm install @huggingface/transformers` (atualiza package-lock.json); confirmar que `npm run typecheck` e `npm test` continuam verdes sem nenhum outro código novo

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: funções puras de similaridade, contrato do `Embedder` + fake, e o esqueleto do `SqliteMemoryStore` (tabela `memories` + inserção). Todas as histórias usam essa base.

**⚠️ CRITICAL**: nenhuma user story começa antes desta fase

- [X] T002 [P] Escrever src/memory/similarity.test.ts, que deve falhar até T003. Casos:
  - `dot` de vetores conhecidos, e erro quando os comprimentos diferem.
  - `rankBySimilarity` com `{ limit: 3, minScore: 0.3 }`: descarta score < 0.3, **inclui** score exatamente 0.3, devolve no máximo 3 itens em ordem decrescente, desempata pelo `createdAt` mais recente e acrescenta `score` a cada item.
  - `findDuplicate(v, c, 0.92)`: devolve o de maior score quando > 0.92, `undefined` com score exatamente 0.92 e `undefined` com lista vazia.
  - `toBlob`/`fromBlob`: round-trip de um `Float32Array` de 384 posições, `toBlob` gera 1536 bytes, e `fromBlob` funciona sobre um `Uint8Array` com `byteOffset` ímpar (fatia de um buffer maior).
- [X] T003 [P] Implementar em src/memory/similarity.ts as funções puras `dot`, `rankBySimilarity`, `findDuplicate`, `toBlob` e `fromBlob`, com as assinaturas de contracts/memory-store.md (§"Funções puras"). `fromBlob` **copia** os bytes para um `ArrayBuffer` novo antes de criar o `Float32Array` (research §3). JSDoc cita research §3/§4.
- [X] T004 [P] Criar src/memory/embeddings.ts contendo apenas o contrato por enquanto: `export interface Embedder { embed(text: string): Promise<Float32Array> }`, `EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2"` e `EMBEDDING_DIMENSIONS = 384`. A implementação real (`createLocalEmbedder`) entra em T013.
- [X] T005 [P] Criar src/memory/fake-embedder.ts com `createFakeEmbedder(table: Record<string, number[]>): Embedder` (uso exclusivo de testes). Ele devolve o vetor da tabela normalizado (norma 1) como `Float32Array` e lança `Error("fake embedder: texto sem vetor: <texto>")` para texto ausente. Ele também expõe `calls: string[]`, com os textos já embedados, para os testes verificarem se o embedder foi chamado.
- [X] T006 Criar src/memory/memory-store.ts com:
  - As constantes `RECALL_LIMIT = 3`, `RECALL_MIN_SCORE = 0.3` e `DEDUP_THRESHOLD = 0.92`.
  - Os tipos `Memory`, `RememberResult` e `RecalledMemory` (data-model.md).
  - A interface `MemoryStore { remember; recall; forget }` com JSDoc de contracts/memory-store.md.
  - A classe `SqliteMemoryStore implements MemoryStore`, com `constructor(embedder: Embedder, path: string = DEFAULT_DB_PATH)` importando `DEFAULT_DB_PATH` de src/store/sqlite-ops-store.ts. O construtor faz `mkdirSync(dirname(path))` exceto em `:memory:` e roda o DDL idempotente da tabela `memories` + índice `memories_user_id` (data-model.md), no mesmo padrão de src/store/sqlite-conversation-store.ts.
  - Uma função privada `loadCandidates(userId)`, que faz `SELECT id, user_id, fact, embedding, created_at FROM memories WHERE user_id = ?` com prepared statement e converte o BLOB via `fromBlob`.
  - `remember` **sem dedup** por enquanto: embeda, insere com `randomUUID()` e `createdAt` ISO, e devolve `{ memory, created: true }`.
  - `recall` e `forget` lançando `Error("not implemented")`, a serem preenchidos em US1/US3.

  Depende de T003, T004.
- [X] T007 Criar src/memory/memory-store.test.ts, com um helper `createStore(table)` que monta `new SqliteMemoryStore(createFakeEmbedder(table), ":memory:")`. Primeiros casos:
  - `remember` devolve `created: true`, um `id` UUID, o `userId`/`fact` informados e um `createdAt` ISO.
  - Reabrir `SqliteMemoryStore` sobre um **arquivo temporário** (`mkdtempSync` em `os.tmpdir()`) não apaga nem duplica o fato. Nesta fase, a verificação é por `SELECT COUNT(*)` direto via `DatabaseSync` no teste; no fim de US1, trocar para `recall` (FR-010/FR-011).

  Depende de T005, T006.

**Checkpoint**: `npm test` verde; a tabela `memories` existe e aceita fatos

---

## Phase 3: User Story 1 - O OpsPilot lembra fatos do plantonista entre conversas (Priority: P1) 🎯 MVP

**Goal**: o `/chat` com `userId` injeta no prompt até 3 fatos relevantes do usuário, encontrados por significado, e o agente pode registrar fatos novos via `remember_fact`. Sem `userId`, nada muda.

**Independent Test**: registrar um fato para o usuário, enviar ao chat uma mensagem sem palavra em comum com ele e verificar que o fato chegou à pergunta recebida pela estratégia e que `metrics.memoryFacts` = 1.

### Tests for User Story 1 ⚠️ (escrever primeiro, ver falhar)

- [X] T008 [P] [US1] Acrescentar ao src/memory/memory-store.test.ts os casos de `recall`, com vetores de fake escolhidos para dar scores conhecidos:
  - Devolve só fatos com score ≥ 0.3, no máximo 3 e em ordem decrescente de `score`.
  - Usuário sem fatos → `[]` **e** o fake não recebeu nenhuma chamada para a query (`calls`).
  - **Isolamento**: um fato de `"bob"` com vetor idêntico à query nunca aparece em `recall("alice", …)` (SC-002).
  - Trocar a verificação de persistência de T007 para `recall` após reabrir o arquivo.
- [X] T009 [P] [US1] Criar src/memory/embeddings.test.ts com o **modelo real**. O teste usa `test(..., { skip: process.env.OPSPILOT_SKIP_MODEL_TESTS === "1", timeout: 120_000 })` e segue estes passos:
  1. Tokenizar em minúsculas (`/[\p{L}\p{N}]+/gu`) o fato *"The payments database runs on PostgreSQL"* e a pergunta *"Which SQL engine stores our billing records?"*, e fazer `assert` de que a interseção é vazia.
  2. Montar `new SqliteMemoryStore(createLocalEmbedder(), ":memory:")` e fazer `remember` do fato e do distrator *"My favourite colour is green"*.
  3. Fazer `recall` da pergunta e verificar que o primeiro item é o fato certo, com `score >= RECALL_MIN_SCORE`, e que o distrator, se aparecer, tem score menor.

  Um segundo teste verifica que `embed` devolve um `Float32Array` de 384 posições com norma ≈ 1 (tolerância 1e-3). Se o par não passar do limiar ao rodar, trocar o par por outro **sem palavra em comum**, sem mexer no limiar (research §8).
- [X] T010 [P] [US1] Criar src/memory/memory-prompt.test.ts:
  - `formatQuestionWithMemory([], q)` devolve `q` inalterada (FR-008).
  - Com 2 fatos, o texto começa com `"Fatos lembrados sobre este usuário (mais relevante primeiro):"`, lista `- [<id>] <fato>` na ordem recebida e termina com `\n\n<q>`.
  - `withMemory(strategy, facts)` preserva `name` e repassa a pergunta reescrita (estratégia espiã que captura o `input`).
- [X] T011 [P] [US1] Criar src/memory/memory-tools.test.ts para `remember_fact`, usando `createMemoryTools(store, "alice")` sobre `SqliteMemoryStore(":memory:")` + fake:
  - A tool `remember_fact` existe.
  - `invoke({ fact: "  sou do time de pagamentos  " })` devolve JSON com `id`, `fact` sem espaços nas pontas e `created: true`.
  - O fato fica em `recall("alice", …)` e **não** em `recall("bob", …)`.
  - `invoke({ fact: "" })` é rejeitado pelo schema.
- [X] T012 [P] [US1] Acrescentar casos a src/services/chat-service.test.ts:
  - Atualizar o `deepEqual` existente de métricas para incluir `memoryFacts: 0`.
  - Com `userId` + `memory` (store `:memory:` + fake com 1 fato relevante), a estratégia espiã recebe uma pergunta que contém `[<id>] <fato>` antes do texto original, e `metrics.memoryFacts` = 1.
  - Com `conversationId` + `userId`, a pergunta recebida tem os fatos **antes** de `"Histórico recente desta conversa"` (ordem fatos → histórico → pergunta, research §6).
  - Sem `userId`, a pergunta é idêntica à atual e `memoryFacts` = 0, mesmo com `memory` presente.
  - Um `userId` cujos fatos não atingem o limiar → pergunta inalterada e `memoryFacts` = 0.
  - Um embedder que lança erro → `runChat` rejeita com esse erro e nada é gravado na conversa.

### Implementation for User Story 1

- [X] T013 [US1] Implementar `createLocalEmbedder(): Embedder` em src/memory/embeddings.ts como singleton preguiçoso (research §2):
  - `let pipelinePromise: Promise<FeatureExtractionPipeline> | undefined` no escopo do módulo.
  - Na primeira chamada de `embed`, `const { pipeline } = await import("@huggingface/transformers")` e `pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: "fp32" })`.
  - Chamadas concorrentes compartilham a promise; em caso de rejeição, zerar `pipelinePromise` para permitir nova tentativa.
  - `embed` executa `extractor(text, { pooling: "mean", normalize: true })` e devolve `new Float32Array(output.data)`.

  Faz T009 passar.
- [X] T014 [US1] Implementar `recall(userId, query)` em src/memory/memory-store.ts:
  1. `loadCandidates(userId)`; se vazio, devolve `[]` **sem** embedar.
  2. Embedar a query e aplicar `rankBySimilarity(query, candidates, { limit: RECALL_LIMIT, minScore: RECALL_MIN_SCORE })`.
  3. Mapear para `RecalledMemory` (sem o vetor).

  Faz T008 passar.
- [X] T015 [P] [US1] Criar src/memory/memory-prompt.ts com `formatQuestionWithMemory(facts: readonly Pick<RecalledMemory, "id" | "fact">[], question: string): string` e `withMemory(strategy, facts): ReasoningStrategy`. Ambas são puras e espelham src/agents/history.ts: `withMemory` repassa `{ ...input, question: formatQuestionWithMemory(facts, input.question) }`. Faz T010 passar.
- [X] T016 [US1] Criar src/memory/memory-tools.ts com `createMemoryTools(memory: MemoryStore, userId: string): StructuredToolInterface[]`, devolvendo por enquanto só `remember_fact`:
  - `tool()` do `@langchain/core/tools` com schema zod `{ fact: z.string().trim().min(1).max(500).describe(...) }`.
  - Retorno `JSON.stringify({ id, fact, created })`.
  - A descrição para o LLM segue contracts/memory-tools.md: fatos duradouros sobre o plantonista, nunca estado de alertas/incidentes.
  - O `userId` fica só na closure (research §7).

  Faz T011 passar.
- [X] T017 [US1] Alterar src/services/chat-service.ts:
  - `ChatInput` ganha `userId?: string` e `ChatDeps` ganha `memory?: MemoryStore`.
  - `ChatMetrics` ganha `memoryFacts: number`.
  - Em `runChat`, `const facts = input.userId && memory ? await memory.recall(input.userId, input.message) : []`, antes do `runWithTimeout`, como o histórico.
  - A composição passa a ser `withHistory(withMemory(strategy, facts), history)`.
  - As métricas incluem `memoryFacts: facts.length`, e o JSDoc cita specs/008.

  Faz T012 passar.
- [X] T018 [US1] Adaptar src/http/server.test.ts à nova assinatura:
  - `withServer` passa a montar `createApp({ strategiesFor: () => registry, conversations, memory }, opts)`, com `memory` opcional no helper. Todos os testes existentes continuam verdes sem mudar asserções, exceto `metrics`, que agora inclui `memoryFacts: 0`.
  - Novo caso: `userId: "alice"` com store `:memory:` + fake contendo 1 fato relevante → 200, `metrics.memoryFacts` = 1, e a estratégia espiã recebeu o fato.
  - Novo caso: `strategiesFor` é chamado com `"alice"` quando há `userId` e com `undefined` quando não há (espião na fábrica).
  - Novo caso: `userId: ""`, `userId: 42` e `userId` com 129 caracteres → 400 `{ issues }`.
  - Novo caso: sem `userId` → `memoryFacts` = 0.
  - Novo caso: embedder que lança erro com `userId` → 500 `{ error: "internal_error" }`.
- [X] T019 [US1] Alterar src/http/server.ts:
  - `chatRequestSchema` ganha `userId: z.string().trim().min(1).max(128).optional()`.
  - Nova interface exportada `AppDeps { strategiesFor(userId?: string): Map<string, ReasoningStrategy>; conversations: ConversationStore; memory?: MemoryStore }`, e `createApp(deps: AppDeps, opts: CreateAppOptions = {})`.
  - O handler resolve a estratégia em `deps.strategiesFor(userId)`. O 422 usa as chaves desse mesmo registry.
  - O handler chama `runChat({ message, conversationId, userId }, { strategy, conversations, memory, timeoutMs })`.
  - Atualizar o JSDoc de `createApp` para citar specs/008 contracts/chat-api.md.

  Faz T018 passar.
- [X] T020 [US1] Recompor src/index.ts:
  - `const memory = new SqliteMemoryStore(createLocalEmbedder())` (o modelo só carrega no primeiro uso).
  - `const baseTools = [...createOpsTools(store), createProviderStatusTool()]` e `const baseRegistry = createStrategyRegistry(baseTools)`, memoizado.
  - `const strategiesFor = (userId?: string) => userId ? createStrategyRegistry([...baseTools, ...createMemoryTools(memory, userId)]) : baseRegistry`.
  - `createApp({ strategiesFor, conversations, memory })`.

  Conferir que src/arena.ts, src/bench.ts e src/mcp/server.ts não precisam de mudança.

**Checkpoint**: US1 funcional e testável sozinha, `npm run typecheck` + `npm test` verdes; o MVP pode ser demonstrado pelos passos 1–5 do quickstart.md

---

## Phase 4: User Story 2 - Registrar fatos sem duplicar (Priority: P2)

**Goal**: `remember` não cria quase-cópias (similaridade > 0.92) para o mesmo usuário.

**Independent Test**: registrar um fato e uma variação quase idêntica para o mesmo usuário → 1 fato; a mesma variação para outro usuário → aceita.

### Tests for User Story 2 ⚠️

- [X] T021 [P] [US2] Acrescentar ao src/memory/memory-store.test.ts, com vetores de fake de scores controlados:
  - Um fato com score > 0.92 contra um existente do mesmo usuário → `{ created: false, memory }`, com `memory` igual ao existente (mesmo `id`, `fact` e `createdAt` originais), e `recall` devolve 1 só item.
  - Score exatamente 0.92 (ex.: vetores `[1,0]` e `[0.92, √(1-0.92²)]`) → `created: true`.
  - O mesmo texto para `"bob"`, quando `"alice"` já o tem → `created: true` para bob.
  - Registrar o mesmo texto 5× → 1 fato (SC-004).
- [X] T022 [P] [US2] Acrescentar ao src/memory/memory-tools.test.ts: `remember_fact` duas vezes com texto equivalente → a segunda resposta tem `created: false` e o mesmo `id`.

### Implementation for User Story 2

- [X] T023 [US2] Em src/memory/memory-store.ts, fazer `remember` embedar o fato, carregar `loadCandidates(userId)` e aplicar `findDuplicate(vector, candidates, DEDUP_THRESHOLD)`. Se houver duplicata, devolver `{ memory: <existente sem vetor>, created: false }` sem inserir; senão, inserir como antes. Faz T021 e T022 passarem.

**Checkpoint**: US1 + US2 verdes

---

## Phase 5: User Story 3 - Esquecer um fato (Priority: P3)

**Goal**: remover um fato do próprio usuário, via store e via tool `forget_fact`.

**Independent Test**: registrar, esquecer e verificar que `recall` não devolve mais o fato; tentar esquecer o fato de outro usuário → nada muda.

### Tests for User Story 3 ⚠️

- [X] T024 [P] [US3] Acrescentar ao src/memory/memory-store.test.ts:
  - `forget("alice", id)` de um fato dela → `true`, e `recall` não o devolve mais.
  - `forget("bob", idDaAlice)` → `false`, e o fato continua em `recall("alice", …)`.
  - `forget` de UUID inexistente → `false`, sem lançar erro.
- [X] T025 [P] [US3] Acrescentar ao src/memory/memory-tools.test.ts:
  - `createMemoryTools` passa a devolver `remember_fact` **e** `forget_fact`.
  - `forget_fact` com o id de um fato de alice (tools de alice) → `{"forgotten":true}`.
  - Com as tools de bob, sobre o id da alice → `{"forgotten":false}`, e o fato dela permanece.
  - `memoryId` que não é UUID é rejeitado pelo schema.

### Implementation for User Story 3

- [X] T026 [US3] Implementar `forget(userId, memoryId)` em src/memory/memory-store.ts com `DELETE FROM memories WHERE id = ? AND user_id = ?`, devolvendo `changes > 0`. Faz T024 passar.
- [X] T027 [US3] Adicionar a tool `forget_fact` em src/memory/memory-tools.ts:
  - Schema zod `{ memoryId: z.uuid().describe("id entre colchetes nos fatos lembrados") }` e retorno `JSON.stringify({ forgotten })`.
  - Descrição conforme contracts/memory-tools.md: remover um fato que o plantonista disse estar errado ou desatualizado.

  Faz T025 passar.

**Checkpoint**: as três histórias verdes e independentes

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T028 [P] Atualizar AGENTS.md:
  - Nova seção "Memória semântica", no estilo da seção "Conversa persistente". Ela cobre o `userId` opcional no `/chat`; o `MemoryStore` (`remember`/`recall`/`forget`) e o `SqliteMemoryStore` em `src/memory/memory-store.ts` com a tabela `memories` no `OPSPILOT_DB`; o embedder `all-MiniLM-L6-v2` local, singleton preguiçoso em `src/memory/embeddings.ts`; os limiares 0.92/0.3/top-3; a composição `withHistory(withMemory(...))`; `metrics.memoryFacts`; e `OPSPILOT_SKIP_MODEL_TESTS`.
  - Na seção "Tools do agente", listar `remember_fact`/`forget_fact`, que só estão presentes com `userId`.
  - Na Stack, citar `@huggingface/transformers`.
- [X] T029 [P] Revisar os JSDoc dos arquivos novos em src/memory/ para citar spec/research (padrão do projeto) e garantir que nenhum deles lê `.env` nem usa `dotenv`.
- [X] T030 Rodar `npm run typecheck` e `npm test` (com o modelo real, sem `OPSPILOT_SKIP_MODEL_TESTS`) e registrar em specs/008-semantic-memory/research.md §8 o score efetivamente obtido pelo par fato/pergunta do T009.
- [ ] T031 Executar manualmente o roteiro de specs/008-semantic-memory/quickstart.md (passos 1–6, com `npm run dev` e uma `OPENROUTER_API_KEY` válida no ambiente) e anotar divergências; se o agente não usar `remember_fact` no passo 1, ajustar a descrição da tool em src/memory/memory-tools.ts.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001)** → **Foundational (T002–T007)** → **US1 (T008–T020)** → **US2 (T021–T023)** e **US3 (T024–T027)** → **Polish (T028–T031)**
- US2 e US3 dependem só do Foundational + `recall` (T014) para verificar resultados; são independentes entre si. As duas tocam src/memory/memory-store.ts e src/memory/memory-tools.ts, então, se rodarem em paralelo, é preciso coordenar as edições nesses arquivos.

### Within Each User Story

- Testes (marcados ⚠️) primeiro, falhando; depois a implementação.
- US1: T013 (embedder real) e T014 (recall) antes de T017 (serviço); T015 e T016 antes de T017/T020; T017 antes de T019; T018 → T019 → T020.

### Parallel Opportunities

- Foundational: T002, T004 e T005 em paralelo (arquivos distintos); T003 depois de T002.
- US1 testes: T008, T009, T010, T011 e T012 em paralelo.
- US1 implementação: T013, T015 e T016 em paralelo (arquivos distintos); T014 em paralelo com T015/T016.
- US2 ∥ US3: T021/T022 ∥ T024/T025 (testes), coordenando os arquivos compartilhados.
- Polish: T028 ∥ T029.

---

## Parallel Example: User Story 1

```bash
# Testes de US1 juntos (todos falham até a implementação):
Task: "T008 recall em src/memory/memory-store.test.ts"
Task: "T009 modelo real em src/memory/embeddings.test.ts"
Task: "T010 prompt em src/memory/memory-prompt.test.ts"
Task: "T011 remember_fact em src/memory/memory-tools.test.ts"
Task: "T012 runChat com userId em src/services/chat-service.test.ts"

# Implementações independentes juntas:
Task: "T013 createLocalEmbedder em src/memory/embeddings.ts"
Task: "T015 withMemory em src/memory/memory-prompt.ts"
Task: "T016 remember_fact em src/memory/memory-tools.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 (T001) + Phase 2 (T002–T007).
2. Phase 3 (T008–T020): o recall é injetado no `/chat` e o agente registra fatos.
3. **STOP and VALIDATE**: `npm test` (incluindo o teste do modelo real) + passos 1–5 do quickstart.
4. Nesse ponto, a memória já entrega valor, mesmo sem dedup e sem forget.

### Incremental Delivery

1. MVP (US1) → demonstrar.
2. US2 (dedup) → a memória para de encher de quase-cópias.
3. US3 (forget) → correção e privacidade.
4. Polish → documentação e registro do score real.

### Notes

- `npm run typecheck` e `npm test` verdes ao fim de cada fase (constituição, Princípio II).
- Não commitar nem ler `.env`.
- Se o T009 ficar lento na primeira execução, é o download do modelo (~90 MB); as execuções seguintes usam o cache.

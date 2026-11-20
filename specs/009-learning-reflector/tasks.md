---

description: "Task list for Refletor de Aprendizado"
---

# Tasks: Refletor de Aprendizado

**Input**: Design documents from `specs/009-learning-reflector/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/learning.md](./contracts/learning.md), [contracts/memory-tools.md](./contracts/memory-tools.md), [quickstart.md](./quickstart.md)

**Tests**: incluídos e obrigatórios. A exigência vem da constituição (Princípio II, Test-First) e do FR-013. Em cada fase, o teste é escrito primeiro e precisa falhar antes da implementação.

**Organization**: as tarefas estão agrupadas por user story:
- **US1 (P1)**: aprender automaticamente após a resposta.
- **US2 (P1)**: nunca aprender pedido pontual nem segredo.
- **US3 (P2)**: `forget_preference` substitui `forget_fact`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: user story da tarefa (US1, US2, US3)
- Caminhos exatos em cada descrição

## Path Conventions

Projeto único Node/TypeScript: os arquivos novos ficam em `src/memory/` e os testes ficam ao lado do código, como `*.test.ts`. Imports ESM usam sufixo `.js`, a indentação é com tab e o JSDoc é em português, citando `specs/009` e a seção do research. Os fakes já existentes da 008 são reutilizados: `createFakeEmbedder` (src/memory/fake-embedder.ts) e `SqliteMemoryStore(embedder, ":memory:")`.

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Confirmar a linha de base antes de mexer: `npm run typecheck` e `OPSPILOT_SKIP_MODEL_TESTS=1 npm test` verdes (nenhuma dependência nova nesta feature — plan.md)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: tipos e constantes do aprendizado, usados por US1 e US2

- [X] T002 Criar src/memory/learning.ts com os tipos e constantes de contracts/learning.md: `MAX_FACT_LENGTH = 500`, `LearningVerdict`, `LearningExtractor`, `LearningOutcome`, `LearnInput` e `LearnDeps { memory: MemoryStore; extractor: LearningExtractor; log: (error: unknown) => void }`. Ainda sem funções. O JSDoc do módulo cita specs/009 e research §1/§4.

**Checkpoint**: typecheck verde

---

## Phase 3: User Story 1 - O OpsPilot aprende sozinho com o que o plantonista conta (Priority: P1) 🎯 MVP

**Goal**: após cada turno bem-sucedido com `userId`, o fato duradouro da mensagem vai para a memória, sem atrasar a resposta.

**Independent Test**: com um extrator fake que devolve `{ hasLearning: true, fact: "O plantonista cuida do checkout" }`:
- `runChat` com `userId` resolve sem esperar o `learn`;
- aguardada a promise capturada do `learn`, `memory.recall` encontra o fato;
- uma conversa nova do mesmo usuário recebe o fato no prompt.

### Tests for User Story 1 ⚠️ (escrever primeiro, ver falhar)

- [X] T003 [P] [US1] Criar src/memory/learning.test.ts com os casos básicos de `toLearnableFact`, em teste de tabela:
  - `{ hasLearning: false, fact: "x" }` → `undefined`;
  - `{ hasLearning: true }` → `undefined`;
  - `{ hasLearning: true, fact: "   " }` → `undefined`;
  - `fact` com 501 caracteres (após o trim) → `undefined`;
  - `fact` com exatamente 500 caracteres → devolvido;
  - `"  O plantonista cuida do checkout  "` → devolvido sem espaços.
- [X] T004 [US1] Acrescentar a src/memory/learning.test.ts os casos de `learnFromMessage`. O helper monta `SqliteMemoryStore(createFakeEmbedder({...}), ":memory:")`, um extrator fake (`async () => verdict`, que registra as mensagens recebidas) e um `log` espião. Casos:
  - O veredito com fato → `"learned"`, e `recall` encontra o fato **para o `userId` informado** e não para outro usuário.
  - O mesmo fato duas vezes → a segunda devolve `"duplicate"`.
  - `hasLearning: false` → `"nothing"`, e a memória fica vazia.
  - O extrator recebe **exatamente** a `message` (FR-010).
  - Extrator que lança `new TypeError("conteúdo sensível")` → `"failed"`, sem rejeitar. O `log` é chamado uma vez, e `logLearningFailure` com esse erro chama `console.warn` (espião) com argumentos que contêm `"TypeError"` e **não** contêm `"conteúdo sensível"`.
  - `memory.remember` que lança → `"failed"`.

  Depende de T003 (mesmo arquivo).
- [X] T005 [P] [US1] Acrescentar a src/services/chat-service.test.ts:
  - Com `learn` que devolve uma promise **que nunca resolve**, `runChat({ message, userId: "alice" }, …)` resolve normalmente, com a mesma resposta e as mesmas métricas de sem `learn`.
  - `learn` espião é chamado **uma vez** com `{ userId: "alice", message }` e só **depois** da gravação da conversa (dentro do espião, `conversations.lastMessages` já contém pergunta + resposta).
  - Sem `userId` → `learn` não é chamado.
  - Com estratégia travada e timeout de 20 ms → `TimeoutError`, e `learn` não é chamado.
  - Com estratégia que lança → `learn` não é chamado.
  - `learn` que devolve `Promise.reject(new Error("x"))` não gera `unhandledRejection`: registrar um listener em `process.on("unhandledRejection")` durante o teste, aguardar `setImmediate` e verificar que ele não foi chamado.
- [X] T006 [P] [US1] Acrescentar a src/http/server.test.ts um caso em que `withServer` recebe `learn` em `extra` (estender o `Pick<AppDeps, ...>` do helper para incluir `"learn"`). Um POST com `userId: "alice"` faz `learn` ser chamado com `{ userId: "alice", message }`; um POST sem `userId` não o chama.

### Implementation for User Story 1

- [X] T007 [US1] Implementar `toLearnableFact(verdict)`, pura, em src/memory/learning.ts, conforme as regras de data-model.md, **exceto** a checagem de segredo, que entra em US2 (T016). Faz T003 passar.
- [X] T008 [US1] Implementar em src/memory/learning.ts:
  - `learnFromMessage(input, deps)`: chama o extrator, aplica `toLearnableFact` (`hasLearning` falso → `"nothing"`; fato inválido → `"rejected"`) e faz `memory.remember(userId, fact)` → `"learned"`/`"duplicate"`. Todo o corpo fica em `try/catch`, e o `catch` chama `deps.log(error)` e devolve `"failed"`. A função nunca rejeita.
  - `logLearningFailure(error)`: `console.warn("[learning] falha ao aprender:", error instanceof Error ? error.name : typeof error)` (research §6).

  Faz T004 passar.
- [X] T009 [US1] Implementar em src/memory/learning.ts o `defaultLearningExtractor`:
  - `learningSchema = z.object({ hasLearning: z.boolean().describe(...), fact: z.string().optional().describe(...) })`.
  - `LEARNING_PROMPT` em português, seguindo research §2: só fatos duradouros sobre a pessoa (papel, time, serviços, preferências de resposta, rotinas); nunca pedidos pontuais, estado de alertas/incidentes, contexto só da conversa atual ou credenciais (mensagem com credencial → `hasLearning: false`); no máximo 1 fato por mensagem, o mais relevante, em frase curta, autocontida, em terceira pessoa e no idioma da mensagem. Inclui 4 exemplos (fato → sim; pedido → não; misto → só o fato; segredo → não).
  - A chamada segue o padrão do `defaultCritic` em src/agents/reflection.ts: `createModel().withStructuredOutput(learningSchema).invoke([["system", LEARNING_PROMPT], ["user", \`Mensagem do plantonista: ${message}\`]])`.
- [X] T010 [US1] Alterar src/services/chat-service.ts:
  - `ChatDeps` ganha `learn?: (input: LearnInput) => Promise<unknown>`, com JSDoc citando specs/009 research §5.
  - Em `runChat`, **após** os dois `append` e antes do `return`: `if (input.userId && deps.learn) { void deps.learn({ userId: input.userId, message: input.message }).catch(() => {}); }`.
  - Atualizar o JSDoc de `runChat`.

  Faz T005 passar.
- [X] T011 [US1] Alterar src/http/server.ts: `AppDeps` ganha `learn?: (input: LearnInput) => Promise<unknown>` (JSDoc: disparado sem await após sucesso, specs/009), e o handler repassa `learn: deps.learn` para `runChat`. Faz T006 passar.
- [X] T012 [US1] Recompor src/index.ts: `const learn = (input: LearnInput) => learnFromMessage(input, { memory, extractor: defaultLearningExtractor, log: logLearningFailure })`, passado em `createApp({ strategiesFor, conversations, memory, learn })`.

**Checkpoint**: US1 verde e independente; `npm run typecheck` + `npm test` verdes

---

## Phase 4: User Story 2 - Nunca aprender pedidos pontuais nem segredos (Priority: P1)

**Goal**: dupla barreira contra segredos (antes do extrator e sobre o fato proposto), mais a medição de qualidade do extrator real para pedidos pontuais e segredos.

**Independent Test**: `learnFromMessage` com mensagem contendo `password=hunter2` → `"skipped_secret"`, o extrator fake nunca é chamado e a memória fica vazia. Um extrator fake que propõe `"O token é ghp_…"` → `"rejected"`, e a memória fica vazia.

### Tests for User Story 2 ⚠️

- [X] T013 [P] [US2] Criar src/memory/secrets.test.ts com uma tabela de **positivos**, um por padrão de research §3 e todos devendo dar `containsSecret === true`:
  - `"minha senha: hunter2"`, `"password=abc123"`, `"API_KEY = xyz"` (case-insensitive), `"client-secret: s3cr3t"`
  - `"postgres://admin:pa55@db.internal:5432/app"`
  - `"-----BEGIN RSA PRIVATE KEY-----"`, `"-----BEGIN OPENSSH PRIVATE KEY-----"`
  - `"sk-or-v1-0123456789abcdef0123"`, `"ghp_0123456789abcdefABCDEF0123"`, `"AKIAABCDEFGHIJKLMNOP"`, `"xoxb-1234567890-abcdef"`
  - um JWT de exemplo (`eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc`)
  - uma string alfanumérica mista de 40 caracteres

  E de **negativos**, todos devendo dar `false`:
  - `"sou do time de pagamentos"`, `"o token de deploy fica no vault"`, `"prefiro respostas em tópicos"`
  - um UUID, um hash curto de commit (`a1b2c3d`), `"https://grafana.internal/d/abc"`
  - `"minha senha expirou ontem"` (sem valor após `:`/`=`)
- [X] T014 [P] [US2] Acrescentar a src/memory/learning.test.ts:
  - `toLearnableFact({ hasLearning: true, fact: "O token dele é ghp_0123456789abcdefABCDEF0123" })` → `undefined`.
  - `learnFromMessage` com mensagem `"sou do time de SRE, minha senha do grafana: hunter2"` → `"skipped_secret"`, com o extrator fake **não** chamado e `recall` vazio.
  - Extrator fake que propõe fato com segredo para uma mensagem limpa → `"rejected"`, com a memória vazia.
  - Extrator fake que devolve `hasLearning: false` para `"fecha o incidente 42"` → `"nothing"`. Isso documenta o contrato; a qualidade real é medida em T018.

### Implementation for User Story 2

- [X] T015 [US2] Implementar `containsSecret(text)`, pura, em src/memory/secrets.ts, com as regex de research §3 declaradas numa constante `SECRET_PATTERNS: readonly RegExp[]` comentada por categoria (sem flag `g`, para `test()` não ter estado). Faz T013 passar.
- [X] T016 [US2] Em src/memory/learning.ts:
  - `toLearnableFact` passa a devolver `undefined` quando `containsSecret(fact)`.
  - `learnFromMessage` passa a devolver `"skipped_secret"` **antes** de chamar o extrator quando `containsSecret(input.message)`.

  Faz T014 passar.
- [X] T017 [US2] Revisar `LEARNING_PROMPT` em src/memory/learning.ts. O exemplo misto ("sou do time de pagamentos, abre um incidente pro checkout" → só o fato) e o de segredo precisam estar presentes, e o prompt precisa dizer explicitamente "na dúvida, hasLearning: false".
- [X] T018 [US2] Criar src/memory/learning-eval.ts, o script de avaliação de research §8, **fora** do `npm test` (o nome não termina em `.test.ts`):
  - Três arrays fixos: ≈10 mensagens com fato duradouro, ≈10 pedidos pontuais e ≈6 mensagens com segredo, estas usando valores falsos óbvios, como `hunter2` e `sk-or-v1-000…`.
  - Roda o `learnFromMessage` real (`defaultLearningExtractor` + `SqliteMemoryStore(createLocalEmbedder(), ":memory:")`, um `userId` por mensagem) e conta os `"learned"`.
  - Imprime as taxas contra as metas: fatos ≥ 90%, pedidos ≤ 5% e segredos = 0%, com `process.exitCode = 1` se alguma falhar.
  - Execução documentada no topo do arquivo: `node --env-file-if-exists=.env --import tsx src/memory/learning-eval.ts`.

**Checkpoint**: US1 + US2 verdes

---

## Phase 5: User Story 3 - Esquecer uma preferência pelo que ela diz (Priority: P2)

**Goal**: `forget_preference { description }` substitui `forget_fact`, e os fatos no prompt deixam de mostrar `[id]` (FR-011/FR-012).

**Independent Test**: com as tools de alice e um fato dela, `forget_preference` com uma descrição parecida devolve `{ forgotten: true, fact }` e o `recall` fica vazio. Com as tools de bob, a mesma descrição devolve `{ forgotten: false }`.

### Tests for User Story 3 ⚠️

- [X] T019 [P] [US3] Em src/memory/memory-tools.test.ts:
  - **Remover** os dois testes de `forget_fact` (as linhas com `forget_fact`).
  - Adicionar:
    - `createMemoryTools` devolve exatamente `["remember_fact", "forget_preference"]`.
    - `forget_preference` com uma descrição mapeada no fake para um vetor próximo do fato de alice → `{"forgotten":true,"fact":"<fato>"}`, e `recall("alice", …)` vazio.
    - Descrição com score < 0.3 → `{"forgotten":false}`, e o fato permanece.
    - Tools de bob sobre o fato de alice → `{"forgotten":false}`, e o fato permanece.
    - Com dois fatos de alice, só o mais parecido é removido.
    - `description` vazia é rejeitada pelo schema.
- [X] T020 [P] [US3] Atualizar src/memory/memory-prompt.test.ts ao formato sem id: a linha esperada passa a ser `"- sou do time de pagamentos\n- prefiro respostas curtas\n\n"`, e `formatQuestionWithMemory` aceita objetos com apenas `{ fact }`.
- [X] T021 [P] [US3] Atualizar os asserts de prompt que usam o id:
  - src/services/chat-service.test.ts (≈ linha 69): de `` `[${ids[0]}] usamos postgres` `` para `"- usamos postgres"`.
  - src/http/server.test.ts (≈ linha 389): de `` `[${id}] usamos postgres` `` para `"- usamos postgres"`.

  Remover variáveis de id que ficarem sem uso.

### Implementation for User Story 3

- [X] T022 [US3] Em src/memory/memory-prompt.ts:
  - `PromptFact` passa a ser `Pick<RecalledMemory, "fact">`, e cada linha fica `- ${memory.fact}`.
  - Atualizar o JSDoc: os ids saíram do prompt (specs/009 research §7).

  Faz T020 e T021 passarem.
- [X] T023 [US3] Em src/memory/memory-tools.ts:
  - Exportar `forgetPreference(memory, userId, description): Promise<{ forgotten: true; fact: string } | { forgotten: false }>`: `recall(userId, description, 1)`; se houver resultado, `forget(userId, id)` e devolve `{ forgotten: true, fact }`.
  - Trocar a tool `forget_fact` por `forget_preference`, com schema `{ description: z.string().trim().min(1).max(500).describe(...) }`, retorno `JSON.stringify(await forgetPreference(...))` e descrição para o LLM conforme contracts/memory-tools.md (pedir para esquecer ou mudou → descreva com as palavras dele e confirme o `fact` devolvido).
  - Atualizar o JSDoc do módulo.

  Faz T019 passar.

**Checkpoint**: as três histórias verdes

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T024 [P] Atualizar AGENTS.md:
  - Na seção "Memória semântica", acrescentar o refletor: após cada turno bem-sucedido com `userId`, `learnFromMessage` (`src/memory/learning.ts`) é disparado sem await e chama um extrator com `withStructuredOutput({ hasLearning, fact })` que lê só a mensagem do usuário. A dupla barreira `containsSecret` (`src/memory/secrets.ts`) vem antes, o fato vai para `memory.remember` e as falhas são logadas só com o nome do erro. Citar também o eval `src/memory/learning-eval.ts` e o fato de os fatos no prompt não terem mais id.
  - Em "Tools do agente", trocar `forget_fact` por `forget_preference` (esquece o fato mais parecido com a descrição).
- [X] T025 [P] Marcar em specs/008-semantic-memory/contracts/memory-tools.md, no topo, uma nota: "Superado por specs/009 contracts/memory-tools.md (forget_fact → forget_preference; ids fora do prompt)".
- [X] T026 Rodar `npm run typecheck` e `npm test` (com o modelo real) e garantir que tudo passa.
- [ ] T027 Rodar o eval `node --env-file-if-exists=.env --import tsx src/memory/learning-eval.ts` (requer `OPENROUTER_API_KEY` no ambiente) e registrar as taxas obtidas em specs/009-learning-reflector/research.md §8. Se alguma meta falhar, ajustar `LEARNING_PROMPT` em src/memory/learning.ts e repetir.
- [ ] T028 Executar manualmente os passos 3.1–3.6 de specs/009-learning-reflector/quickstart.md com `npm run dev` e anotar divergências.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001)** → **Foundational (T002)** → **US1 (T003–T012)** → **US2 (T013–T018)** → **Polish (T024–T028)**
- **US3 (T019–T023)** depende só do Setup e é independente de US1/US2 (arquivos diferentes, exceto os ajustes de assert em chat-service.test.ts e server.test.ts, que coordenam com T005/T006).
- US2 depende de US1: estende `toLearnableFact`/`learnFromMessage`, e o eval usa o pipeline completo.

### Within Each User Story

- Testes primeiro (⚠️), falhando; depois a implementação.
- US1: T003 → T004 (mesmo arquivo); T007 → T008 → T009 (mesmo arquivo); T010 → T011 → T012.
- US2: T015 antes de T016; T016 → T017 → T018 (mesmo arquivo / pipeline completo).
- US3: T022 e T023 em arquivos diferentes, podem ir em paralelo depois dos testes.

### Parallel Opportunities

- US1 testes: T003, T005 e T006 em paralelo.
- US2 testes: T013 ∥ T014.
- US3 inteira em paralelo com US1/US2, com os testes T019, T020 e T021 em paralelo entre si.
- Polish: T024 ∥ T025.

---

## Parallel Example: User Story 1

```bash
# Testes de US1 juntos:
Task: "T003 toLearnableFact em src/memory/learning.test.ts"
Task: "T005 disparo assíncrono em src/services/chat-service.test.ts"
Task: "T006 learn no Controller em src/http/server.test.ts"
```

## Parallel Example: User Story 3 (em paralelo com US1/US2)

```bash
Task: "T019 forget_preference em src/memory/memory-tools.test.ts"
Task: "T020 prompt sem id em src/memory/memory-prompt.test.ts"
Task: "T021 asserts sem id em chat-service.test.ts e server.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. T001–T002.
2. US1 (T003–T012): o OpsPilot aprende após cada resposta, sem atrasá-la.
3. **STOP and VALIDATE**: `npm test` verde.
4. ⚠️ **Não colocar em produção só com US1**: sem US2, um segredo proposto pelo LLM poderia ir para a memória. US1 + US2 formam o MVP real (as duas são P1).

### Incremental Delivery

1. US1 + US2 → aprendizado seguro, com o eval rodado (T027).
2. US3 → esquecer por descrição.
3. Polish → documentação e validação manual.

### Notes

- `npm run typecheck` e `npm test` verdes ao fim de cada fase.
- Não commitar nem ler `.env`. O eval e o quickstart carregam o `.env` via `--env-file-if-exists`, sem leitura pelo agente.

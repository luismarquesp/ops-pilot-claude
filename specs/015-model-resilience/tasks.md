---

description: "Task list for 015-model-resilience"
---

# Tasks: Resiliência de Modelo (retry + modelos reserva)

**Input**: Design documents from `specs/015-model-resilience/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: obrigatórios pela constituição (Princípio II) e pelo FR-013
(política testável sem rede). Os testes usam `node:test` via `tsx`, com
`RunnableLambda` falsos ou o `FakeListChatModel` de `@langchain/core/utils/testing`,
nunca rede. Escrever o teste, vê-lo falhar e só então implementar.

**Organization**:

- US1: retry no principal e troca para as reservas em toda chamada ao modelo.
- US2: falha total vira 503 `model_unavailable`.
- US3: `metrics.modelUsed` e evento `fallback` no rastro.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência pendente)
- **[Story]**: US1, US2, US3

## Path Conventions

Projeto único: `src/`, com testes `*.test.ts` ao lado do código. Estilo:

- tabs, ESM com imports `.js`;
- JSDoc curto em português citando `specs/015` e a seção do [research.md](./research.md);
- preservar o fim de linha de cada arquivo (alguns são CRLF, ex.: `src/http/server.ts`, `src/http/server.test.ts`, `src/index.ts`, `src/services/chat-service.test.ts`).

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Conferir que `npm run typecheck` e `OPSPILOT_SKIP_MODEL_TESTS=1 npm test` estão verdes antes de começar (baseline). Nenhuma dependência nova.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: erro de domínio, configuração da cadeia e o escopo por turno de
que todas as stories dependem ([contracts/model-factory.md](./contracts/model-factory.md)).

- [X] T002 [P] Em `src/services/errors.ts`, adicionar `ModelUnavailableError extends Error`:
  - `constructor(public readonly modelsTried: string[])`;
  - `this.name = "ModelUnavailableError"`;
  - mensagem `Nenhum modelo respondeu: <ids separados por vírgula>`, sem detalhes do provedor (research §6).
- [X] T003 [P] Criar `src/agents/model-calls.test.ts`, no molde de `src/context/usage-tracker.test.ts`. Deve falhar até o T004:
  - (a) `trackModelCalls(fn)` devolve `{ value, calls }` com os `recordModelCall` feitos dentro de `fn`, na ordem;
  - (b) `recordModelCall` fora de escopo é no-op, e `modelCallCount()` vale `0` e `modelCallsSince(0)` vale `[]` fora de escopo;
  - (c) `modelCallsSince(mark)` devolve só as chamadas depois de `mark`;
  - (d) escopos concorrentes (`Promise.all` com `setTimeout`) não se misturam.
- [X] T004 Criar `src/agents/model-calls.ts`:
  - `type ModelCall = { modelUsed: string | null; switches: ModelSwitch[] }`, com `ModelSwitch = { from: string; to: string; reason: string }` declarado aqui e reexportado por `resilience.ts`;
  - `trackModelCalls`, `recordModelCall`, `modelCallsSince` e `modelCallCount`, sobre um `AsyncLocalStorage<ModelCall[]>` próprio.

  Fazer o T003 passar.
- [X] T005 [P] Criar `src/agents/model.test.ts` com `parseModelChain`. Deve falhar até o T006:
  - (a) `{ OPEN_ROUTER_MODEL: "a" }` → `{ primary: "a", fallbacks: [] }`;
  - (b) `OPENROUTER_MODEL_FALLBACK: " b , ,c,b, a "` → `fallbacks` igual a `["b", "c"]` (trim, sem vazios, sem repetidos, sem o principal);
  - (c) variáveis ausentes → `{ primary: "", fallbacks: [] }`.
- [X] T006 Em `src/agents/model.ts`, adicionar:
  - `interface ModelChain { primary: string; fallbacks: string[] }`;
  - `parseModelChain(env)` (pura);
  - `MODEL_ATTEMPTS = 2` (tentativas por modelo, principal e reservas).

  Ainda sem mudar `createModel`. Fazer o T005 passar.

**Checkpoint**: typecheck e testes verdes; o comportamento de produção ainda não mudou.

---

## Phase 3: User Story 1 - O turno sobrevive a uma falha do modelo principal (Priority: P1) 🎯 MVP

**Goal**:
- toda chamada ao modelo passa por `withResilience`: o principal com
  `withRetry` (2 tentativas) e as reservas, também com `withRetry` (2), via `withFallbacks`;
- o `ChatOpenAI` fica sem retry interno;
- os 6 pontos de chamada usam o builder (research §1–§4).

**Independent Test**: `withResilience` com um principal falso que sempre
falha e uma reserva falsa que responde → devolve a resposta da reserva. Um
`createReactAgent` com `llm` dinâmico sobre essa cadeia
(`FakeListChatModel.bindTools`) completa a execução.

### Tests for User Story 1 ⚠️

> Escrever primeiro e garantir que FALHAM antes da implementação.

- [X] T007 [US1] Criar `src/agents/resilience.test.ts`. Usar runnables falsos `fake(id, script)`: `RunnableLambda` que, a cada chamada, consome o próximo item de `script` (`"ok"` → devolve `` `${id}:ok` ``; `Error` → lança) e conta as chamadas.

  `summarizeAttempts` (pura), com os 4 exemplos de [data-model.md](./data-model.md):
  - (a) `[a✖, a✔]` → `{ modelUsed: "a", switches: [], modelsTried: ["a"] }`;
  - (b) `[a✖×2, b✔]` → `switches: [{ from: "a", to: "b", reason: <nome do erro> }]`;
  - (c) `[a✖×2, b✖×2, c✔]` → duas trocas;
  - (d) `[a✖×2, b✖×2]` → `modelUsed: null` e `modelsTried: ["a", "b"]`.

  `withResilience`:
  - (e) principal falha 1× e depois responde, com `attempts: 2` → resposta `"a:ok"`, reserva nunca chamada (aceita a espera de ~1–2 s do `pRetry`; é o único caso com espera);
  - (f) principal sempre falha, `attempts: 1`, reserva responde → `"b:ok"`, principal chamado 1×, reserva 1×;
  - (g) duas reservas e a primeira falha → `"c:ok"`;
  - (h) principal saudável e reservas configuradas → reservas nunca chamadas (SC-005);
  - (i) tudo falha → rejeita com `instanceof ModelUnavailableError` e `modelsTried` igual a `["a", "b"]`;
  - (j) dentro de `trackModelCalls`, um sucesso via reserva registra `{ modelUsed: "b", switches: [a→b] }`; fora de escopo não lança;
  - (k) `logModelFallback` (mock de `console.warn`) loga os ids e o nome do erro, nunca a mensagem do erro (use `new TypeError("segredo")`);
  - (l) **compatibilidade com o ReAct (research §2)**:
    - `createReactAgent({ llm: () => withResilience([{ id: "a", runnable: falhaSempre }, { id: "b", runnable: new FakeListChatModel({ responses: ["pronto"] }).bindTools(tools) }], { attempts: 1 }), tools: [] })` (ou `tools` com uma tool trivial) completa e devolve a mensagem `"pronto"`;
    - importar `FakeListChatModel` de `@langchain/core/utils/testing`.

### Implementation for User Story 1

- [X] T008 [US1] Criar `src/agents/resilience.ts`, conforme o [contrato](./contracts/model-factory.md):
  - tipos `ModelAttempt` e `ModelCallOutcome`; reexporta `ModelSwitch`;
  - `summarizeAttempts` (pura);
  - `track(id, runnable)`: um `RunnableLambda` que faz `runnable.invoke(input, config)` e anota `{ model, ok, error: error.name }` no `AsyncLocalStorage<ModelAttempt[]>` da chamada;
  - `withResilience(entries, { attempts = MODEL_ATTEMPTS })`:
    1. `track(primary).withRetry({ stopAfterAttempt: attempts })`;
    2. `.withFallbacks(reserves.map((r) => track(r).withRetry({ stopAfterAttempt: attempts })))` quando houver reservas;
    3. tudo dentro de um `RunnableLambda` externo que roda num escopo novo de tentativas;
    4. em sucesso: `logModelFallback` por troca e `recordModelCall({ modelUsed, switches })`;
    5. em falha: `throw new ModelUnavailableError(modelsTried)`;
  - `logModelFallback`: `console.warn("[model] fallback", from, "→", to + ":", reason)`.

  Fazer o T007 passar.
- [X] T009 [US1] Em `src/agents/model.ts`:
  - `createChatModel(id)`: o `ChatOpenAI` de hoje com `model: id` e `maxRetries: 0` (research §3);
  - `createModel<O>(build = identidade, chain = parseModelChain(process.env))`, que devolve
    `withResilience([primary, ...fallbacks].map((id) => ({ id, runnable: build(createChatModel(id)) })))`;
  - JSDoc citando specs/015 e a nota do specs/011 (modelos criados dentro de `trackUsage` contam uso; agora isso vale para cada modelo da cadeia).
- [X] T010 [US1] Migrar os pontos de chamada, conforme a tabela do [contrato](./contracts/model-factory.md#pontos-de-chamada-migração):
  - `src/agents/react.ts`: `createReactAgent({ llm: () => createModel((m) => m.bindTools(tools)), tools })`;
  - `src/agents/plan-and-execute.ts`: planner e replanner com `createModel((m) => m.withStructuredOutput(schema))`, executor com `createModel((m) => m.bindTools(tools))`;
  - `src/agents/reflection.ts`, `src/agents/router.ts` e `src/memory/learning.ts`: `createModel((m) => m.withStructuredOutput(schema))`;
  - `src/agents/summarizer.ts` fica igual.

  `npm run typecheck` deve passar. Corrigir tipos do builder se o `withStructuredOutput` exigir um genérico explícito.
- [X] T011 [US1] Rodar `npm test` completo. Nenhum teste existente deve mudar de comportamento, porque as estratégias falsas não usam `createModel`.

**Checkpoint**: a política está ativa em toda chamada real ao modelo; testes verdes.

---

## Phase 4: User Story 2 - Falha total vira um erro claro e honesto (Priority: P2)

**Goal**: `ModelUnavailableError` vira `503 { error: "model_unavailable", modelsTried }`.
Nada é gravado, o `learn` não é disparado, e erros que não vêm do modelo
continuam 500.

**Independent Test**: uma estratégia falsa que lança
`new ModelUnavailableError(["a", "b"])` → `/chat` responde 503 com
`modelsTried` igual a `["a", "b"]`, e a conversa e o `learn` ficam intocados.

### Tests for User Story 2 ⚠️

- [X] T012 [P] [US2] Em `src/services/chat-service.test.ts`: uma estratégia que lança `ModelUnavailableError` → `runChat` rejeita com essa classe, nada é gravado em `conversations` e o `learn` não é chamado.
- [X] T013 [P] [US2] Em `src/http/server.test.ts`:
  - (a) uma estratégia que lança `new ModelUnavailableError(["a", "b"])` → 503 com o corpo deepEqual `{ error: "model_unavailable", modelsTried: ["a", "b"] }`, e a conversa existente não ganha mensagens;
  - (b) o log da borda (mock de `console.warn`/`console.error`) não contém a mensagem de erro do provedor;
  - (c) uma estratégia que lança `new Error("bug")` continua 500 `internal_error`;
  - (d) com o roteador falso lançando `ModelUnavailableError` e a estratégia respondendo → 200 (roteador tolerante, FR-010).

### Implementation for User Story 2

- [X] T014 [US2] Em `src/http/server.ts`, no `catch` do `/chat`:
  - `if (error instanceof ModelUnavailableError)` → `console.warn("[model] indisponível:", error.modelsTried.join(", "))` e `res.status(503).json({ error: "model_unavailable", modelsTried: error.modelsTried })`;
  - a checagem fica antes do `throw error`; o `TimeoutError` mantém a precedência.

  Atualizar o JSDoc do Controller citando specs/015. Fazer o T012 e o T013 passarem; o `runChat` não precisa de mudança.

**Checkpoint**: falha total → 503; demais erros inalterados.

---

## Phase 5: User Story 3 - Saber qual modelo respondeu (Priority: P3)

**Goal**: `metrics.modelUsed` e eventos `fallback` (com `node`,
deduplicados) no rastro (research §5).

**Independent Test**: num turno cujo nó de estratégia registra
`recordModelCall({ modelUsed: "b", switches: [a→b] })` duas vezes →
`metrics.modelUsed` vale `"b"`, e o rastro tem um único
`{ type: "fallback", from: "a", to: "b", node: <rota> }`, no início dos eventos
da estratégia.

### Tests for User Story 3 ⚠️

- [X] T015 [P] [US3] Em `src/graph/production-graph.test.ts`, com estratégias e roteador falsos que chamam `recordModelCall` (rodando o `invoke` dentro de `trackModelCalls`):
  - (a) sem trocas → nenhum evento `fallback`, `output.modelUsed` igual ao `modelUsed` da última chamada da estratégia, e o rastro idêntico ao do specs/014;
  - (b) estratégia com troca `a→b` → evento `fallback` com `node` igual à rota, posicionado antes dos eventos da estratégia;
  - (c) roteador com troca → evento com `node: "roteador"` antes do `route`;
  - (d) a mesma troca `a→b` no roteador e na estratégia → um só evento (o primeiro, do `roteador`);
  - (e) estratégia sem chamadas → `modelUsed: null`;
  - (f) `fallbackEvents` e `dedupeFallbacks` puros: casos diretos.
- [X] T016 [P] [US3] Em `src/agents/trace.test.ts`: `formatTrace` de `{ type: "fallback", from: "a", to: "b", reason: "RateLimitError" }` → `[Troca de modelo] a → b (RateLimitError)`.

### Implementation for User Story 3

- [X] T017 [US3] Em `src/graph/production-graph.ts`:
  - `type FallbackEvent = { type: "fallback"; from: string; to: string; reason: string }` entra em `GraphTraceEvent` e em `tagTrace`;
  - funções puras `fallbackEvents(calls: ModelCall[])` e `dedupeFallbacks(trace)` (primeiro de cada par `from → to`);
  - em cada nó: `mark = modelCallCount()` no início e, no fim, `trace: [...tagTrace(fallbackEvents(modelCallsSince(mark)), <nó>), ...eventosDoNó]`;
  - o nó de estratégia escreve o canal novo `modelUsed` (`modelCallsSince(mark).at(-1)?.modelUsed ?? null`);
  - o nó `resposta` aplica `dedupeFallbacks` e devolve `ProductionOutput.modelUsed`.

  Fazer o T015 passar.
- [X] T018 [US3] Em `src/agents/trace.ts`: `LABELS.fallback = "Troca de modelo"` e o `case "fallback"` no formato do T016. Ajustar o tipo aceito para incluir `FallbackEvent`; para não criar dependência de `agents` para `graph`, declarar `FallbackEvent` em `src/agents/resilience.ts` e reexportar no grafo. Fazer o T016 passar.
- [X] T019 [US3] Em `src/services/chat-service.ts`:
  - envolver o `trackUsage(...)` com `trackModelCalls(...)` (ou o inverso), dentro do `runWithTimeout`;
  - `ChatMetrics.modelUsed: string | null` vindo de `output.modelUsed`.

  Em `src/services/chat-service.test.ts`:
  - ajustar o `deepEqual` de métricas do primeiro teste (inclui `modelUsed: null`);
  - adicionar: uma estratégia falsa que chama `recordModelCall({ modelUsed: "b", switches: [{ from: "a", to: "b", reason: "X" }] })` → `metrics.modelUsed` vale `"b"` e o `trace` contém o evento `fallback`.
- [X] T020 [US3] Em `src/http/server.test.ts`: a resposta 200 traz `metrics.modelUsed` presente no JSON (`null` com as estratégias falsas, ou o valor registrado por uma estratégia que chama `recordModelCall`).

**Checkpoint**: as três stories verdes de forma independente.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T021 [P] Em `.env.example`, logo abaixo de `OPEN_ROUTER_MODEL=`:
  - adicionar `OPENROUTER_MODEL_FALLBACK=`;
  - comentário: `# Modelos reserva, separados por vírgula, tentados na ordem; 2 tentativas por modelo (specs/015)`.
- [X] T022 [P] Atualizar `AGENTS.md`:
  - nova seção "Resiliência de modelo" (specs/015): `createModel(build, chain)`, `withRetry` (2 tentativas por modelo), `withFallbacks` com `OPENROUTER_MODEL_FALLBACK`, `maxRetries: 0` no `ChatOpenAI`, ReAct com `llm` dinâmico, evento `fallback` (com `node`, deduplicado), `metrics.modelUsed`, 503 `model_unavailable` e a tolerância do roteador, crítico, resumidor e aprendizado;
  - na seção "Medição de contexto", mencionar que tentativas e reservas também contam no `promptTokens`.
- [X] T023 [P] Em `scripts/conversa-long.sh`, adicionar a coluna `modelo` (`metrics.modelUsed ?? "n/d"`) depois de `rota`, atualizando o comentário do topo, o comentário de `campos`, o `read` e os dois `printf`. Conferir offline com um JSON de exemplo (como foi feito na T026 da 014). Preservar o CRLF do arquivo.
- [X] T024 Rodar `npm run typecheck` e `npm test`, ambos verdes. Seguir os passos 1–4 de [quickstart.md](./quickstart.md):
  - os passos 1 e 2 usam ids de modelo inexistentes e quase não gastam cota;
  - o passo 4 depende da cota diária da OpenRouter.
  - Validação (2026-10-21), com preload que troca as variáveis em runtime, sem ler o `.env`:
    - **Passo 1** ✔ principal inexistente e reserva = principal original: HTTP 200, `modelUsed` = reserva, um único evento `fallback` (`node: "react"`; as 2 trocas do turno foram deduplicadas).
    - **Passo 2** ✔ tudo inexistente: HTTP 503 `model_unavailable` com os 2 ids, em 4 s.
    - **Passo 3** ✔ configuração normal: `modelUsed` = principal, sem `fallback`.
    - **Passo 4** ✔ coluna `modelo` preenchida no turno 1. No turno 2 o principal falhou (provável cota diária) e a reserva configurada também: o roteador caiu em fallback, e a estratégia esgotou a cadeia e respondeu 503 (antes da 015 seria 500).
    - `npm run typecheck` e `npm test` verdes (353 pass, 2 skip).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup → Foundational → US1 → US2 / US3 → Polish**.
- **US2** depende da US1, porque o `ModelUnavailableError` real sai do `withResilience`. O teste da US2 usa uma estratégia falsa que o lança, então pode ser escrito em paralelo.
- **US3** depende da US1, porque `recordModelCall` é chamado pelo `withResilience`. Os testes da US3 chamam `recordModelCall` direto, então também podem ser escritos em paralelo.

### Within Phase 2

- T002 ∥ T003 ∥ T005; T004 depois de T003; T006 depois de T005.

### Within US1

- T007 → T008 → T009 → T010 → T011.

### Parallel Opportunities

- Fase 2: T002, T003 e T005 (arquivos distintos).
- US2: T012 e T013.
- US3: T015 e T016.
- Polish: T021, T022 e T023.

## Parallel Example: US3 tests

```text
Task: "T015 production-graph.test.ts — eventos fallback por nó"
Task: "T016 trace.test.ts — rótulo Troca de modelo"
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Fases 1 e 2.
2. US1 (T007–T011): os turnos sobrevivem a falhas do principal.
3. **Validar**: o teste independente da US1 e o passo 1 do quickstart.

### Incremental Delivery

US1 → resiliência; US2 → 503 honesto; US3 → observabilidade; Polish →
configuração documentada e script.

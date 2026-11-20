---

description: "Task list for 014-unified-production-graph"
---

# Tasks: Grafo Unificado de Produção com Roteador

**Input**: Design documents from `specs/014-unified-production-graph/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: obrigatórios pela constituição (Princípio II: lógica nova nasce com
teste) e pelo FR-014 (roteador substituível por dublê). Todos rodam com
`node:test` via `tsx`, sem rede. A ordem é escrever o teste, vê-lo falhar e só
então implementar.

**Organization**:
- US1: grafo `context → router → estratégia → answer` com o roteador decidindo e o evento `route`.
- US2: override por `strategy` no `/chat`.
- US3: campo `node` em todo evento do rastro.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência pendente)
- **[Story]**: US1, US2, US3

## Path Conventions

Projeto único: código em `src/`, testes `*.test.ts` ao lado do código. Estilo
do projeto: tabs, ESM com imports `.js`, JSDoc curto em português citando
`specs/014` e a seção do [research.md](./research.md).

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Conferir que `npm run typecheck` e `npm test` estão verdes antes de começar (baseline). Nenhuma dependência nova, então o `package.json` fica intocado.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: rotas, decisão e tipos de rastro de que todas as stories
dependem ([contracts/production-graph.md](./contracts/production-graph.md),
[data-model.md](./data-model.md)).

- [X] T002 [P] Criar `src/agents/router.test.ts`, que deve falhar até o T003 existir:
  - (a) `ROUTES` deepEqual `["react", "plan-and-execute", "reflection"]`, e `ROUTE_TABLE.map(r => r.name)` deepEqual `ROUTES`;
  - (b) `routerSystemPrompt(ROUTE_TABLE)` contém a linha `| rota | quando usar |` e uma linha `| <name> | <when> |` para cada rota;
  - (c) `routerSystemPrompt` com só `react` e `plan-and-execute` **não** contém `reflection`;
  - (d) `parseRouteDecision({ route: "plan-and-execute", reason: "x" }, ROUTE_TABLE)` devolve `{ route, reason }`;
  - (e) `parseRouteDecision` devolve `null` para: rota inexistente (`"foo"`), rota válida mas fora das `routes` passadas, `reason` vazio, `null`/`undefined` e string;
  - (f) `logRouteFailure(new TypeError("segredo do usuário"))` loga `TypeError` e não loga `"segredo"`; capturar com `t.mock.method(console, "warn")`, seguindo o teste do `logSummaryFailure` em `src/agents/summarizer.test.ts`.
- [X] T003 [P] Criar `src/agents/router.ts`:
  - `ROUTES` (`as const`), `type Route`, `interface RouteSpec { name: Route; when: string }` e `ROUTE_TABLE`, com os textos de `when` da tabela de [data-model.md](./data-model.md);
  - `type RouteSource = "router" | "override" | "fallback"` e `interface RouteDecision { route: Route; reason: string; source: RouteSource }`;
  - `type Router = (input: { prompt: string; routes: readonly RouteSpec[] }) => Promise<unknown>`;
  - `routerSystemPrompt(routes)` (pura): instrução em pt-BR ("Você é o roteador do OpsPilot… escolha exatamente uma rota da tabela… justifique em uma frase curta") seguida da tabela Markdown gerada das `routes`;
  - `routeDecisionSchema(routes)`: `z.object({ route: z.enum(names).describe(...), reason: z.string().trim().min(1).describe(...) })`;
  - `parseRouteDecision(raw, routes)` (pura, `safeParse` no schema; `null` se falhar);
  - `defaultRouter`: `createModel().withStructuredOutput(routeDecisionSchema(routes)).invoke([["system", routerSystemPrompt(routes)], ["user", prompt]])`;
  - `logRouteFailure(error)`: `console.warn` só com o `name` do erro, no mesmo molde do `logSummaryFailure` em `src/agents/summarizer.ts`.

  Fazer o T002 passar.
- [X] T004 [P] Criar `src/agents/fake-router.ts` com `createFakeRouter(result: { route: string; reason: string } | Error, calls: Array<{ prompt: string; routes: readonly RouteSpec[] }> = [])`, que devolve `Router`. Ele registra cada chamada em `calls` e resolve com `result` ou rejeita com ele quando é `Error`. Seguir o molde de `src/agents/fake-summarizer.ts`.
- [X] T005 [P] Criar `src/agents/routes.test.ts`, que deve falhar até o T006 existir, usando estratégias falsas com `name` distinto e `critic` dublê que aprova sempre:
  - (a) com um registry com `react` e `plan-and-execute`, `routeStrategies(registry)` tem as chaves `react`, `plan-and-execute` e `reflection`, e `reflection.name === "reflect:react"`;
  - (b) `react` e `plan-and-execute` do resultado são os mesmos objetos do registry (sem `reflect`);
  - (c) com `{ reflect: true }`, `react.name === "reflect:react"`, `plan-and-execute.name === "reflect:plan-and-execute"` e `reflection.name === "reflect:react"` (nunca `reflect:reflect:react`);
  - (d) com um registry só com `plan-and-execute`, não existe `react` nem `reflection`;
  - (e) `availableRoutes(...)` devolve as `RouteSpec` presentes na ordem de `ROUTE_TABLE`;
  - (f) o `reflectionOptions.critic` passado chega ao `withReflection`: rodar `reflection` e verificar que o crítico dublê foi chamado.
- [X] T006 Criar `src/agents/routes.ts` com `routeStrategies(registry, { reflect, reflectionOptions } = {})` e `availableRoutes(strategies)`, conforme o research §6. A `reflection` é construída sempre a partir do `react` **base** do registry. Fazer o T005 passar. Depende de T003.
- [X] T007 Em `src/graph/production-graph.ts` (arquivo novo), declarar só os tipos e a função pura do rastro:
  - `type NodeName = "contexto" | "roteador" | Route | "resposta"`;
  - `type RouteEvent = { type: "route"; route: Route; reason: string; source: RouteSource }`;
  - `type GraphTraceEvent = (TraceEvent | RouteEvent) & { node: NodeName }`;
  - `type GraphTrace = readonly GraphTraceEvent[]`;
  - `tagTrace(trace, node)` (pura: `trace.map(e => ({ ...e, node }))`).

  Depende de T003.
- [X] T008 Atualizar `src/agents/trace.ts`: `formatTrace` passa a aceitar `readonly (TraceEvent | RouteEvent)[]`, e o `LABELS` ganha `route: "Rota"`. Formato do evento de rota: `[Rota] <route> (<source>): <reason>`. Em `src/agents/trace.test.ts`, adicionar um caso para o evento `route` e garantir que eventos com `node` continuam formatados igual. Depende de T007.

**Checkpoint**: `npm run typecheck` e `npm test` verdes. O fluxo de produção ainda não mudou.

---

## Phase 3: User Story 1 - O agente escolhe sozinho a estratégia certa (Priority: P1) 🎯 MVP

**Goal**: `createProductionGraph` roda `context → router → estratégia → answer`.
Sem `strategy`, o roteador decide e o rastro traz um evento `route` com
`source: "router"`; em falha, o turno cai em `fallback` com `react`.
`runChat` e `/chat` passam a usar o grafo.

**Independent Test**: com `createFakeRouter({ route: "plan-and-execute", reason: "vários passos" })`
e estratégias falsas, um `/chat` sem `strategy` executa só a estratégia
`plan-and-execute`, o rastro contém
`{ type: "route", route: "plan-and-execute", source: "router" }` antes dos
eventos da estratégia, e a resposta vem dela.

### Tests for User Story 1 ⚠️

> Escrever primeiro e garantir que FALHAM antes da implementação.

- [X] T009 [US1] Criar `src/graph/production-graph.test.ts`. Estratégias falsas registram a `question` recebida e devolvem `{ answer: "<nome>", trace: [{ type: "answer", content: "<nome>" }], metrics: { llmCalls: 2, latencyMs: 1 } }`. Usar `createMockConversationStore` e `createFakeRouter`. Casos:
  - (a) **roteado**: o roteador devolve `plan-and-execute` → só essa estratégia roda; `output.answer === "plan-and-execute"`; `output.route` deepEqual `{ route: "plan-and-execute", reason, source: "router" }`; `output.trace[0]` é o evento `route` e `output.trace[1]` é o `answer`; `output.llmCalls === 3` (1 do roteador + 2 da estratégia);
  - (b) **o roteador recebe o prompt montado e as rotas**: `calls[0].prompt === output.built.prompt`, que contém a pergunta, e `calls[0].routes` são as rotas disponíveis na ordem de `ROUTE_TABLE`;
  - (c) **prompt da estratégia inalterado** (FR-002): a `question` recebida pela estratégia é igual a `buildContext({ question, facts, summary, history }).prompt` calculado à parte, com fatos e histórico presentes;
  - (d) **fallback por erro**: o roteador rejeita com `TypeError` → `react` roda, `route.source === "fallback"`, `route.reason` contém `TypeError` e `logRouteFailure` foi chamado (mock de `console.warn`); `llmCalls` conta 1 do roteador;
  - (e) **fallback por saída inválida**: o roteador devolve `{ route: "foo", reason: "x" }` → `react` com `fallback`;
  - (f) **fallback por rota indisponível**: estratégias sem `plan-and-execute` e o roteador devolve `plan-and-execute` → `react` com `fallback`;
  - (g) **sem router nas deps**: `react` com `fallback`, `reason` "Roteador não configurado; seguindo com react.", sem log e `llmCalls` sem a parcela do roteador;
  - (h) **resumo antes da rota**: conversa com histórico suficiente para disparar resumo (copiar o arranjo dos testes do specs/012 em `src/services/history-service.test.ts`) e `createFakeSummarizer` → `trace[0].type === "summarize"` e `trace[1].type === "route"`;
  - (i) **erro de domínio preserva a classe**: `conversationId` inexistente → `invoke` rejeita com `instanceof ConversationNotFoundError` (research §9);
  - (j) **erro da estratégia propaga**: uma estratégia que lança `new Error("boom")` → `invoke` rejeita com essa mesma instância.
- [X] T010 [US1] Em `src/services/chat-service.test.ts`:
  - migrar todas as chamadas de `runChat` de `{ strategy: X, ... }` para `{ strategies: { react: X }, ... }`, sem `router` (cai em fallback → `react`, mesmo comportamento observável de antes);
  - ajustar as asserções de `trace` que comparam o rastro inteiro para considerar o evento `route` e o campo `node`;
  - adicionar casos:
    - (a) com `router: createFakeRouter({ route: "plan-and-execute", ... })` e `strategies` com as duas falsas, roda a `plan-and-execute` e `metrics.llmCalls` inclui +1;
    - (b) `promptTokens` soma o uso do roteador: o roteador falso chama `recordUsage({ inputTokens: 7, ... })` antes de resolver, e o total inclui os 7 (ver `usageStrategy` no mesmo arquivo);
    - (c) roteador que nunca resolve + `timeoutMs` baixo → rejeita com `TimeoutError` e nada é gravado;
    - (d) a falha do roteador não impede a gravação nem o `learn`.

### Implementation for User Story 1

- [X] T011 [US1] Implementar `createProductionGraph(deps)` em `src/graph/production-graph.ts`, conforme o contrato:
  - estado `Annotation.Root` com canais `input`, `prepared`, `decision`, `result`, `trace` (reducer concat), `llmCalls` (reducer soma) e `final`. Nenhum canal pode ter o nome de um nó (research §2);
  - nó `contexto`: `loadConversationContext` quando há `conversationId` (deps `conversations`, `summarizer`, `log: logSummaryFailure`), senão `{ recent: [] }`; depois `buildContext({ question: message, facts, summary, history: recent }, budget)`. Emite `tagTrace([event], "contexto")` se houver `event`;
  - nó `roteador`:
    1. calcula `routes = availableRoutes(strategies)`;
    2. sem `router` nas deps → fallback "Roteador não configurado…";
    3. senão `router({ prompt: built.prompt, routes })` dentro de `try`, depois `parseRouteDecision`; se der `null` ou exceção → `logRouteFailure` e fallback "Roteador indisponível (<name>); seguindo com react." (para saída inválida, usar `name` = `InvalidRouteDecision`);
    4. `llmCalls: 1` sempre que o `router` foi chamado;
    5. emite `tagTrace([{ type: "route", ... }], "roteador")`.

    O override fica para a US2 e não entra neste nó ainda;
  - um nó por rota presente em `strategies` (`react`, `plan-and-execute`, `reflection`): `strategy.run({ question: built.prompt })` → `result`, `trace: tagTrace(result.trace, <rota>)`, `llmCalls: result.metrics.llmCalls`;
  - nó `resposta`: monta `final: ProductionOutput` com `answer`, `trace`, `llmCalls`, `latencyMs` (da estratégia), `built` e `route`;
  - arestas `START → contexto → roteador`, `addConditionalEdges("roteador", s => s.decision.route, ...)` para os nós presentes, cada estratégia → `resposta` → `END`;
  - `invoke(input)` chama `graph.invoke` e devolve `state.final`. Se o erro vier embrulhado pelo LangGraph, relançar `error.cause` quando ele for uma instância de `Error` (research §9). Só fazer isso se o T009(i) falhar sem o desembrulho.

  Fazer o T009 passar.
- [X] T012 [US1] Refatorar `runChat` em `src/services/chat-service.ts`:
  - `ChatDeps.strategy` vira `strategies: Partial<Record<Route, ReasoningStrategy>>` mais `router?: Router`;
  - `ChatResult.trace` passa a ser `GraphTrace`;
  - dentro de `runWithTimeout(trackUsage(...))`, trocar o bloco `loadConversationContext` + `buildContext` + `strategy.run` por `createProductionGraph({ strategies, router, conversations, summarizer, budget }).invoke({ message, conversationId, facts })`;
  - métricas: `llmCalls`/`latencyMs` do output; `historyMessages`, `memoryFacts`, `contextBreakdown` e `contextTrimmed` a partir de `output.built`; `promptTokens` como hoje;
  - remover o `trace` montado à mão com `context.event` (o grafo já o emite);
  - atualizar o JSDoc citando specs/014.

  Fazer o T010 passar.
- [X] T013 [US1] Atualizar `src/http/server.ts`:
  - `AppDeps.router?: Router`;
  - o handler calcula `strategies = routeStrategies(strategiesFor(userId), { reflect, reflectionOptions: opts.reflectionOptions })` e chama `runChat({ message, conversationId, userId }, { strategies, router: deps.router, ... })`;
  - remover a resolução por `DEFAULT_STRATEGY_NAME` e o `withReflection` local; a validação de `strategy` fica para a US2. Por enquanto, `strategy` informado é ignorado só até o T016.
- [X] T014 [US1] Atualizar `src/http/server.test.ts`:
  - `withServer` aceita `router` em `extra` e o repassa;
  - os registries falsos passam a ter `react` e `plan-and-execute`;
  - ajustar as asserções de `trace` (evento `route` + `node`);
  - adicionar o teste "sem strategy, o roteador decide": `createFakeRouter({ route: "plan-and-execute", reason: "vários passos" })` → `answer` da `plan-and-execute` e `trace` com `route`/`source: "router"`;
  - adicionar o teste "roteador falha → 200 com react e source fallback";
  - `reflect: true` sem `strategy` com o roteador escolhendo `react` → o crítico dublê é chamado.
- [X] T015 [US1] Em `src/index.ts`, passar `router: defaultRouter` para `createApp`, com o comentário `// Roteador do grafo de produção (specs/014)`. O `DEFAULT_STRATEGY_NAME` em `src/agents/index.ts` fica sem uso no Controller: removê-lo se nenhum outro arquivo importar (conferir com grep, incluindo `arena.ts` e `bench.ts`).

**Checkpoint**: um `/chat` sem `strategy` passa pelo grafo e o roteador decide. `npm run typecheck` e `npm test` verdes.

---

## Phase 4: User Story 2 - Forçar uma estratégia e ver que foi forçada (Priority: P2)

**Goal**: `strategy` no `/chat` vira override. O roteador não chama o modelo,
o evento `route` sai com `source: "override"`, e uma rota desconhecida dá
422 com `available` incluindo `reflection`.

**Independent Test**: `/chat` com `strategy: "plan-and-execute"` e um
roteador falso que registra chamadas → `calls.length === 0`, roda a
`plan-and-execute`, e o rastro tem
`{ type: "route", route: "plan-and-execute", source: "override", reason: "Estratégia definida na requisição." }`.

### Tests for User Story 2 ⚠️

- [X] T016 [US2] Em `src/graph/production-graph.test.ts`, adicionar:
  - (a) `override: "plan-and-execute"` → roteador não chamado (`calls.length === 0`), `route` deepEqual `{ route: "plan-and-execute", reason: "Estratégia definida na requisição.", source: "override" }` e `llmCalls` sem a parcela do roteador;
  - (b) `override: "reflection"` → roda a estratégia `reflection`.
- [X] T017 [US2] Em `src/http/server.test.ts`, adicionar:
  - (a) `strategy: "plan-and-execute"` com roteador espião → override, sem chamada ao roteador;
  - (b) `strategy: "xyz"` → 422 `{ error: "unknown_strategy", strategy: "xyz", available: ["react", "plan-and-execute", "reflection"] }` e nada gravado no store;
  - (c) `strategy: "reflection"` com `reflect: true` → o crítico dublê é chamado o número de vezes de **uma** camada de reflexão (aprovando na primeira, exatamente 1 chamada);
  - (d) `strategy: "react"` (cliente legado) continua 200 (SC-005).

### Implementation for User Story 2

- [X] T018 [US2] Em `src/graph/production-graph.ts`, adicionar `override?: Route` ao `ProductionInput`. No nó `roteador`, quando `override` estiver presente e existir em `strategies`, decidir `{ route: override, reason: "Estratégia definida na requisição.", source: "override" }` sem chamar o `router` e com `llmCalls: 0`. Fazer o T016 passar.
- [X] T019 [US2] Repassar o override de ponta a ponta:
  - em `src/services/chat-service.ts`: `ChatInput.strategy?: Route`, repassado como `override`;
  - em `src/http/server.ts`: depois de `routeStrategies`, se `strategy` vier e não estiver em `availableRoutes(strategies)`, responder 422 `unknown_strategy` com `available` (nomes, na ordem de `ROUTE_TABLE`); senão passar `strategy` ao `runChat`;
  - atualizar o JSDoc do Controller citando specs/014.

  Fazer o T017 passar.

**Checkpoint**: override e 422 funcionando; US1 continua verde.

---

## Phase 5: User Story 3 - Saber qual etapa produziu cada evento (Priority: P3)

**Goal**: todo evento do rastro traz `node` correto: `contexto`, `roteador` ou o
nome da rota.

**Independent Test**: um turno com resumo, rota `reflection` e crítica →
todos os eventos têm `node`; `summarize` → `contexto`; `route` → `roteador`;
`thought`/`action`/`observation`/`critique`/`answer` → `reflection`.

### Tests for User Story 3 ⚠️

- [X] T020 [P] [US3] Em `src/graph/production-graph.test.ts`, adicionar:
  - (a) `tagTrace` puro: preserva os campos e a ordem e adiciona `node` sem mutar a entrada (`Object.isFrozen` ou comparar a entrada antes/depois);
  - (b) turno com resumo + roteador → `reflection`, usando a `reflection` real de `routeStrategies` com crítico dublê e uma estratégia `react` falsa que emite `thought`/`action`/`observation`/`answer` → `every(e => typeof e.node === "string")`, `summarize.node === "contexto"`, `route.node === "roteador"` e todo o resto com `node === "reflection"`, inclusive o `critique`;
  - (c) nenhum evento tem `node === "resposta"` (o nó `resposta` não emite eventos).
- [X] T021 [P] [US3] Em `src/http/server.test.ts`, adicionar uma asserção na resposta HTTP: todo `trace[i]` tem `node` dentro de `["contexto", "roteador", "react", "plan-and-execute", "reflection"]` (SC-001).

### Implementation for User Story 3

- [X] T022 [US3] Revisar `src/graph/production-graph.ts` para que todo ponto que escreve no canal `trace` passe por `tagTrace`, e que o tipo do canal (`GraphTraceEvent[]`) impeça eventos sem `node` em tempo de compilação. Fazer o T020 e o T021 passarem. Se já passarem pelo que foi feito no T011, registrar no commit que a story foi coberta pela fundação.

**Checkpoint**: as três stories verdes de forma independente.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T023 [P] Criar `src/agents/router-eval.ts` (fora do `npm test`, molde de `src/memory/learning-eval.ts`):
  - perguntas de referência por rota, ≥ 6 por rota:
    - `react`: "Lista os alertas disparando", "Qual o runbook do checkout?", …;
    - `plan-and-execute`: "Para cada alerta crítico, abra um incidente e me diga o runbook", …;
    - `reflection`: "Faça um diagnóstico do que está acontecendo com pagamentos e confira antes de responder", …;
  - roda `defaultRouter` + `parseRouteDecision` com `ROUTE_TABLE`, com pausa `OPSPILOT_EVAL_DELAY_MS` (default 6000) entre chamadas;
  - imprime a taxa de acerto por rota e a geral, e sai com exit 1 se a geral ficar < 80% (SC-004) ou se alguma chamada falhar;
  - JSDoc com o comando `node --env-file-if-exists=.env --import tsx src/agents/router-eval.ts`.
- [X] T024 [P] Atualizar `AGENTS.md`:
  - nova seção "Grafo de produção" (specs/014): nós, `ROUTE_TABLE`, `withStructuredOutput({ route, reason })`, evento `route` com `source`, `node` em todo evento, fallback para `react`, `routeStrategies` com `reflection` = `react` + reflexão e o comando do `router-eval`;
  - em "Conversa persistente", trocar "O turno fica em `runChat`" por uma descrição que mencione o grafo;
  - descrever `strategy` no `/chat` como override opcional.
- [X] T025 [P] Em `scripts/conversa-long.sh`, adicionar uma coluna `rota` com o `route` do evento `type == "route"` de cada turno, sem mudar as colunas existentes.
- [X] T026 Rodar `npm run typecheck` e `npm test`, ambos verdes. Seguir os passos manuais 1–4 de [quickstart.md](./quickstart.md) com a API rodando e conferir a saída esperada.
  - Parcial (2026-10-20): typecheck e `npm test` verdes (321 pass, 2 skip); passo 3 do quickstart conferido contra a API real (422 com `available` = as três rotas). Passos 1, 2 e 4 e o `router-eval` dependem do modelo real e ficam para rodar com credenciais.
  - Tentativa (2026-10-20 11:34 UTC): a cota diária gratuita da OpenRouter (`free-models-per-day`, 50/dia) esgotou. Numa execução anterior do passo 1 o roteador falhou com `RateLimitCapacityError` e o turno seguiu via `react` com `source: "fallback"` e `node` em todos os eventos (FR-009 conferido ao vivo). Na execução seguinte, os passos 1, 2 e 4 deram 500 porque a própria estratégia recebeu 429; esse comportamento já existia antes da 014. Refazer depois do reset (00:00 UTC) ou com créditos.
  - Rodada 2026-10-21 (após o reset):
    - **Passo 1**: com o pedido original ("para cada alerta crítico…"), estourou o timeout (504). O roteador real escolheu `plan-and-execute` corretamente, mas sozinho levou 44 s no modelo gratuito, e a estratégia não coube no resto dos 180 s. Repetido com "Lista os alertas que estão disparando.": ✔ `route` com `source: "router"` → `react`, um único `route`, `node` em todos os eventos, `llmCalls` 3, 16 s.
    - **Passo 2**: ✔ override `react`, `source: "override"`, roteador não chamado (`llmCalls` 2).
    - **Passo 3**: ✔ 422 com as três rotas.
    - **`router-eval`**: ✔ 83% (15/18; react 6/6, plan-and-execute 4/6, reflection 5/6; meta ≥ 80%, exit 0).
    - **Passo 4**: ✖ bloqueado de novo pela cota diária (`free-models-per-day`, 429 no 1º turno → 500). A ordem `summarize` (`contexto`) → `route` (`roteador`) está coberta pelos testes automatizados (`production-graph.test.ts`); falta só a conferência ao vivo.
  - Fechamento (2026-10-21):
    - **Nova tentativa ao vivo do passo 4**: turno 1 ok; turno 2 levou 429 da cota diária e deu 500.
    - **Bug encontrado e corrigido em `scripts/conversa-long.sh` (T025)**: a coluna `rota` saía vazia porque o `process.stdout.write` não incluía `${rota}`. Conferido offline com um JSON de exemplo.
    - **Passo 4 de ponta a ponta pelo HTTP**: `createApp` real, grafo, store e `conversa-long.sh` (`TURNS=9`), com dublês só no lugar do modelo (estratégias, roteador e resumidor). ✔ O resumo saiu no 9º turno (`*`, histórico 14 → 8) e a `rota` aparece em todos os turnos. O rastro do 9º turno veio `summarize`/`contexto` → `route`/`roteador` → `answer`/`react`.
    - **Passos 1–3 e `router-eval`**: validados ao vivo acima.
    - **Pendência**: rodar o passo 4 com o modelo real quando houver cota.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → US1 → US2 / US3 → Polish.
- **US2** depende da US1, porque o override vive no nó `roteador` e no Controller criados na US1.
- **US3** depende da US1 (o `tagTrace` já é aplicado no T011). Ela é sobretudo verificação e pode correr em paralelo à US2.

### Within Phase 2

- T002 ∥ T004 ∥ T005, e T003 ∥ T004. T006 depende de T003, T007 de T003, e T008 de T007.

### Within US1

- T009 e T010 (testes) → T011 → T012 → T013 → T014 → T015.

### Parallel Opportunities

- Fase 2: `router.ts`/teste, `fake-router.ts` e `routes.test.ts` são arquivos distintos.
- US3: T020 e T021 (arquivos diferentes).
- Polish: T023, T024 e T025.

## Parallel Example: Phase 2

```text
Task: "T002 router.test.ts"
Task: "T004 fake-router.ts"
Task: "T005 routes.test.ts"
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Fases 1 e 2.
2. US1 (T009–T015): o `/chat` passa a rotear, e `strategy` fica temporariamente ignorado.
3. **Validar**: o teste independente da US1 e `npm test` verde.

> Como a US1 deixa `strategy` ignorado até o T019, não publicar entre a US1
> e a US2. As duas juntas formam a entrega mínima compatível com clientes
> atuais (SC-005).

### Incremental Delivery

US1 + US2 → entrega compatível; US3 → garantia do `node`; Polish → avaliação
real, documentação e script.

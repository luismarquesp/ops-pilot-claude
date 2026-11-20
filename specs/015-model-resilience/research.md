# Research: Resiliência de Modelo

Sem `NEEDS CLARIFICATION` no Technical Context. As decisões abaixo saem da
leitura do código instalado (`@langchain/core` 1.2.9, `@langchain/langgraph`
1.4.14, `@langchain/openai` 1.5.11) e dos pontos de chamada de `createModel()`.

## §1 Onde a resiliência entra: o modelo já composto, não o `ChatOpenAI` cru

- **Problema**: `model.withRetry()` e `model.withFallbacks([...])` devolvem um
  `Runnable` genérico, sem `bindTools` nem `withStructuredOutput`. Hoje os
  pontos de chamada fazem `createModel().withStructuredOutput(schema)` (roteador,
  crítico, extrator, planner e replanner), `createModel().bindTools(tools)`
  (executor), `createModel().invoke` (resumidor) e
  `createReactAgent({ llm: createModel() })`.
- **Decision**: `createModel` passa a receber um *builder* opcional que compõe
  cada modelo antes da resiliência:
  `createModel(build = (m) => m)`, por exemplo
  `createModel((m) => m.withStructuredOutput(schema))` ou
  `createModel((m) => m.bindTools(tools))`. Internamente:
  `track(primary, build(primary)).withRetry({ stopAfterAttempt })` (e o mesmo para cada reserva)
  `.withFallbacks(reserves.map((id) => track(id, build(model(id)))))`, embrulhado
  num `RunnableLambda` que abre o escopo da chamada (§4).
- **Rationale**: atende ao pedido (`withRetry` no primário, `withFallbacks` com
  as reservas) e mantém o mesmo esquema e as mesmas tools em todos os modelos.
  A resiliência não depende do formato de saída.
- **Alternatives considered**:
  - Subclasse de `ChatOpenAI` com fallback interno: acopla à classe e duplica a
    lógica de retry.
  - Resiliência só no `invoke` cru: perderia `withStructuredOutput` e
    `bindTools`.

## §2 `createReactAgent` com modelo resiliente

- **Decision**: `createReactAgent({ llm: () => createModel((m) => m.bindTools(tools)), tools })`,
  usando o modo de **modelo dinâmico** do prebuilt.
- **Rationale**: com `llm` estático, o prebuilt chama `_shouldBindTools` e
  `_bindTools`, que exigem um chat model ou um `RunnableBinding` e lançam
  `llm ... must define bindTools method` para um `RunnableWithFallbacks`. No
  modo dinâmico (`typeof llm === "function"`), o modelo devolvido é só
  encadeado ao prompt e invocado, sem essa checagem (lido em
  `dist/prebuilt/react_agent_executor.js`, `_getDynamicModel`). Como o modelo
  é criado a cada passo do agente, o escopo de tentativas (§4) também é por
  chamada.
- **Alternatives considered**: reescrever o ReAct à mão (fora de escopo e
  arriscado para specs/001).

## §3 Novas tentativas: `withRetry` com `maxRetries: 0` no cliente

- **Decision**: o `ChatOpenAI` passa a ser criado com `maxRetries: 0`. Quem
  reinsiste é o `withRetry({ stopAfterAttempt: 2 })`, aplicado ao primário e
  a cada reserva (decisão de 2026-10-21, a partir do esboço do usuário).
- **Rationale**: o `AsyncCaller` do `@langchain/core` já faz até 6 novas
  tentativas por padrão, com espera exponencial. Isso aparece no stack do 429
  visto na T026 da 014 (`pRetry` dentro de `completions.ts`) e explica turnos
  lentos antes de falhar. Com as duas camadas ativas, seriam 2 × 7 chamadas
  por modelo. O `RunnableRetry` usa `pRetry` com
  `retries = stopAfterAttempt - 1` e `randomize: true`, com espera padrão de
  ~1 s: atende à "espera crescente" do FR-002.
- **Testabilidade**: o número de tentativas é injetável no núcleo
  (`attempts`). Os testes usam 1 (sem espera) ou 2 (uma espera de ~1–2 s) só
  no caso que cobre o retry.
- **Alternatives considered**: manter o retry interno do cliente e não usar
  `withRetry` (contraria o pedido e não deixa observar as tentativas).

## §4 Observar tentativas sem callbacks: wrappers + `AsyncLocalStorage`

- **Decision**: cada modelo da cadeia é envolvido por `track(id, runnable)`,
  um `RunnableLambda` que registra `{ model: id, ok, error?: name }` no escopo
  da chamada (um `AsyncLocalStorage` próprio, aberto pelo `RunnableLambda`
  externo de `createModel`). Ao terminar, a função pura
  `summarizeAttempts(attempts)` devolve `{ modelUsed, switches, modelsTried }`.
  - Em sucesso, o resultado é registrado no escopo do turno
    (`recordModelCall`, §5).
  - Se todos falharem, lança `ModelUnavailableError(modelsTried)` (§6).
  - Uma troca com sucesso loga `[model] fallback <from> → <to>: <ErrorName>`.
- **Rationale**: é determinístico e testável sem rede. Não depende da
  hierarquia de run ids dos callbacks. O `AsyncLocalStorage` se propaga pelas
  promises do `withRetry` e do `withFallbacks`, que só fazem `await`
  encadeado.
- **Alternatives considered**: callbacks `handleLLMError`/`handleLLMEnd`
  (agrupar por chamada exige percorrer `parentRunId`, e o specs/011 já mostrou
  que o contexto dos handlers não é confiável).

## §5 Agregação por turno e por nó

- **Decision**: `src/agents/model-calls.ts` com `trackModelCalls(fn)`,
  `recordModelCall(call)` e `modelCallsSince(mark)`, no mesmo molde do
  `usage-tracker` (specs/011). O `runChat` abre o escopo junto com o
  `trackUsage`. Cada nó do grafo (specs/014) marca o tamanho da lista antes de
  rodar e, depois:
  - converte as trocas das chamadas novas em eventos
    `{ type: "fallback", from, to, reason }` com o `node` do nó, **no início**
    dos eventos daquele nó (a troca aconteceu antes do que o nó produziu);
  - o nó de estratégia grava `modelUsed` = `modelUsed` da última chamada dele
    (`null` se não houve chamada, como nas estratégias falsas dos testes).

  O nó `resposta` remove os eventos `fallback` repetidos pelo par
  `from → to`, mantendo o primeiro (função pura `dedupeFallbacks`, FR-008).
- **Rationale**: atribui cada troca à etapa em que ocorreu sem que as
  estratégias saibam do grafo. Sem trocas, o rastro fica idêntico ao do
  specs/014.
- **Alternatives considered**: `modelUsed` = última chamada do turno inteiro
  (o resumidor ou o roteador poderiam mascarar o modelo que de fato
  respondeu).

## §6 503 só quando a resposta depende do modelo

- **Decision**: `ModelUnavailableError { modelsTried: string[] }` em
  `src/services/errors.ts`. Ele atravessa as estratégias, que só capturam
  `GraphRecursionError`, e o grafo, que preserva a classe (verificado no
  specs/014). O Controller traduz para
  `503 { error: "model_unavailable", modelsTried }`, com log só dos nomes
  (FR-012). Roteador, crítico, resumidor e aprendizado já capturam qualquer
  erro, então mantêm a tolerância (FR-010) sem mudança de código. O
  `TimeoutError` continua prevalecendo (504).
- **Rationale**: o erro de domínio é traduzido na borda (Princípio IV), e não
  é preciso classificar o erro em cada ponto de chamada.

## §7 Configuração

- **Decision**: a função pura `parseModelChain(env)` (`src/agents/model.ts`)
  devolve `{ primary, fallbacks }`:
  - `primary` = `OPEN_ROUTER_MODEL` (como hoje);
  - `fallbacks` = `OPENROUTER_MODEL_FALLBACK` dividido por vírgula, com `trim`,
    sem vazios, sem repetidos e sem o primário (FR-004).

  É lida a cada `createModel`, que lê `process.env` como já fazia. Os testes
  injetam a cadeia.
- **Rationale**: nada novo na subida e nenhuma dependência nova. A lista
  vazia é válida.

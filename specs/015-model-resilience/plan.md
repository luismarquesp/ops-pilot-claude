# Implementation Plan: Resiliência de Modelo (retry + modelos reserva)

**Branch**: `015-model-resilience` | **Date**: 2026-10-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/015-model-resilience/spec.md`

## Summary

`createModel` passa a devolver um modelo resiliente e recebe um *builder*
(`(m) => m.withStructuredOutput(s)`, `(m) => m.bindTools(tools)`) que compõe
cada modelo da cadeia antes de aplicar a resiliência. O primário roda em
`withRetry({ stopAfterAttempt: 2 })`, e as reservas de
`OPENROUTER_MODEL_FALLBACK`, cada uma também com `withRetry` de 2 tentativas,
entram via `withFallbacks`. O `ChatOpenAI` perde o
retry interno (`maxRetries: 0`), para não multiplicar tentativas.

Cada modelo da cadeia é envolvido por um `RunnableLambda` que registra as
tentativas num escopo `AsyncLocalStorage` da chamada. A função pura
`summarizeAttempts` produz `modelUsed`, as trocas e os modelos tentados.

- **Em sucesso**: o resultado vai para um escopo por turno
  (`trackModelCalls`). O grafo do specs/014 transforma as trocas de cada nó em
  eventos `fallback` (deduplicados no nó `resposta`) e o nó de estratégia
  define `metrics.modelUsed`.
- **Em falha total**: sai `ModelUnavailableError`, que o Controller traduz para
  `503 model_unavailable`. Roteador, crítico, resumidor e aprendizado já
  toleram falha e não mudam.

O `createReactAgent` passa a receber o modelo no modo dinâmico, porque o modo
estático exige `bindTools` (research §2).

## Technical Context

**Language/Version**: TypeScript (ESM, `strict: true`) sobre Node.js 22 LTS

**Primary Dependencies**:
- `@langchain/core` 1.2.9: `Runnable.withRetry`, `withFallbacks`, `RunnableLambda`;
- `@langchain/openai` 1.5.11: `ChatOpenAI` com `maxRetries: 0`;
- `@langchain/langgraph` 1.4.14: `createReactAgent` com `llm` dinâmico.

Nenhuma dependência nova.

**Storage**: N/A

**Testing**: `node:test` via `tsx`, com `RunnableLambda`s falsos que falham ou
respondem de forma determinística e `attempts` injetável (research §3). Sem
rede.

**Target Platform**: servidor Node (API HTTP local)

**Project Type**: web-service (API Express) com agente LangChain/LangGraph

**Performance Goals**: turno saudável sem chamadas nem esperas extras
(SC-005). Em falha, cada modelo tem no máximo 2 tentativas, com ~1 s de
espera entre elas.

**Constraints**:
- teto de 180 s inalterado (o 504 prevalece);
- logs só com ids de modelo e nome do erro (FR-012);
- rastro idêntico ao do specs/014 quando não há troca.

**Scale/Scope**:
- Novos: `resilience.ts`, `model-calls.ts` (+ testes).
- Ajustes:
  - `model.ts`: `parseModelChain`, `createChatModel`, `createModel(build)`;
  - os 6 pontos de chamada de `createModel`;
  - `production-graph.ts` (+ teste), `chat-service.ts` (+ teste),
    `server.ts` (+ teste), `errors.ts`, `trace.ts`;
  - `.env.example`, `AGENTS.md` e `conversa-long.sh`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Avaliação |
|-----------|-----------|
| I. Validação na Fronteira | ✅ `OPENROUTER_MODEL_FALLBACK` é entrada externa e passa por `parseModelChain` (pura, testada), que normaliza e descarta entradas inválidas. É uma lista de strings livres: um id inexistente só falha na chamada e cai na regra de resiliência. O `/chat` não muda. |
| II. Test-First | ✅ Núcleo (`summarizeAttempts`, `withResilience`, `parseModelChain`, `fallbackEvents`/`dedupeFallbacks`), escopo por turno, grafo, serviço e Controller (503) nascem com teste. |
| III. MVC | ✅ A resiliência fica na fábrica de modelo (`agents/`). O grafo e o Service só agregam, e o Controller só traduz o erro. |
| IV. Erros de domínio na borda | ✅ `ModelUnavailableError` é uma classe em `services/errors.ts`, traduzida para 503 só no Controller. |
| V. Funções puras | ✅ `parseModelChain`, `summarizeAttempts`, `fallbackEvents` e `dedupeFallbacks` são puras. O I/O (chamadas ao modelo, log) fica nos wrappers. |
| VI. Segredos | ✅ Nada lido de `.env` pelo agente. Os logs não incluem a mensagem de erro do provedor, que pode ecoar o pedido. Os ids de modelo não são segredo. O `.env.example` documenta a nova chave sem valor. |

**Resultado**: aprovado. Reavaliado após research, data model e contracts:
continua aprovado, sem violações.

## Project Structure

### Documentation (this feature)

```text
specs/015-model-resilience/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── model-factory.md   # parseModelChain / createModel(build) / withResilience / model-calls
│   └── chat-api.md        # metrics.modelUsed, evento fallback, 503
├── checklists/
│   └── requirements.md
└── tasks.md               # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── agents/
│   ├── model.ts                 # parseModelChain, createChatModel (maxRetries 0), createModel(build, chain)
│   ├── model.test.ts            # NOVO: parseModelChain
│   ├── resilience.ts            # NOVO: withResilience, summarizeAttempts, logModelFallback
│   ├── resilience.test.ts       # NOVO
│   ├── model-calls.ts           # NOVO: trackModelCalls, recordModelCall, modelCallsSince, modelCallCount
│   ├── model-calls.test.ts      # NOVO
│   ├── react.ts                 # llm dinâmico com createModel((m) => m.bindTools(tools))
│   ├── plan-and-execute.ts      # builders no planner/executor/replanner
│   ├── reflection.ts, router.ts # builders (withStructuredOutput)
│   ├── summarizer.ts            # inalterado (createModel().invoke)
│   └── trace.ts                 # rótulo "Troca de modelo"
├── memory/
│   └── learning.ts              # builder (withStructuredOutput)
├── graph/
│   ├── production-graph.ts      # eventos fallback por nó, dedupe, modelUsed
│   └── production-graph.test.ts
├── services/
│   ├── errors.ts                # ModelUnavailableError
│   ├── chat-service.ts          # trackModelCalls + metrics.modelUsed
│   └── chat-service.test.ts
└── http/
    ├── server.ts                # 503 model_unavailable
    └── server.test.ts

.env.example                     # OPENROUTER_MODEL_FALLBACK
AGENTS.md                        # seção "Resiliência de modelo"
scripts/conversa-long.sh         # coluna "modelo"
```

**Structure Decision**: projeto único (`src/`) com testes colocalizados. A
resiliência fica ao lado da fábrica de modelo em `src/agents/`, e o escopo por
turno tem módulo próprio, como o `usage-tracker` do specs/011.

## Complexity Tracking

Sem violações a justificar.

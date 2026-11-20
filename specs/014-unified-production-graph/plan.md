# Implementation Plan: Grafo Unificado de Produção com Roteador

**Branch**: `014-unified-production-graph` | **Date**: 2026-10-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/014-unified-production-graph/spec.md`

## Summary

Todo turno do `/chat` passa a rodar num único `StateGraph` do LangGraph,
`src/graph/production-graph.ts`, com os nós `contexto` → `roteador` →
(`react` | `plan-and-execute` | `reflection`) → `resposta`.

- **`contexto`**: encapsula o que hoje está inline no `runChat` (resumo +
  janela via `loadConversationContext`, e depois `buildContext`).
- **`roteador`**: decide a rota com `withStructuredOutput({ route, reason })`
  sobre um prompt com a tabela das rotas disponíveis. Com `strategy` na
  requisição, registra um override sem chamar o modelo. Em falha, cai para
  `react` com `source: "fallback"`.
- **Nós de estratégia**: rodam a `ReasoningStrategy` correspondente. A rota
  `reflection` é `withReflection(react)`.
- **`resposta`**: consolida resposta, rastro e métricas.

Todo evento do rastro ganha `node`, e o turno ganha exatamente um evento
`route`. O `runChat` mantém em volta do grafo o timeout, o `trackUsage`, o
recall de memória, a gravação após sucesso e o `learn`.

## Technical Context

**Language/Version**: TypeScript (ESM, `strict: true`) sobre Node.js 22 LTS

**Primary Dependencies**: `@langchain/langgraph` (`StateGraph`, já usado pelo
`plan-and-execute`), `@langchain/openai` via `createModel()`, `zod` (schema da
decisão e do `/chat`). Nenhuma dependência nova.

**Storage**: N/A, nada novo persistido. A conversa, o resumo e a memória seguem
como estão.

**Testing**: `node:test` via `tsx`. Usa `createFakeRouter` e estratégias falsas
nos testes de grafo, `runChat` e servidor; testes puros para a tabela, o parse
da decisão, `routeStrategies` e `tagTrace`.

**Target Platform**: servidor Node (API HTTP local)

**Project Type**: web-service (API Express) com agente LangChain/LangGraph

**Performance Goals**: no máximo uma chamada a mais ao modelo por turno sem
`strategy`, e zero com override (SC-002, SC-006). O custo do grafo em si é
desprezível.

**Constraints**:
- prompt das estratégias idêntico ao atual (FR-002);
- turno nunca cai por falha do roteador (FR-009);
- log de falha só com o nome do erro;
- `ConversationNotFoundError` e `TimeoutError` mantêm a classe até o Controller.

**Scale/Scope**:
- Novos: `router.ts`, `fake-router.ts`, `routes.ts`, `production-graph.ts`
  (+ testes) e `router-eval.ts`.
- Ajustes: `trace.ts`, `chat-service.ts` (+ teste), `server.ts` (+ teste),
  `index.ts`, `agents/index.ts` (`DEFAULT_STRATEGY_NAME` deixa de ser usado
  pelo Controller) e `AGENTS.md`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Avaliação |
|-----------|-----------|
| I. Validação na Fronteira (zod) | ✅ O `strategy` do `/chat` continua no schema zod e é validado contra as rotas disponíveis (422). A saída do LLM roteador é revalidada por `routeDecisionSchema` antes de decidir. |
| II. Test-First | ✅ Cada regra nova nasce com teste: tabela, parse, `routeStrategies`, `tagTrace`, nós do grafo (rota, override, fallback, ordem do rastro, erro de domínio) e o servidor (422, override, `node`). |
| III. MVC | ✅ O Controller valida e monta as estratégias (como hoje faz com `withReflection`). O Service `runChat` orquestra o grafo e a gravação. O grafo fica em `agents/`, e os stores seguem como Model. |
| IV. Erros de domínio na borda | ✅ Nenhum erro novo. A falha do roteador degrada para fallback e os erros de domínio atravessam o grafo com a classe original (research §9). |
| V. Funções puras | ✅ `routerSystemPrompt`, `routeDecisionSchema`, `parseRouteDecision`, `routeStrategies`, `availableRoutes` e `tagTrace` são puras. O I/O (LLM, store) fica nos nós e nas deps injetadas. |
| VI. Segredos | ✅ Nada lido de `.env` pelo agente. O log do roteador cita só o nome do erro, e o `router-eval` usa `--env-file-if-exists` como o `learning-eval`. |
| Stack / persistência | ✅ Sem mudança. |

**Resultado**: aprovado. Reavaliado após research, data model e contracts:
continua aprovado, sem violações.

## Project Structure

### Documentation (this feature)

```text
specs/014-unified-production-graph/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── production-graph.md   # router / routes / production-graph
│   └── chat-api.md           # strategy override, evento route, node
├── checklists/
│   └── requirements.md
└── tasks.md                  # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── agents/
│   ├── router.ts                  # NOVO: ROUTES, ROUTE_TABLE, routerSystemPrompt, routeDecisionSchema, parseRouteDecision, defaultRouter, logRouteFailure
│   ├── router.test.ts             # NOVO
│   ├── fake-router.ts             # NOVO: createFakeRouter
│   ├── routes.ts                  # NOVO: routeStrategies, availableRoutes
│   ├── routes.test.ts             # NOVO
│   ├── router-eval.ts             # NOVO: avaliação manual com o modelo real (SC-004)
│   ├── trace.ts                   # rótulo "Rota" + aceita GraphTraceEvent
│   └── index.ts                   # registry inalterado; DEFAULT_STRATEGY_NAME sai do Controller
├── graph/
│   ├── production-graph.ts        # NOVO: createProductionGraph, tagTrace, GraphTraceEvent
│   └── production-graph.test.ts   # NOVO
├── services/
│   ├── chat-service.ts            # ChatDeps.strategies + router; ChatInput.strategy (override); invoca o grafo
│   └── chat-service.test.ts       # migra `strategy:` → `strategies:`; testa route/node
├── http/
│   ├── server.ts                  # routeStrategies + 422 por rota; AppDeps.router
│   └── server.test.ts             # override, roteado (fake), 422 com reflection, node
└── index.ts                       # passa defaultRouter

AGENTS.md                          # seção "Grafo de produção"; /chat strategy
```

**Structure Decision**: projeto único (`src/`) com testes colocalizados
(`*.test.ts`), como nas features anteriores. O grafo fica em
`src/graph/` (nós `contexto`/`roteador`/`resposta` em português, rotas com os
nomes do `/chat`); roteador e rotas ficam em `src/agents/`, ao lado das
estratégias.

## Complexity Tracking

Sem violações a justificar.

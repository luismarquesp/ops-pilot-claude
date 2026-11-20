# Data Model: Grafo Unificado de Produção

Nada é persistido. Todos os tipos ficam em memória durante o turno.

## Route

`type Route = "react" | "plan-and-execute" | "reflection"`. Fonte única: `ROUTES`
e `ROUTE_TABLE` (`src/agents/router.ts`).

## RouteSpec

| Campo | Tipo | Regra |
|-------|------|-------|
| `name` | `Route` | único |
| `when` | `string` | critério de uso, vira a linha da tabela do prompt |

`ROUTE_TABLE` (ordem fixa):

| rota | quando usar |
|------|-------------|
| `react` | consulta ou ação única e direta: listar alertas/incidentes, abrir ou resolver um incidente, ler o runbook de um serviço |
| `plan-and-execute` | tarefa com vários passos dependentes ou repetida sobre vários itens ("para cada alerta crítico, abra um incidente…") |
| `reflection` | resposta que precisa ser conferida com cuidado: diagnóstico, recomendação, resumo para terceiros, pedido explícito para revisar |

## RouteDecision

| Campo | Tipo | Regra |
|-------|------|-------|
| `route` | `Route` | entre as rotas disponíveis no turno |
| `reason` | `string` | não vazia |
| `source` | `"router" \| "override" \| "fallback"` | `fallback` sempre com `route: "react"` |

Transições no nó `roteador`:

```text
override presente                       → source=override (sem chamada ao modelo)
sem router nas deps                     → source=fallback, react
router ok e decisão válida              → source=router
router lança / saída inválida / rota
  indisponível                          → source=fallback, react, log do nome do erro
```

## NodeName

`"contexto" | "roteador" | Route | "resposta"`

## GraphTraceEvent

`(TraceEvent | RouteEvent) & { node: NodeName }`

- `RouteEvent = { type: "route"; route: Route; reason: string; source: RouteDecision["source"] }`
- Ordem no rastro: `summarize` (node `contexto`, opcional) → `route` (node
  `roteador`, exatamente um) → eventos da estratégia (node = rota). O nó `resposta`
  não emite eventos.

## RouteStrategies

`Partial<Record<Route, ReasoningStrategy>>`, gerado por `routeStrategies(registry, { reflect, reflectionOptions })`.
As rotas disponíveis são as chaves presentes, na ordem de `ROUTE_TABLE`.
`react` é obrigatória.

## Estado do grafo (`ProductionState`)

| Canal | Tipo | Escrito por |
|-------|------|-------------|
| `input` | `{ message; conversationId?; facts; override? }` | entrada |
| `prepared` | `{ conversation: ConversationContext; built: BuiltContext }` | `contexto` |
| `decision` | `RouteDecision` | `roteador` |
| `result` | `StrategyResult` | nó da estratégia |
| `trace` | `GraphTraceEvent[]` (reducer: concat) | `contexto`, `roteador`, estratégia |
| `llmCalls` | `number` (reducer: soma) | `roteador`, estratégia |
| `final` | `ProductionOutput` | `resposta` |

## ProductionOutput (devolvido ao `runChat`)

`{ answer; trace: GraphTraceEvent[]; llmCalls; latencyMs (da estratégia); built; route: RouteDecision }`

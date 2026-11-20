# Contract: production-graph / router / routes

## `src/agents/router.ts`

```ts
export const ROUTES: readonly ["react", "plan-and-execute", "reflection"];
export type Route = (typeof ROUTES)[number];
export interface RouteSpec { name: Route; when: string }
export const ROUTE_TABLE: readonly RouteSpec[];

export type RouteSource = "router" | "override" | "fallback";
export interface RouteDecision { route: Route; reason: string; source: RouteSource }

export type Router = (input: { prompt: string; routes: readonly RouteSpec[] }) => Promise<unknown>;

export function routerSystemPrompt(routes: readonly RouteSpec[]): string;   // pura; contém a tabela
export function routeDecisionSchema(routes: readonly RouteSpec[]): ZodType<{ route: Route; reason: string }>;
export function parseRouteDecision(raw: unknown, routes: readonly RouteSpec[]): { route: Route; reason: string } | null; // pura
export const defaultRouter: Router;                                          // createModel().withStructuredOutput(...)
export function logRouteFailure(error: unknown): void;                       // só error.name
```

- `routerSystemPrompt` lista **só** as `routes` recebidas e contém uma linha
  `| <name> | <when> |` por rota.
- `parseRouteDecision` devolve `null` para saída fora do schema ou rota fora
  de `routes`.

## `src/agents/fake-router.ts`

`createFakeRouter(result: { route; reason } | Error, calls?: Array<{ prompt; routes }>)`:
devolve a decisão fixa ou rejeita com o erro, e registra as chamadas.

## `src/agents/routes.ts`

```ts
export function routeStrategies(
  registry: ReadonlyMap<string, ReasoningStrategy>,
  opts?: { reflect?: boolean; reflectionOptions?: ReflectionOptions },
): Partial<Record<Route, ReasoningStrategy>>;
export function availableRoutes(strategies: Partial<Record<Route, ReasoningStrategy>>): RouteSpec[]; // ordem de ROUTE_TABLE
```

- `reflection` existe se e somente se existe `react`. É o
  `withReflection(react)` construído a partir do `react` **base**, e nunca é
  embrulhada duas vezes.

## `src/graph/production-graph.ts`

```ts
export type NodeName = "contexto" | "roteador" | Route | "resposta";
export type RouteEvent = { type: "route"; route: Route; reason: string; source: RouteSource };
export type GraphTraceEvent = (TraceEvent | RouteEvent) & { node: NodeName };

export function tagTrace(trace: readonly (TraceEvent | RouteEvent)[], node: NodeName): GraphTraceEvent[]; // pura

export interface ProductionGraphDeps {
  strategies: Partial<Record<Route, ReasoningStrategy>>;
  router?: Router;
  conversations: ConversationStore;
  summarizer?: Summarizer;
  budget?: ContextBudget;
}
export interface ProductionInput {
  message: string;
  conversationId?: string;
  facts: BudgetFact[];
  override?: Route;
}
export interface ProductionOutput {
  answer: string;
  trace: GraphTraceEvent[];
  llmCalls: number;
  latencyMs: number;
  built: BuiltContext;
  route: RouteDecision;
}

export function createProductionGraph(deps: ProductionGraphDeps): {
  invoke(input: ProductionInput): Promise<ProductionOutput>;
};
```

Nós:

| Nó | Faz | Eventos (`node`) |
|----|-----|------------------|
| `contexto` | `loadConversationContext` (se há `conversationId`) + `buildContext` | `summarize` → `contexto` |
| `roteador` | override, fallback ou `router({ prompt: built.prompt, routes })` validado | `route` → `roteador` |
| `react` / `plan-and-execute` / `reflection` | `strategy.run({ question: built.prompt })` | os da estratégia → nome do nó |
| `resposta` | consolida `ProductionOutput` | nenhum |

Aresta condicional `roteador → decision.route`. A estratégia não é chamada em
nenhum outro nó. Os erros das estratégias e o `ConversationNotFoundError`
propagam com a classe original.

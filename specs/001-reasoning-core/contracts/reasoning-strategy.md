# Contract: ReasoningStrategy

Contrato comum implementado por toda estratégia de raciocínio (FR-001 a FR-004).
Definido em `src/agents/strategy.ts`; consumido por `src/agents/react.ts`,
`src/agents/plan-and-execute.ts` e por `src/arena.ts`.

## Tipos

```ts
type TraceEvent =
  | { type: "thought"; content: string }
  | { type: "action"; tool: string; args: unknown }
  | { type: "observation"; content: string }
  | { type: "plan"; steps: string[] }
  | { type: "critique"; content: string }
  | { type: "answer"; content: string };

type Trace = readonly TraceEvent[];

type Metrics = {
  llmCalls: number;
  latencyMs: number;
};

type StrategyResult = {
  answer: string;
  trace: Trace;
  metrics: Metrics;
};

type StrategyInput = {
  question: string;
  maxIterations?: number; // default definido pela estratégia (research.md §5: 8)
};

interface ReasoningStrategy {
  readonly name: string;
  run(input: StrategyInput): Promise<StrategyResult>;
}
```

## Regras do contrato

- `run` NUNCA lança para fora do contrato por causa de uma falha de tool — falhas de
  tool viram um `TraceEvent` do tipo `observation` (edge case da spec) e a execução
  continua ou termina normalmente dentro do limite de iterações.
- `run` DEVE respeitar `input.maxIterations` (ou o default da estratégia) e parar ao
  atingir o limite mesmo sem produzir um evento `answer` — nesse caso, `StrategyResult.answer`
  contém uma mensagem indicando que o limite foi atingido, e o `trace` mostra todos os
  eventos até o corte (FR-013, edge case da spec).
- `trace` preserva a ordem cronológica de emissão dos eventos.
- `metrics.llmCalls` conta toda chamada ao modelo de linguagem feita durante a
  execução (inclui chamadas de planejamento/replanejamento — research.md §5).
- Implementações são registradas por `name` único, usado pela `arena` (ver
  [arena-cli.md](./arena-cli.md)) para seleção via `--strategies`.

## Estratégias que implementam este contrato

| `name` | Descrição | Requisito |
|--------|-----------|-----------|
| `react` | Agente ReAct pré-construído do LangGraph sobre as tools (tools.md) | FR-010 |
| `plan-and-execute` | Grafo planner → executor → replanner, teto de 8 passos | FR-011, FR-012 |

# Contract: withReflection

Decorador definido em `src/agents/reflection.ts` (FR-001 a FR-010). Consumido por
`src/arena.ts` para registrar `reflect:react` e `reflect:plan-and-execute`. Depende
apenas do contrato `ReasoningStrategy` já definido em
[../../001-reasoning-core/contracts/reasoning-strategy.md](../../001-reasoning-core/contracts/reasoning-strategy.md)
— não o modifica.

## Tipos

```ts
type CriticVerdict = {
  approved: boolean;
  feedback?: string; // presente quando approved é false
};

type Critic = (input: {
  question: string;
  answer: string;
  observations: string[]; // conteúdo dos TraceEvent do tipo "observation", em ordem
}) => Promise<CriticVerdict>;

type ReflectionOptions = {
  maxReflection?: number; // default 2 (research.md §3)
  critic?: Critic; // default: crítico baseado em createModel() (research.md §1)
};

function withReflection(
  strategy: ReasoningStrategy,
  opts?: ReflectionOptions,
): ReasoningStrategy;
```

## Regras do contrato

- O `name` da estratégia retornada é `reflect:<name da estratégia decorada>` (ex.:
  `reflect:react`), único e usado pela arena para seleção via `--strategies`, igual a
  qualquer outra `ReasoningStrategy` (ver
  [arena-cli.md](../../001-reasoning-core/contracts/arena-cli.md)).
- `run(input)` chama a estratégia decorada com o mesmo `StrategyInput` recebido
  (mesma pergunta na primeira geração); reexecuções subsequentes usam uma pergunta
  derivada que incorpora a resposta anterior e o feedback do crítico (research.md §2)
  — a estratégia decorada em si nunca é modificada nem precisa saber que está sendo
  refletida (FR-001).
- `run` NUNCA lança para fora do contrato: uma falha inesperada do crítico é tratada
  como o fim do ciclo de reflexão (retorna a última resposta válida gerada), nunca
  como uma exceção não tratada (research.md §4).
- O ciclo para na primeira ocorrência de: `verdict.approved === true`, ou o número de
  avaliações já realizadas atingir `opts.maxReflection` (padrão 2) — o que ocorrer
  primeiro (FR-005). Com `maxReflection = 0`, nenhuma avaliação ocorre.
- `trace` da execução resultante é a concatenação, em ordem cronológica, do `trace` de
  cada geração da estratégia de base com um evento `{ type: "critique", content }`
  after cada avaliação do crítico (FR-007).
- `metrics.llmCalls` soma o `llmCalls` de cada geração mais 1 por avaliação do crítico
  realizada; `metrics.latencyMs` cobre do início da primeira geração ao fim da última
  geração/avaliação (FR-008).
- Cada geração individual da estratégia de base continua sujeita ao próprio
  `maxIterations` dessa estratégia — `withReflection` não altera nem ignora esse
  limite (FR-010).

## Estratégias registradas na arena por este contrato

| `name` | Composição | Requisito |
|--------|------------|-----------|
| `reflect:react` | `withReflection(createReactStrategy(tools))` | FR-009 |
| `reflect:plan-and-execute` | `withReflection(createPlanAndExecuteStrategy(tools))` | FR-009 |

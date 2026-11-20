# Data Model: Camada de Reflexão sobre Estratégias de Raciocínio

Esta feature não introduz nenhuma entidade persistida (sem `models/`/`services/` — ver
plan.md, Constitution Check). As "entidades" aqui são tipos de valor, em memória,
usados durante uma única execução de `ReasoningStrategy.run()`.

## CriticVerdict (valor, não persistido)

O resultado de uma avaliação do crítico (FR-003).

| Campo | Tipo | Regras |
|-------|------|--------|
| `approved` | boolean, obrigatório | `true` encerra o ciclo de reflexão imediatamente |
| `feedback` | string, opcional | DEVE estar presente quando `approved` é `false` (é o que orienta a próxima geração — research.md §2); pode ser omitido quando `approved` é `true` |

## ReflectionOptions (valor de configuração)

Opções aceitas por `withReflection(strategy, opts)` (FR-005).

| Campo | Tipo | Regras |
|-------|------|--------|
| `maxReflection` | integer ≥ 0, opcional | Padrão 2 (research.md §3). `0` desativa a reflexão na prática (edge case da spec) |
| `critic` | função injetável, opcional | Quando omitida, usa o crítico padrão baseado em `createModel()`; usada pelos testes para substituir o LLM real por um dublê determinístico (research.md §1) |

## Rodada de Reflexão (conceito, não um tipo próprio)

Uma execução com reflexão é uma sequência de até `maxReflection + 1` gerações e até
`maxReflection` avaliações, intercaladas (research.md §3):

```text
gerar(1) → crítica(1) → [reprovado] → gerar(2) → crítica(2) → [reprovado] → gerar(3)
                                                                              (retornada,
                                                                          sem crítica(3))
```

Cada avaliação do crítico produz exatamente um evento `critique` no `Trace` da
execução — tipo que já existe no contrato `ReasoningStrategy` (ver
[reasoning-strategy.md](../../001-reasoning-core/contracts/reasoning-strategy.md)),
reaproveitado sem alterações:

```ts
{ type: "critique"; content: string }
```

## Métricas agregadas

`StrategyResult.metrics` de uma execução com reflexão (mesma forma já definida pelo
contrato `ReasoningStrategy` — nenhum campo novo):

- `llmCalls`: soma de `metrics.llmCalls` de cada geração (execução da estratégia de
  base) mais 1 por avaliação do crítico realizada (FR-008).
- `latencyMs`: tempo total decorrido entre o início da primeira geração e o fim da
  última avaliação (ou da última geração, quando o teto é atingido sem crítica final).

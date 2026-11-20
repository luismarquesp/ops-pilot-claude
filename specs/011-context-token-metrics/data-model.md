# Data Model: Medição de Contexto (Tokens)

Nada é persistido. Todas as estruturas vivem só durante o turno e saem na
resposta do `/chat`.

## TokenUsage (`src/context/tokens.ts`)

Uso informado pelo provedor em **uma** chamada ao modelo.

| Campo | Tipo | Regra |
|-------|------|-------|
| `inputTokens` | `number` | inteiro ≥ 0 |
| `outputTokens` | `number` | inteiro ≥ 0; 0 se o provedor não informar |
| `totalTokens` | `number` | inteiro ≥ 0; `input + output` se o provedor não informar |

Origem: `usageFromLLMResult(output)` → `TokenUsage | undefined`
(research.md §2). Valores não numéricos ou negativos → `undefined`.

## TurnUsage (`src/context/tokens.ts`)

Acumulado das chamadas de um turno: `readonly TokenUsage[]`.

- `promptTokensOf(calls)` → `number | null`: soma de `inputTokens`; `null`
  para lista vazia (research.md §5). Função pura.

## UsageScope (`src/context/usage-tracker.ts`)

Escopo por turno em `AsyncLocalStorage` (research.md §3).

- `trackUsage<T>(fn: () => Promise<T>)` → `Promise<{ value: T; usage: TokenUsage[] }>`
- `recordUsage(usage: TokenUsage)` — empurra no escopo atual; no-op fora dele.
- `usageCallbacks()` → `Callbacks | undefined` — handler (`_awaitHandler: true`)
  preso ao escopo atual; `undefined` fora dele. Consumido por `createModel()`.

Ciclo: abre em `runChat` em volta de `composed.run(...)`; fecha quando a
estratégia termina (ou falha). Turnos concorrentes têm escopos distintos.

## ContextBreakdown (`src/context/breakdown.ts`)

Estimativa por fonte do prompt montado pelo serviço de chat.

| Campo | Tipo | Valor |
|-------|------|-------|
| `question` | `number` | `estimateTokens(mensagem)` |
| `history` | `number` | `estimateTokens(formatQuestionWithHistory(history, ""))`, 0 sem histórico |
| `memory` | `number` | `estimateTokens(formatQuestionWithMemory(facts, ""))`, 0 sem fatos |
| `total` | `number` | `question + history + memory` |

Invariante: `total === question + history + memory`.

## ChatMetrics (`src/services/chat-service.ts`) — emenda

```ts
interface ChatMetrics extends Metrics {
  historyMessages: number;          // specs/007
  memoryFacts: number;              // specs/008
  promptTokens: number | null;      // novo — real, soma do turno
  contextBreakdown: ContextBreakdown; // novo — estimado
}
```

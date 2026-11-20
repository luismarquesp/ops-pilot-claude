# Contract: `src/context/context-builder.ts`

Módulo puro (sem I/O, sem `process.env`). Ver [data-model.md](../data-model.md).

```ts
export interface ContextBudget { summary: number; window: number; memory: number }
export const DEFAULT_CONTEXT_BUDGET: ContextBudget; // { summary: 200, window: 1200, memory: 300 }

export interface ContextInput {
  question: string;
  facts: readonly { fact: string; score: number }[];
  summary?: string;
  history: readonly HistoryMessage[];
}
export interface ContextTrimReport { historyMessages: number; memoryFacts: number; summaryTruncated: boolean }
export interface BuiltContext {
  prompt: string;
  facts: { fact: string; score: number }[];
  summary?: string;
  history: HistoryMessage[];
  trimmed: ContextTrimReport;
  breakdown: ContextBreakdown;
}

export function buildContext(input: ContextInput, budget?: ContextBudget): BuiltContext;

export function parseContextBudget(env: Readonly<Record<string, string | undefined>>):
  { budget: ContextBudget; invalid: string[] };
```

## Comportamento de `buildContext`

| Seção | Mede | Acima do teto |
|-------|------|---------------|
| memória | `formatQuestionWithMemory(facts, "")` | remove o fato de menor `score` (empate: o último), repete |
| resumo | `formatSummaryBlock(summary)` | maior prefixo que cabe, cortado na última `\n` se houver; vazio → some |
| janela | `formatQuestionWithHistory(history, "")` | remove a mensagem mais antiga, repete; pode ficar vazia |
| pergunta | — | nunca medida, nunca alterada |
| sistema / tools | — | fora do builder |

- Seções independentes: sobra de uma não vai para outra.
- Ordem do prompt: fatos → resumo → histórico → pergunta (specs/012).
- Determinística: mesma entrada + mesmo orçamento → mesma saída.

## Comportamento de `parseContextBudget`

| Valor de `CONTEXT_BUDGET_*` | Resultado |
|-----------------------------|-----------|
| ausente ou `""` | padrão, não listado em `invalid` |
| inteiro ≥ 0 (`"0"`, `"500"`) | usado |
| `"abc"`, `"-1"`, `"1.5"` | padrão, nome da variável em `invalid` |

`src/index.ts` loga `invalid` (só nomes) e passa `budget` para `createApp`.

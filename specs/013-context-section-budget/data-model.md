# Data Model: Orçamento de Contexto por Seção

Nada persistido: todas as entidades são valores em memória de um turno. Sem
mudança de schema SQLite.

## ContextBudget

Tetos por seção, em tokens estimados (`ceil(chars/4)`) do bloco inteiro.

| Campo | Tipo | Padrão | Env |
|-------|------|--------|-----|
| `summary` | inteiro ≥ 0 | 200 | `CONTEXT_BUDGET_SUMMARY` |
| `window` | inteiro ≥ 0 | 1200 | `CONTEXT_BUDGET_WINDOW` |
| `memory` | inteiro ≥ 0 | 300 | `CONTEXT_BUDGET_MEMORY` |

Validação (zod, research.md §6): ausente/vazio → padrão; não inteiro,
negativo ou não numérico → padrão + chave listada em `invalid`. `0` é válido e
desliga a seção.

## ContextInput (entrada do builder)

| Campo | Tipo | Origem |
|-------|------|--------|
| `question` | string | mensagem do usuário — nunca cortada nem medida contra teto |
| `facts` | `{ fact: string; score: number }[]` | `MemoryStore.recall` (specs/008), ordem por relevância desc |
| `summary` | string \| undefined | `loadConversationContext` (specs/012) |
| `history` | `HistoryMessage[]` | `loadConversationContext`, mais antiga primeiro |

## ContextTrimReport

| Campo | Tipo | Significado |
|-------|------|-------------|
| `historyMessages` | inteiro ≥ 0 | mensagens removidas da janela (as mais antigas) |
| `memoryFacts` | inteiro ≥ 0 | fatos removidos (menor `score` primeiro) |
| `summaryTruncated` | boolean | o resumo foi encurtado ou removido |

## BuiltContext (saída do builder)

| Campo | Tipo | Regra |
|-------|------|-------|
| `prompt` | string | `formatQuestionWithMemory(facts', formatQuestionWithHistory(history', question, summary'))` — idêntico ao de hoje sem cortes (FR-009) |
| `facts` | `{ fact; score }[]` | mantidos, ordem recebida |
| `summary` | string \| undefined | mantido (talvez encurtado); `undefined` se vazio |
| `history` | `HistoryMessage[]` | sufixo mantido, ordem original |
| `trimmed` | `ContextTrimReport` | |
| `breakdown` | `ContextBreakdown` (specs/011/012) | calculado sobre o mantido |

Invariantes (testadas):

- `breakdown.memory ≤ budget.memory`, `breakdown.summary ≤ budget.summary`,
  `breakdown.history ≤ budget.window`.
- `prompt` termina com `question` inalterada.
- `history` é sufixo da entrada; `facts` é subsequência da entrada.
- `trimmed.historyMessages = entrada.history.length − history.length` (idem fatos).
- Sem cortes → `trimmed` zerado e `prompt` igual à composição anterior.

## ChatMetrics (emenda)

`contextTrimmed: ContextTrimReport` **novo**. `historyMessages`,
`memoryFacts` e `contextBreakdown` passam a refletir `BuiltContext` (após os
cortes).

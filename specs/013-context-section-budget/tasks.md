---

description: "Task list for 013-context-section-budget"
---

# Tasks: Orçamento de Contexto por Seção (ContextBuilder)

**Input**: Design documents from `specs/013-context-section-budget/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: pedidos explicitamente ("Teste: tetos baixos cortam na ordem certa", FR-012, constituição Princípio II). Todos rodam com `node:test` via `tsx`, sem rede. Teste primeiro, vê-lo falhar, depois implementar.

**Organization**: US1 = builder com cortes por seção usado por todas as estratégias; US2 = tetos via `CONTEXT_BUDGET_*`; US3 = `metrics.contextTrimmed`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência pendente)
- **[Story]**: US1, US2, US3

## Path Conventions

Projeto único: `src/`, testes `*.test.ts` ao lado do código. Estilo: tabs, ESM com imports `.js`, JSDoc curto em português citando `specs/013` e a seção do research.

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Conferir que `npm run typecheck` e `npm test` estão verdes antes de começar (baseline; nenhuma dependência nova, `package.json` intocado)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: tipos e orçamento padrão de que todas as stories dependem ([contracts/context-builder.md](./contracts/context-builder.md)).

- [X] T002 Criar `src/context/context-builder.ts` só com os tipos e constantes: `interface ContextBudget { summary: number; window: number; memory: number }`, `const DEFAULT_CONTEXT_BUDGET: ContextBudget = { summary: 200, window: 1200, memory: 300 }`, `type BudgetFact = { fact: string; score: number }`, `interface ContextInput { question: string; facts: readonly BudgetFact[]; summary?: string; history: readonly HistoryMessage[] }` (`HistoryMessage` de `../agents/history.js`), `interface ContextTrimReport { historyMessages: number; memoryFacts: number; summaryTruncated: boolean }` e `interface BuiltContext { prompt: string; facts: BudgetFact[]; summary?: string; history: HistoryMessage[]; trimmed: ContextTrimReport; breakdown: ContextBreakdown }` (`ContextBreakdown` de `./breakdown.js`), com JSDoc citando specs/013 e [data-model.md](./data-model.md)

**Checkpoint**: tipos compilam (`npm run typecheck`).

---

## Phase 3: User Story 1 - Contexto de tamanho previsível em qualquer estratégia (Priority: P1) 🎯 MVP

**Goal**: `buildContext` monta fatos → resumo → histórico → pergunta com teto por seção (research.md §1–§5) e `runChat` passa a usá-lo para qualquer estratégia.

**Independent Test**: com tetos baixos e entrada que os excede, `buildContext` corta as mensagens mais antigas, os fatos de menor `score` e o fim do resumo; a pergunta sai intacta; abaixo dos tetos o prompt é igual à composição antiga.

### Tests for User Story 1 ⚠️

> Escrever primeiro e garantir que FALHAM antes da implementação.

- [X] T003 [US1] Criar `src/context/context-builder.test.ts` com os casos de `buildContext` (depende de T002):
  (a) **sem cortes**: com `DEFAULT_CONTEXT_BUDGET` e entrada pequena, `prompt === formatQuestionWithMemory(facts, formatQuestionWithHistory(history, question, summary))`, `trimmed` = `{ historyMessages: 0, memoryFacts: 0, summaryTruncated: false }` e `facts`/`history`/`summary` iguais à entrada; sem fatos, sem resumo e sem histórico → `prompt === question`;
  (b) **janela**: 6 mensagens distintas, `window` calculado para caber exatamente as 3 últimas (`estimateTokens(formatQuestionWithHistory(ultimas3, ""))`) → `history` deepEqual às 3 últimas na ordem original, `trimmed.historyMessages === 3`, `breakdown.history <= window`, e o `prompt` não contém o texto das 3 mais antigas;
  (c) **janela vazia**: a mensagem mais recente sozinha excede `window` → `history` vazio, sem o cabeçalho `Histórico recente` no `prompt`;
  (d) **memória por score, não por posição**: fatos `[{fact:"A",score:0.9},{fact:"B",score:0.4},{fact:"C",score:0.7}]` com `memory` que cabe só dois → sobram `A` e `C` nessa ordem, `trimmed.memoryFacts === 1`; com teto que cabe só um → sobra `A`;
  (e) **desempate**: dois fatos com o mesmo `score` na fronteira → sai o que vem por último na entrada;
  (f) **resumo**: resumo `"- linha 1\n- linha 2\n- linha 3"` com `summary` que cabe o bloco só até a segunda linha → `summary === "- linha 1\n- linha 2"`, `trimmed.summaryTruncated === true`, `breakdown.summary <= summary`; resumo de uma linha só, longo → corte seco em caractere, ainda dentro do teto; teto que não cabe nem o cabeçalho → `summary` `undefined`, sem `Resumo da conversa` no `prompt`;
  (g) **pergunta intocável**: pergunta de 10 000 caracteres com os três tetos em 0 e fatos/resumo/histórico presentes → `prompt === question`;
  (h) **independência**: só `window` baixo → fatos e resumo intactos (`trimmed.memoryFacts === 0`, `summaryTruncated === false`);
  (i) **ordem e invariantes**: com cortes nas três seções, o `prompt` é `formatQuestionWithMemory(kept.facts, formatQuestionWithHistory(kept.history, question, kept.summary))` e `breakdown` deepEqual `contextBreakdown(question, kept.history, kept.facts, kept.summary)`;
  (j) **determinismo**: duas chamadas com a mesma entrada → deepEqual
- [X] T004 [P] [US1] Em `src/services/chat-service.test.ts`, acrescentar (com o `spyStrategy` existente): (a) com `budget: { summary: 200, window: <cabe 2 mensagens>, memory: 300 }` em `ChatDeps`, depois de 3 turnos na mesma conversa a `question` recebida pela estratégia no 4º turno contém só as 2 mensagens mais recentes e termina com a pergunta atual; (b) o mesmo corte vale com a estratégia envolvida por `withReflection` (a `question` do retry também é a orçada); (c) sem `budget` nas deps, a `question` é idêntica à de antes da feature (usar `formatQuestionWithMemory`/`formatQuestionWithHistory` para o esperado)

### Implementation for User Story 1

- [X] T005 [US1] Implementar `buildContext(input: ContextInput, budget: ContextBudget = DEFAULT_CONTEXT_BUDGET): BuiltContext` em `src/context/context-builder.ts` como função pura, com helpers puros não exportados (depende de T003):
  `fitFacts` — enquanto `estimateTokens(formatQuestionWithMemory(kept, "")) > budget.memory`, remove o índice de menor `score` (empate: maior índice); `fitSummary` — se `estimateTokens(formatSummaryBlock(s)) <= budget.summary` devolve `s`; senão `max = budget.summary * 4 - (formatSummaryBlock(s).length - s.length)`, prefixo `s.slice(0, max)`, corta na última `"\n"` se houver, `trimEnd()`, vazio → `undefined`; `fitHistory` — maior sufixo cujo `estimateTokens(formatQuestionWithHistory(sufixo, ""))` cabe em `budget.window`;
  `prompt = formatQuestionWithMemory(facts, formatQuestionWithHistory(history, question, summary))`, `breakdown = contextBreakdown(question, history, facts, summary)`, `trimmed` pelas diferenças de tamanho e `summaryTruncated = summary !== input.summary` (com `input.summary` presente). JSDoc citando research.md §2–§5
- [X] T006 [US1] Em `src/services/chat-service.ts`: acrescentar `budget?: ContextBudget` a `ChatDeps` (JSDoc: default `DEFAULT_CONTEXT_BUDGET`, specs/013); dentro do `trackUsage`, depois de `loadConversationContext`, chamar `buildContext({ question: input.message, facts, summary: context.summary, history: context.recent }, deps.budget)` e rodar `strategy.run({ question: built.prompt })` no lugar de `withHistory(withMemory(...))`; `historyMessages = built.history.length`, `memoryFacts = built.facts.length`, `contextBreakdown = built.breakdown`; remover imports de `withHistory`, `withMemory` e `contextBreakdown`; atualizar o JSDoc de `runChat` (depende de T004, T005)
- [X] T007 [P] [US1] Remover o decorador `withHistory` de `src/agents/history.ts` (os formatadores `formatQuestionWithHistory`, `formatSummaryBlock`, `formatTranscript` e `planHistory` ficam) e seus testes em `src/agents/history.test.ts` (os que chamam `withHistory`, linhas ~49–63 e ~113–116), ajustando o import; atualizar o JSDoc de `formatQuestionWithHistory` para citar o `buildContext` (depende de T006)
- [X] T008 [P] [US1] Remover o decorador `withMemory` de `src/memory/memory-prompt.ts` (fica `formatQuestionWithMemory` e `PromptFact`) e o teste `withMemory preserva o nome...` em `src/memory/memory-prompt.test.ts`, ajustando o import; atualizar o JSDoc do formatador para citar o `buildContext` (depende de T006)
- [X] T009 [P] [US1] Em `src/context/breakdown.test.ts`, renomear o teste "os blocos estimados particionam exatamente o prompt montado por withHistory(withMemory(...))" para citar `buildContext` e ajustar o comentário (a asserção sobre os formatadores continua válida) (depende de T006)

**Checkpoint**: `npm test` verde; `runChat` corta por seção com o orçamento padrão para todas as estratégias.

---

## Phase 4: User Story 2 - Ajustar os tetos sem mudar código (Priority: P2)

**Goal**: tetos lidos de `CONTEXT_BUDGET_SUMMARY|WINDOW|MEMORY` na subida, validados com zod, com fallback ao padrão (research.md §6).

**Independent Test**: `parseContextBudget` com valores válidos/ausentes/vazios/inválidos devolve o orçamento e a lista de chaves inválidas esperados.

### Tests for User Story 2 ⚠️

- [X] T010 [US2] Acrescentar a `src/context/context-builder.test.ts` os casos de `parseContextBudget`: (a) `{}` → `{ budget: DEFAULT_CONTEXT_BUDGET, invalid: [] }`; (b) `{ CONTEXT_BUDGET_WINDOW: "500" }` → `window: 500`, demais padrão; (c) `"0"` é aceito; (d) `""` → padrão sem entrar em `invalid`; (e) `"abc"`, `"-1"`, `"1.5"` → padrão e o nome da variável em `invalid` (ordem summary, window, memory); (f) chaves alheias no env são ignoradas (depende de T005)

### Implementation for User Story 2

- [X] T011 [US2] Implementar `parseContextBudget(env: Readonly<Record<string, string | undefined>>): { budget: ContextBudget; invalid: string[] }` em `src/context/context-builder.ts`, puro, com `const budgetValueSchema = z.coerce.number().int().min(0)` e um mapa `{ summary: "CONTEXT_BUDGET_SUMMARY", window: "CONTEXT_BUDGET_WINDOW", memory: "CONTEXT_BUDGET_MEMORY" }`; ausente ou `trim() === ""` → padrão; `safeParse` falho → padrão + nome em `invalid` (depende de T010)
- [X] T012 [US2] Em `src/http/server.ts`: acrescentar `contextBudget?: ContextBudget` a `AppDeps` (JSDoc: specs/013, ausente → padrão) e repassá-lo como `budget` na chamada a `runChat` (depende de T006)
- [X] T013 [US2] Em `src/index.ts`: `const { budget: contextBudget, invalid } = parseContextBudget(process.env)`; se `invalid.length > 0`, `console.warn` com só os nomes das variáveis e a menção de que o padrão foi usado; passar `contextBudget` para `createApp` (depende de T011, T012)
- [X] T014 [P] [US2] Em `.env.example`: acrescentar `CONTEXT_BUDGET_SUMMARY=`, `CONTEXT_BUDGET_WINDOW=` e `CONTEXT_BUDGET_MEMORY=` sem valores (comentário curto com os padrões 200/1200/300)

**Checkpoint**: subir com `CONTEXT_BUDGET_WINDOW=abc npm run dev` loga a variável e sobe com 1200.

---

## Phase 5: User Story 3 - Ver o que foi cortado (Priority: P3)

**Goal**: `metrics.contextTrimmed` em toda resposta do chat ([contracts/chat-api.md](./contracts/chat-api.md), research.md §7).

**Independent Test**: num turno com cortes, `metrics.contextTrimmed` informa as contagens e `historyMessages`/`memoryFacts`/`contextBreakdown` refletem o conteúdo mantido; sem cortes vem zerado.

### Tests for User Story 3 ⚠️

- [X] T015 [US3] Em `src/services/chat-service.test.ts`: (a) acrescentar `contextTrimmed: { historyMessages: 0, memoryFacts: 0, summaryTruncated: false }` a todas as asserções `deepEqual` de `metrics` existentes (ex.: o primeiro teste); (b) novo teste com `budget` baixo para janela e memória (usando `memoryWith` com 3 fatos) e resumo via `createFakeSummarizer` → `metrics.contextTrimmed` com as contagens esperadas, `historyMessages`/`memoryFacts` iguais ao mantido e `contextBreakdown.history <= budget.window`, `.memory <= budget.memory`, `.summary <= budget.summary` (depende de T006)
- [X] T016 [P] [US3] Em `src/http/server.test.ts`: um teste de `POST /chat` com `contextBudget` baixo em `AppDeps` que verifica `metrics.contextTrimmed` presente na resposta HTTP com `historyMessages > 0` após turnos na mesma conversa (depende de T012)

### Implementation for User Story 3

- [X] T017 [US3] Em `src/services/chat-service.ts`: acrescentar `contextTrimmed: ContextTrimReport` a `ChatMetrics` (JSDoc: removidos pelo orçamento, specs/013 FR-011) e preenchê-lo com `built.trimmed` (depende de T015)

**Checkpoint**: todas as stories funcionam; `npm test` verde.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T018 [P] Atualizar `AGENTS.md`: nova seção "Orçamento de contexto" (specs/013 — `buildContext` em `src/context/context-builder.ts` monta o prompt de todas as estratégias; tetos resumo 200 / janela 1200 / memória 300 em tokens estimados do bloco; regras de corte; `CONTEXT_BUDGET_*` via `parseContextBudget`; `metrics.contextTrimmed`); em "Conversa persistente" e "Memória semântica", trocar as menções a `withHistory`/`withMemory` pelo `buildContext`
- [X] T019 [P] Atualizar `scripts/conversa-long.sh` para imprimir uma coluna `cortes` com `contextTrimmed.historyMessages` por turno (`n/d` se ausente), mantendo as colunas existentes
- [X] T020 Rodar `npm run typecheck` e `npm test` e confirmar verde; percorrer o roteiro manual de [quickstart.md](./quickstart.md) §2 se houver `.env` configurado (sem ler o arquivo)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001)** → **Foundational (T002)** → **US1 (T003–T009)** → **US2 (T010–T014)** e **US3 (T015–T017)** → **Polish (T018–T020)**
- US2 e US3 dependem de T006 (o `runChat` com builder); são independentes entre si — T012 (server) e T017 (chat-service) tocam arquivos diferentes.

### Within Each User Story

- Testes antes da implementação, falhando primeiro.
- `buildContext` (T005) antes de `runChat` (T006); remoções dos decoradores (T007–T009) só depois de `runChat` não usá-los.

### Parallel Opportunities

- T004 em paralelo com T003 (arquivos diferentes).
- T007, T008, T009 em paralelo após T006.
- T014 em qualquer momento; T016 em paralelo com T015.
- T018 e T019 em paralelo.

## Parallel Example: User Story 1

```text
# Depois de T006:
Task: "T007 Remover withHistory de src/agents/history.ts e seus testes"
Task: "T008 Remover withMemory de src/memory/memory-prompt.ts e seu teste"
Task: "T009 Renomear o teste de partição em src/context/breakdown.test.ts"
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. T001–T002
2. T003–T009 → validar: tetos padrão cortam por seção em todas as estratégias, prompt idêntico abaixo dos tetos
3. **STOP and VALIDATE**: `npm test` verde

### Incremental Delivery

1. US1 → orçamento fixo nos padrões
2. US2 → tetos ajustáveis por ambiente
3. US3 → observabilidade dos cortes
4. Polish → documentação e script

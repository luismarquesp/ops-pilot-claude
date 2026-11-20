---

description: "Task list for 011-context-token-metrics"
---

# Tasks: Medição de Contexto (Tokens)

**Input**: Design documents from `specs/011-context-token-metrics/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/chat-api.md](./contracts/chat-api.md), [quickstart.md](./quickstart.md)

**Tests**: pedidos explicitamente ("Com testes", FR-011, constituição Princípio II). Todos rodam com `node:test` via `tsx`, sem rede nem modelo real. Teste primeiro, vê-lo falhar, depois implementar.

**Organization**: por user story (US1 = `promptTokens` real, US2 = `contextBreakdown`, US3 = `conversa-long.sh`).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência pendente)
- **[Story]**: US1, US2, US3

## Path Conventions

Projeto único: `src/` na raiz, testes `*.test.ts` ao lado do código; script em `scripts/`. Estilo do código: tabs, ESM com imports `.js`, comentários JSDoc curtos em português citando `specs/011` e a seção do research.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: diretórios novos

- [X] T001 Criar os diretórios `src/context/` e `scripts/` na raiz do repositório (vazios; nenhum arquivo de config muda — `npm test` já pega `src/**/*.test.ts`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: `estimateTokens` é usado por US2 e pela coluna "estimado" da US3; `ChatMetrics` ganha os dois campos de uma vez para não quebrar o tipo duas vezes.

- [X] T002 [P] Escrever testes de `estimateTokens` em `src/context/tokens.test.ts`: `""` → 0; `"a"`, `"abcd"` → 1; `"abcde"` → 2; texto de 400 chars → 100; texto com acentos usa `String.length` (ex.: `"ação"` → 1); mesma entrada repetida → mesmo resultado (research.md §1)
- [X] T003 Implementar `export function estimateTokens(text: string): number` (`Math.ceil(text.length / 4)`) em `src/context/tokens.ts`, função pura com JSDoc citando specs/011 research.md §1 (depende de T002)

**Checkpoint**: `npm test -- src/context/tokens.test.ts` verde.

---

## Phase 3: User Story 1 - Ver quanto contexto um turno realmente consumiu (Priority: P1) 🎯 MVP

**Goal**: `metrics.promptTokens` no `/chat` = soma dos tokens de entrada reais de todas as chamadas ao modelo do turno; `null` sem uso.

**Independent Test**: estratégia falsa que registra uso conhecido (via `recordUsage`) → `runChat` devolve `promptTokens` igual à soma; sem registro → `null`.

### Tests for User Story 1 ⚠️

- [X] T004 [P] [US1] Acrescentar a `src/context/tokens.test.ts` testes de `usageFromLLMResult` (research.md §2) usando objetos literais no formato `LLMResult`: (a) `generations[0][0].message.usage_metadata = { input_tokens: 10, output_tokens: 5, total_tokens: 15 }` → `{ inputTokens: 10, outputTokens: 5, totalTokens: 15 }`; (b) só `llmOutput.tokenUsage = { promptTokens: 7, completionTokens: 3, totalTokens: 10 }` → `{ 7, 3, 10 }`; (c) ambos presentes com valores diferentes → usa só `usage_metadata` (não soma); (d) nenhum → `undefined`; (e) `generations: []`, `message` ausente, `input_tokens: "x"` ou negativo → `undefined`; (f) `output`/`total` ausentes → `outputTokens: 0`, `totalTokens = input + output`. E testes de `promptTokensOf`: `[]` → `null`; `[{input 10}, {input 32}]` → 42
- [X] T005 [P] [US1] Criar `src/context/usage-tracker.test.ts` (research.md §3–§5): (a) `trackUsage` com `recordUsage` chamado 2× dentro → `usage` com as 2 entradas e `value` = retorno de `fn`; (b) `recordUsage` fora de `trackUsage` não lança e não vaza para um escopo aberto depois; (c) dois `trackUsage` concorrentes (`Promise.all`, com `await` intercalado via `setTimeout`) não misturam entradas; (d) `usageCallbacks()` fora de escopo → `undefined`; (e) dentro de escopo, o handler devolvido tem `awaitHandlers === true` e `await handler.handleLLMEnd(fakeLLMResult, runId)` registra o uso no escopo em que `usageCallbacks()` foi chamado, mesmo se invocado depois que o escopo fechou ou de dentro de outro escopo; (f) `handleLLMEnd` com resultado sem uso ou malformado não lança e não registra nada; (g) `fn` que rejeita → `trackUsage` rejeita com o mesmo erro
- [X] T006 [P] [US1] Em `src/services/chat-service.test.ts`: (a) atualizar o `deepEqual` da linha ~23 para incluir `promptTokens: null` (o `fakeStrategy` não registra uso) e `contextBreakdown` (pode-se comparar só `promptTokens` aqui e deixar o breakdown para a US2 usando `assert.equal`/destructuring — escolha que mantenha o teste estável); (b) novo teste: estratégia falsa cujo `run` chama `recordUsage({ inputTokens: 100, outputTokens: 10, totalTokens: 110 })` e depois `recordUsage({ inputTokens: 250, ... })` (simulando 2 chamadas, com um `await` entre elas) → `metrics.promptTokens === 350`; (c) mesmo com `withReflection` por fora (crítico falso que chama `recordUsage({ inputTokens: 40, ... })`) → soma inclui o crítico; (d) `learn` que chama `recordUsage` não altera `promptTokens` do turno; (e) dois `runChat` concorrentes com estratégias que registram 1 e 1000 → cada um vê só o seu
- [X] T007 [P] [US1] Em `src/http/server.test.ts`: teste de `POST /chat` 200 em que a estratégia falsa chama `recordUsage({ inputTokens: 42, outputTokens: 1, totalTokens: 43 })` → corpo traz `metrics.promptTokens === 42`; e outro sem registro → `metrics.promptTokens === null` (campo presente no JSON, `"promptTokens" in body.metrics`)

### Implementation for User Story 1

- [X] T008 [US1] Em `src/context/tokens.ts`: exportar `interface TokenUsage { inputTokens: number; outputTokens: number; totalTokens: number }`, `usageFromLLMResult(output: unknown): TokenUsage | undefined` (leitura defensiva sem `any`, ordem `usage_metadata` → `llmOutput.tokenUsage`, rejeita não-inteiros/negativos; tipar o parâmetro como `unknown` ou `Pick<LLMResult, ...>` de `@langchain/core/outputs`) e `promptTokensOf(calls: readonly TokenUsage[]): number | null` — todas puras (depende de T004)
- [X] T009 [US1] Criar `src/context/usage-tracker.ts`: `AsyncLocalStorage<TokenUsage[]>` de `node:async_hooks`; `trackUsage<T>(fn: () => Promise<T>): Promise<{ value: T; usage: TokenUsage[] }>`; `recordUsage(usage: TokenUsage): void` (no-op fora de escopo); classe `UsageCallbackHandler extends BaseCallbackHandler` (`@langchain/core/callbacks/base`) com `name = "opspilot_usage"`, construtor recebendo o array do escopo e chamando `super({ _awaitHandler: true })`, e `handleLLMEnd(output)` que faz `usageFromLLMResult` dentro de `try/catch` e empurra no array capturado (nunca lança); `usageCallbacks(): UsageCallbackHandler[] | undefined` que captura o escopo **no momento da chamada** (research.md §3–§4). JSDoc explicando por que o escopo é capturado na criação (depende de T005, T008)
- [X] T010 [US1] Em `src/agents/model.ts`: passar `callbacks: usageCallbacks()` ao `new ChatOpenAI({...})`; atualizar o JSDoc de `createModel` dizendo que, dentro de `trackUsage`, as chamadas desse modelo são contadas (specs/011) e que modelos criados fora de `run()` não são (depende de T009)
- [X] T011 [US1] Em `src/services/chat-service.ts`: importar `trackUsage` e `promptTokensOf`; trocar `runWithTimeout(composed.run(...), timeoutMs)` por `runWithTimeout(trackUsage(() => composed.run({ question: input.message })), timeoutMs)` e desestruturar `{ value: result, usage }`; acrescentar `promptTokens: number | null` a `ChatMetrics` (JSDoc: real, soma do turno, `null` sem uso — specs/011 FR-004) e `promptTokens: promptTokensOf(usage)` nas métricas devolvidas; o escopo fecha antes de `conversations.append` e do `learn` (research.md §3). Atualizar o JSDoc de `runChat` (depende de T009)

**Checkpoint**: `npm run typecheck && npm test` verdes; US1 entregável sozinha (quickstart §2 mostra `promptTokens`).

---

## Phase 4: User Story 2 - Entender de onde vem o contexto (Priority: P2)

**Goal**: `metrics.contextBreakdown = { question, history, memory, total }` estimado sobre o texto exato que cada fonte acrescenta.

**Independent Test**: turno com histórico e fatos conhecidos → cada fatia bate com `estimateTokens` do prefixo correspondente e `total` = soma.

### Tests for User Story 2 ⚠️

- [X] T012 [P] [US2] Criar `src/context/breakdown.test.ts` (research.md §6): (a) sem histórico e sem fatos → `{ question: estimateTokens(q), history: 0, memory: 0, total: estimateTokens(q) }`; (b) com 2 mensagens de histórico e 1 fato → `history === estimateTokens(formatQuestionWithHistory(h, ""))`, `memory === estimateTokens(formatQuestionWithMemory(f, ""))`, `total === question + history + memory`; (c) partição exata: `formatQuestionWithHistory(h, "") + formatQuestionWithMemory(f, "") + q === formatQuestionWithHistory(h, formatQuestionWithMemory(f, q))` (garante que as fatias cobrem o prompt montado sem sobreposição); (d) determinismo: duas chamadas → `deepEqual`
- [X] T013 [P] [US2] Em `src/services/chat-service.test.ts`: (a) conversa com histórico gravado + `userId` com fatos (reaproveitar o setup do teste "monta fatos → histórico → pergunta") → `metrics.contextBreakdown` igual a `contextBreakdown(message, history, facts)` e `total` = soma; (b) turno sem histórico e sem `userId` → `history: 0`, `memory: 0`; (c) completar o `deepEqual` da linha ~23 com o `contextBreakdown` esperado se T006 o deixou de fora
- [X] T014 [P] [US2] Em `src/http/server.test.ts`: `POST /chat` 200 traz `metrics.contextBreakdown` com as quatro chaves numéricas e `total === question + history + memory`

### Implementation for User Story 2

- [X] T015 [US2] Criar `src/context/breakdown.ts`: `export interface ContextBreakdown { question: number; history: number; memory: number; total: number }` e função pura `contextBreakdown(question: string, history: readonly HistoryMessage[], facts: readonly PromptFact[]): ContextBreakdown` reaproveitando `formatQuestionWithHistory` (`src/agents/history.ts`) e `formatQuestionWithMemory` (`src/memory/memory-prompt.ts`) com pergunta `""` e `estimateTokens`; JSDoc explicando a partição e que instruções de sistema/tools ficam de fora (depende de T003, T012)
- [X] T016 [US2] Em `src/services/chat-service.ts`: acrescentar `contextBreakdown: ContextBreakdown` a `ChatMetrics` (JSDoc: estimado, specs/011 FR-005) e calculá-lo com `contextBreakdown(input.message, history, facts)` antes de rodar a estratégia; incluir nas métricas devolvidas (depende de T011, T015)

**Checkpoint**: `npm run typecheck && npm test` verdes; resposta do `/chat` igual ao exemplo de [contracts/chat-api.md](./contracts/chat-api.md).

---

## Phase 5: User Story 3 - Acompanhar o crescimento numa conversa longa (Priority: P3)

**Goal**: `scripts/conversa-long.sh` conduz N turnos na mesma conversa e imprime `promptTokens` por turno.

**Independent Test**: API rodando → script imprime cabeçalho + N linhas com o mesmo `conversationId`; API fora → stderr + exit 1 (quickstart §3–§4). Validação manual: o script exige modelo real e fica fora de `npm test`.

### Implementation for User Story 3

- [X] T017 [US3] Criar `scripts/conversa-long.sh` conforme [contracts/chat-api.md](./contracts/chat-api.md#contract-scriptsconversa-longsh) e research.md §7: `#!/usr/bin/env bash`, `set -euo pipefail`; `OPSPILOT_URL` (default `http://localhost:3000`), `TURNS` (default 15), `USER_ID` opcional; array fixo de ~8 perguntas de plantão em português (alertas, incidentes, runbook, "e o anterior?") ciclando com `% ${#PERGUNTAS[@]}`; montar o corpo JSON e ler a resposta com `node -e` (escapando a mensagem com `JSON.stringify`, sem `jq`); `curl -sS -X POST -H 'content-type: application/json' -w '\n%{http_code}'`; `curl` falhando → `echo "erro: API indisponível em $OPSPILOT_URL" >&2; exit 1`; status ≠ 200 → stderr com status e corpo, `exit 1`; primeiro turno sem `conversationId`, os seguintes com o id devolvido; imprimir `conversa <id>` e depois linhas alinhadas com `printf '%-6s %-13s %-10s %s\n'` para `turno promptTokens historico estimado`, `promptTokens` nulo → `n/d`. Comentário no topo com uso e pré-requisitos (API via `npm run dev`)
- [X] T018 [US3] Marcar `scripts/conversa-long.sh` como executável no git (`git update-index --chmod=+x scripts/conversa-long.sh` após `git add`, ou documentar `bash scripts/conversa-long.sh` no AGENTS.md já que o repo está em Windows) e rodar `bash -n scripts/conversa-long.sh` para checar sintaxe (depende de T017)

**Checkpoint**: quickstart §4 (`OPSPILOT_URL=http://localhost:9`) devolve exit 1 sem precisar de modelo; §3 validado manualmente com `.env` configurado.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T019 [P] Atualizar `AGENTS.md` com seção "Medição de contexto" (specs/011): `src/context/tokens.ts` (`estimateTokens` = `ceil(chars/4)`, `usageFromLLMResult`, `promptTokensOf`), `src/context/usage-tracker.ts` (`trackUsage` por turno via `AsyncLocalStorage`, `createModel` anexa o callback só dentro do escopo; modelos criados fora de `run()` não contam), `src/context/breakdown.ts`; métricas novas do `/chat` (`promptTokens` real ou `null`, `contextBreakdown` estimado só sobre pergunta/histórico/memória); refletor de aprendizado fora da contagem; `bash scripts/conversa-long.sh` com `OPSPILOT_URL`/`TURNS`/`USER_ID`
- [X] T020 Rodar `npm run typecheck` e `npm test` e corrigir o que quebrar (inclusive testes antigos de `chat-service`/`server` que comparam `metrics` inteiro)
- [X] T021 Rodar o quickstart §4 (falha controlada do script) e, se houver `.env` configurado (sem lê-lo), §2–§3; registrar no relatório final se `promptTokens` veio preenchido ou `null` com o modelo do OpenRouter

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001)** → **Foundational (T002–T003)** → US1 / US2 / US3
- **US1 (T004–T011)**: depende de Foundational (T008 estende `tokens.ts`)
- **US2 (T012–T016)**: depende de T003; T016 depende de T011 (mesmo bloco de métricas em `chat-service.ts`)
- **US3 (T017–T018)**: em código, independe; para ver números na saída precisa de US1 (e US2 para a coluna "estimado" — sem ela, o script imprime `n/d`)
- **Polish (T019–T021)**: depois das stories desejadas

### Within Each User Story

- Testes primeiro, falhando → implementação
- `tokens.ts` → `usage-tracker.ts` → `model.ts` / `chat-service.ts`

### Parallel Opportunities

- T002 isolado na Phase 2
- US1: T004, T005, T006, T007 em paralelo (arquivos diferentes; T004 só toca `tokens.test.ts`)
- US2: T012, T013, T014 em paralelo; T015 pode começar junto com a US1 (só depende de T003)
- US3: T017 pode ser escrito em paralelo com US1/US2
- T019 em paralelo com T020

---

## Parallel Example: User Story 1

```bash
Task: "T004 testes de usageFromLLMResult/promptTokensOf em src/context/tokens.test.ts"
Task: "T005 testes de trackUsage/recordUsage/usageCallbacks em src/context/usage-tracker.test.ts"
Task: "T006 testes de promptTokens em src/services/chat-service.test.ts"
Task: "T007 teste de promptTokens no /chat em src/http/server.test.ts"
```

## Parallel Example: User Story 2

```bash
Task: "T012 testes de contextBreakdown em src/context/breakdown.test.ts"
Task: "T013 testes de contextBreakdown no runChat em src/services/chat-service.test.ts"
Task: "T014 teste de contextBreakdown no /chat em src/http/server.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. T001 → T002–T003
2. T004–T011
3. **Parar e validar**: `npm run typecheck && npm test`; um `curl` no `/chat` mostra `promptTokens`

### Incremental Delivery

1. MVP (US1) → número real por turno
2. US2 → explica de onde vem o número
3. US3 → curva de crescimento numa conversa longa
4. Polish → AGENTS.md e verificação final

---

## Notes

- Nenhuma dependência nova no `package.json`.
- Não ler `.env`; o script só fala com a API local.
- Não commitar sem `npm run typecheck` e `npm test` verdes.

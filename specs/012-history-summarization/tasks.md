---

description: "Task list for 012-history-summarization"
---

# Tasks: Sumarização de Histórico (Pruning)

**Input**: Design documents from `specs/012-history-summarization/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: pedidos explicitamente ("Com teste fake", FR-011, constituição Princípio II). Todos rodam com `node:test` via `tsx`, sem rede, com `createFakeSummarizer`. Teste primeiro, vê-lo falhar, depois implementar.

**Organization**: US1 = resumir, persistir e injetar o resumo; US2 = evento `summarize` + fatia `summary` nas métricas.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência pendente)
- **[Story]**: US1, US2

## Path Conventions

Projeto único: `src/`, testes `*.test.ts` ao lado do código. Estilo: tabs, ESM com imports `.js`, JSDoc curto em português citando `specs/012` e a seção do research.

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Conferir que `npm run typecheck` e `npm test` estão verdes antes de começar (baseline; nenhuma dependência nova, nenhum arquivo de config muda — `package.json` intocado)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: o Model da conversa precisa guardar e ler resumos antes de qualquer story ([contracts/conversation-store.md](./contracts/conversation-store.md), research.md §1, §2, §6).

- [X] T002 Em `src/store/conversation-store.ts`: exportar `interface StoredMessage extends ConversationMessage { seq: number }`, `interface ConversationSummary { summary: string; coveredUntil: number; messagesCovered: number; updatedAt: string }`, `type NewConversationSummary = Omit<ConversationSummary, "updatedAt">` e acrescentar à interface `ConversationStore` os métodos `messagesSince(conversationId: string, afterSeq: number): Promise<StoredMessage[]>`, `getSummary(conversationId: string): Promise<ConversationSummary | undefined>` e `saveSummary(conversationId: string, summary: NewConversationSummary): Promise<boolean>`, com JSDoc conforme o contrato (id desconhecido → `ConversationNotFoundError`; `saveSummary` só grava se `coveredUntil` > atual e devolve se gravou)
- [X] T003 Acrescentar a `src/store/conversation-store.contract-tests.ts` (dentro de `runConversationStoreContractTests`) os casos: (a) `messagesSince(id, 0)` devolve todas em ordem com `seq` estritamente crescente; `messagesSince(id, seqDaTerceira)` devolve só as posteriores; (b) `getSummary` de conversa nova → `undefined`; (c) `saveSummary` → `true`, e `getSummary` devolve `summary`, `coveredUntil`, `messagesCovered` e `updatedAt` ISO; (d) `saveSummary` com `coveredUntil` igual ou menor que o atual → `false` e nada muda; maior → `true` e substitui; (e) resumo de uma conversa não aparece em outra; (f) `messagesSince`, `getSummary` e `saveSummary` com id desconhecido rejeitam com `ConversationNotFoundError`; (g) `saveSummary` com `summary` vazio/só espaços ou contadores ≤ 0 rejeita (depende de T002)
- [X] T004 [P] Em `src/store/sqlite-conversation-store.ts`: acrescentar ao `DDL` a tabela `conversation_summaries` exatamente como em [data-model.md](./data-model.md) (com `ON DELETE CASCADE`); implementar `messagesSince` (`SELECT id, role, content, created_at FROM messages WHERE conversation_id = ? AND id > ? ORDER BY id`, `seq = id`), `getSummary` e `saveSummary` (validar `summary.trim()` e contadores > 0 lançando `Error`; `INSERT ... ON CONFLICT(conversation_id) DO UPDATE SET summary = excluded.summary, covered_until = excluded.covered_until, messages_covered = excluded.messages_covered, updated_at = excluded.updated_at WHERE excluded.covered_until > conversation_summaries.covered_until` e devolver `changes > 0`), todos com `assertExists` e prepared statements (depende de T002, T003)
- [X] T005 [P] Em `src/store/mock-conversation-store.ts`: guardar mensagens como `StoredMessage` com `seq` = posição 1-based na conversa (sem expor `seq` em `lastMessages`/`append`, que continuam devolvendo `ConversationMessage`) e um `Map` de resumos; implementar os três métodos com as mesmas regras (validação, monotonicidade, `ConversationNotFoundError`) (depende de T002, T003)
- [X] T006 Rodar `npm test -- src/store` e garantir os contract tests verdes nos dois backends (`sqlite-conversation-store.test.ts` e `mock-conversation-store.test.ts` já chamam `runConversationStoreContractTests`) (depende de T004, T005)

**Checkpoint**: store pronto; nenhuma mudança de comportamento no `/chat` ainda.

---

## Phase 3: User Story 1 - Conversa longa sem perder o que importa (Priority: P1) 🎯 MVP

**Goal**: mensagens que saem da janela de 8 viram um resumo mesclado e persistido, refeito só a cada 8 pendentes, injetado no prompt entre fatos e histórico; falha do resumidor não derruba o turno.

**Independent Test**: com `createFakeSummarizer`, conduzir uma conversa até 16 mensagens não resumidas e verificar: 1 chamada ao resumidor com as 8 mais antigas, resumo gravado, prompt com resumo + 8 mensagens; turnos seguintes sem nova chamada até o próximo lote; o lote seguinte recebe `previous`.

### Tests for User Story 1 ⚠️

- [X] T007 [P] [US1] Em `src/agents/history.test.ts`: (a) `planHistory` em tabela (research.md §3) usando arrays de números: 0, 8, 15 → `toSummarize: []`, `recent` = todos; 16 → `toSummarize` = 8 primeiros, `recent` = 8 últimos; 17 → 9 e 8; 40 → 32 e 8; opções `{ window, batch }` customizadas respeitadas; (b) `formatQuestionWithHistory(history, q, "resumo X")` começa com `formatSummaryBlock("resumo X")` (`"Resumo da conversa até aqui:\nresumo X\n\n"`) seguido do bloco de histórico atual e termina em `Pergunta atual: q`; (c) com resumo e sem histórico → só bloco de resumo + pergunta; (d) sem resumo → saída idêntica à atual (regressão); (e) `formatSummaryBlock(undefined)` e `formatSummaryBlock("")` → `""`; (f) `withHistory(strategy, history, summary)` repassa a pergunta formatada com o resumo
- [X] T008 [P] [US1] Criar `src/agents/summarizer.test.ts`: (a) `summarizerMessages({ previous, messages })` devolve `[["system", ...], ["user", ...]]` em que o system menciona Decisões, Fatos, Pendências e ~150 tokens, e o user contém o resumo anterior (ou indica que não há) e as falas como `Plantonista: ...`/`OpsPilot: ...` na ordem; (b) `createFakeSummarizer()` é determinístico (mesma entrada → mesmo texto), mescla (`previous` aparece no resultado), registra cada chamada em `calls` e pode ser configurado para falhar (`{ fail: true }`) ou devolver vazio (`{ empty: true }`)
- [X] T009 [P] [US1] Criar `src/services/history-service.test.ts` para `loadConversationContext` sobre `createMockConversationStore` + `createFakeSummarizer` (helper que grava N mensagens alternando user/assistant `m1..mN`): (a) 15 mensagens → nenhuma chamada, `recent` com 15, sem `summary`/`event`; (b) 16 → 1 chamada com `m1..m8` e `previous` indefinido, `recent` = `m9..m16`, `summary` = texto do fake, `event = { type: "summarize", content: summary, messagesSummarized: 8 }`, e `getSummary` devolve `coveredUntil` = seq de `m8`, `messagesCovered: 8`; (c) chamada de novo sem novas mensagens → nenhuma nova chamada, mesmo `summary`, sem `event`; (d) +8 mensagens (24) → 2ª chamada recebe `previous` = resumo anterior e `m9..m16`, `messagesCovered: 16`; (e) conversa legada com 40 → 1 chamada com 32 mensagens; (f) resumidor que rejeita → sem gravação, sem `event`, `recent` = todas as não resumidas, `summary` = anterior (ou indefinido), `log` chamado com o nome do erro; (g) resumidor que devolve `"  "` → mesmo tratamento de falha; (h) sem `summarizer` nas deps → nunca resume, `recent` = últimas 8 + resumo guardado se houver; (i) id desconhecido → rejeita com `ConversationNotFoundError`; (j) persistência: sobre `SqliteConversationStore` num arquivo temporário (`os.tmpdir()`), gerar resumo, fechar, reabrir nova instância no mesmo arquivo e verificar que `loadConversationContext` reutiliza o resumo sem chamar o resumidor; (k) concorrência: dois `loadConversationContext` simultâneos no limiar → `getSummary().messagesCovered === 8` (nunca 16)
- [X] T010 [P] [US1] Em `src/services/chat-service.test.ts`: (a) helper que conduz N turnos na mesma conversa com `spyStrategy` + `createFakeSummarizer` em `deps.summarizer`; em 20 turnos o resumidor é chamado exatamente nos turnos 9, 13 e 17 (SC-001); (b) no turno 9 a pergunta recebida pela estratégia contém o resumo do fake antes de `Histórico recente desta conversa` e só 8 falas; (c) com `userId` e fatos, a ordem no prompt é fatos → resumo → histórico → `Pergunta atual:`; (d) resumidor que falha → turno resolve normalmente, resposta gravada; (e) `metrics.historyMessages` = mensagens por extenso (8 no turno 9); (f) uso registrado pelo resumidor (fake chamando `recordUsage`) entra em `promptTokens`, mas não em `llmCalls`
- [X] T011 [P] [US1] Em `src/http/server.test.ts`: atualizar os testes de specs/007 que assumiam teto 12 (linhas ~325–360: "leva só as 12 mensagens mais recentes" e "historyMessages crescendo até o teto de 12") para a nova janela sem resumidor configurado: só as 8 mais recentes chegam à estratégia e `historyMessages` = `[0, 2, 4, 6, 8, 8, 8, 8]`; renomear os títulos de acordo; acrescentar um teste com `summarizer` fake em `AppDeps` mostrando que o 9º turno responde 200 com resumo aplicado

### Implementation for User Story 1

- [X] T012 [US1] Em `src/agents/history.ts`: substituir `HISTORY_LIMIT = 12` por `RECENT_WINDOW = 8` e `SUMMARY_BATCH = 8` (JSDoc citando specs/012); acrescentar `planHistory<T>(unsummarized: readonly T[], opts = { window: RECENT_WINDOW, batch: SUMMARY_BATCH }): { toSummarize: T[]; recent: T[] }` (research.md §3), `formatSummaryBlock(summary?: string): string` e o parâmetro opcional `summary` em `formatQuestionWithHistory` e `withHistory` (research.md §8), mantendo saída idêntica sem resumo; atualizar JSDoc de ordem fatos → resumo → histórico → pergunta (depende de T007)
- [X] T013 [P] [US1] Criar `src/agents/summarizer.ts`: `type Summarizer` ([contracts/summarizer.md](./contracts/summarizer.md)), `SUMMARY_PROMPT` (português: mesclar resumo anterior + mensagens novas; ~150 tokens / ~600 caracteres; blocos curtos **Decisões**, **Fatos**, **Pendências**; nunca descartar decisão ou pendência aberta do resumo anterior; marcar pendência resolvida; sem conversa fiada; sem inventar), função pura `summarizerMessages(input)`, `defaultSummarizer` (`createModel().invoke(summarizerMessages(input))` devolvendo o `content` como string, `trim`), e `logSummaryFailure(error: unknown)` que loga só o `name` do erro (como `logLearningFailure` em `src/memory/learning.ts`) (depende de T008)
- [X] T014 [P] [US1] Criar `src/agents/fake-summarizer.ts`: `createFakeSummarizer(opts?: { fail?: boolean; empty?: boolean }): Summarizer & { calls: Array<{ previous?: string; messages: HistoryMessage[] }> }` determinístico — devolve `[previous] + "|" + conteúdos das mensagens juntados por ","` (ou similar estável), lança `Error("fake summarizer")` com `fail`, devolve `""` com `empty` (depende de T008)
- [X] T015 [US1] Criar `src/services/history-service.ts`: `loadConversationContext(conversationId: string, deps: { conversations: ConversationStore; summarizer?: Summarizer; log?: (error: unknown) => void }): Promise<ConversationContext>` (tipos em [data-model.md](./data-model.md)): lê `getSummary` e `messagesSince(id, summary?.coveredUntil ?? 0)`; sem `summarizer` → `recent` = últimas `RECENT_WINDOW`; senão `planHistory`; com `toSummarize` não vazio chama o resumidor com `previous` + mensagens (como `HistoryMessage`), trata erro/vazio (research.md §7: loga, devolve todas por extenso), senão `saveSummary` com `coveredUntil` = `seq` da última absorvida e `messagesCovered` = anterior + `toSummarize.length` e devolve `summary` novo + `event`. Converter `StoredMessage` → `HistoryMessage` (`role`, `content`) na saída (depende de T006, T012, T013, T009)
- [X] T016 [US1] Em `src/services/chat-service.ts`: acrescentar `summarizer?: Summarizer` a `ChatDeps`; trocar `lastMessages(HISTORY_LIMIT)` por `loadConversationContext` (só quando há `conversationId`; conversa nova → contexto vazio) executado **dentro** de `runWithTimeout(trackUsage(async () => ...))`, junto com `contextBreakdown` e `withHistory(withMemory(strategy, facts), ctx.recent, ctx.summary).run(...)`; `historyMessages = ctx.recent.length`; passar `logSummaryFailure` como `log`. Atualizar JSDoc de `runChat` (plan.md Design Notes) (depende de T015)
- [X] T017 [US1] Em `src/http/server.ts`: `summarizer?: Summarizer` em `AppDeps`, repassado a `runChat`; em `src/index.ts`: importar `defaultSummarizer` e passá-lo em `createApp({ ..., summarizer: defaultSummarizer })` (depende de T016)

**Checkpoint**: `npm run typecheck && npm test` verdes; resumo persistido e aplicado (US1 entregável sozinha, mesmo sem o evento no rastro).

---

## Phase 4: User Story 2 - Ver quando a conversa foi resumida (Priority: P2)

**Goal**: evento `summarize` no início do rastro só no turno que gerou resumo; fatia `summary` no `contextBreakdown`.

**Independent Test**: no turno 9 de uma conversa com resumidor fake, `trace[0]` é `summarize` com o resumo e `messagesSummarized: 8`; nos turnos 8 e 10, nenhum evento; `contextBreakdown.summary > 0` a partir do turno 9.

### Tests for User Story 2 ⚠️

- [X] T018 [P] [US2] Em `src/context/breakdown.test.ts`: (a) `contextBreakdown(q, history, facts, summary)` → `summary === estimateTokens(formatSummaryBlock(summary))`, `history === estimateTokens(formatQuestionWithHistory(history, ""))` (sem resumo), `total` = soma das quatro; (b) sem resumo → `summary: 0`; (c) partição exata na ordem real: `formatQuestionWithMemory(f, formatQuestionWithHistory(h, q, s)) === formatQuestionWithMemory(f, "") + formatSummaryBlock(s) + formatQuestionWithHistory(h, "") + q`; atualizar o teste de partição de specs/011 para essa ordem real
- [X] T019 [P] [US2] Em `src/agents/trace.test.ts`: `formatTrace` de um evento `{ type: "summarize", content: "R", messagesSummarized: 8 }` → `"[Resumo] R"`
- [X] T020 [P] [US2] Em `src/services/chat-service.test.ts`: (a) em 12 turnos com resumidor fake, `trace[0].type === "summarize"` só no turno 9, com `content` = resumo gravado e `messagesSummarized: 8`; demais turnos sem nenhum evento `summarize`; (b) `metrics.contextBreakdown.summary` = 0 até o turno 8 e > 0 do 9 em diante; `total` = soma das quatro fatias; (c) resumidor que falha no turno 9 → sem evento; atualizar o `deepEqual` do primeiro teste do arquivo para incluir `summary: 0`
- [X] T021 [P] [US2] Em `src/http/server.test.ts`: no teste com `summarizer` fake de T011, o corpo do 9º turno tem `trace[0]` `summarize` e `metrics.contextBreakdown.summary > 0`; o do 8º não tem o evento

### Implementation for User Story 2

- [X] T022 [P] [US2] Em `src/agents/strategy.ts`: acrescentar `| { type: "summarize"; content: string; messagesSummarized: number }` a `TraceEvent` (JSDoc specs/012); em `src/agents/trace.ts`: `summarize: "Resumo"` em `LABELS` (o `default` do `formatEvent` já atende) (depende de T019)
- [X] T023 [P] [US2] Em `src/context/breakdown.ts`: `summary: number` em `ContextBreakdown`, quarto parâmetro opcional `summary?: string`, `history` estimado sem o resumo, `total` com as quatro fatias; corrigir o JSDoc da partição para a ordem real `memória + resumo + histórico + pergunta` (research.md §8–§9) (depende de T018)
- [X] T024 [US2] Em `src/services/history-service.ts` e `src/services/chat-service.ts`: tipar `event` como o `TraceEvent` `summarize`; em `runChat`, devolver `trace: ctx.event ? [ctx.event, ...result.trace] : result.trace` e passar `ctx.summary` a `contextBreakdown` (depende de T016, T022, T023, T020)
- [X] T025 [US2] Em `scripts/conversa-long.sh`: `campos()` passa a ler também `trace[0]?.type === "summarize"` e imprime uma 5ª coluna `resumo` (`*` quando houver evento, vazio caso contrário); ajustar o cabeçalho, o `printf` e o comentário de uso no topo do script; validar com um stub local que devolve `trace: [{ type: "summarize", ... }]` num turno (depende de T024)

**Checkpoint**: `npm run typecheck && npm test` verdes; resposta do `/chat` igual a [contracts/chat-api.md](./contracts/chat-api.md).

---

## Phase 5: Polish & Cross-Cutting Concerns

- [X] T026 [P] Atualizar `AGENTS.md`: na seção "Conversa persistente", trocar "12 últimas mensagens" pela janela de 8 + resumo; nova seção "Sumarização de histórico" (specs/012): tabela `conversation_summaries`, `planHistory` (gatilho com 8 pendentes, todas as pendentes num resumo só), `Summarizer`/`defaultSummarizer`/`createFakeSummarizer`, `loadConversationContext` dentro de timeout + `trackUsage`, falha não derruba o turno, gravação monotônica, ordem fatos → resumo → histórico → pergunta, evento `summarize`, `contextBreakdown.summary`, coluna `resumo` do `conversa-long.sh`
- [X] T027 Rodar `npm run typecheck` e `npm test` e corrigir o que quebrar
- [X] T028 Rodar o quickstart §2 (com `.env` configurado, sem lê-lo; `PORT` alternativo e `OPSPILOT_DB` temporário) com `TURNS=20` e registrar no relatório: turnos marcados com `*`, curva de `historico`/`promptTokens`, tamanho do resumo (fatia `summary` ≈ 150?) e uma amostra do texto do resumo final lida via `conversation_summaries` (quickstart §4); encerrar o servidor ao fim

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001)** → **Foundational (T002–T006)** → **US1 (T007–T017)** → **US2 (T018–T025)** → **Polish (T026–T028)**
- US2 depende de US1: o evento só existe se o resumo for gerado; T018, T019, T022 e T023 podem começar em paralelo com a US1 (arquivos independentes).

### Within Each Phase

- Testes primeiro, falhando → implementação
- Store (T002 → T003 → T004/T005) → `history.ts`/`summarizer.ts` → `history-service.ts` → `chat-service.ts` → `server.ts`/`index.ts`

### Parallel Opportunities

- T004 e T005 (backends diferentes)
- US1 testes: T007, T008, T009, T010, T011
- US1 implementação: T013 e T014 em paralelo; T012 em paralelo com ambos
- US2: T018, T019, T020, T021 em paralelo; T022 e T023 em paralelo
- T026 em paralelo com T027

---

## Parallel Example: User Story 1

```bash
Task: "T007 testes de planHistory/formatSummaryBlock em src/agents/history.test.ts"
Task: "T008 testes de summarizerMessages/createFakeSummarizer em src/agents/summarizer.test.ts"
Task: "T009 testes de loadConversationContext em src/services/history-service.test.ts"
Task: "T010 testes de runChat com resumo em src/services/chat-service.test.ts"
Task: "T011 ajuste dos testes de janela em src/http/server.test.ts"
```

## Parallel Example: User Story 2

```bash
Task: "T018 fatia summary em src/context/breakdown.test.ts"
Task: "T019 rótulo Resumo em src/agents/trace.test.ts"
Task: "T020 evento summarize em src/services/chat-service.test.ts"
Task: "T021 evento summarize no /chat em src/http/server.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. T001 → T002–T006 (store)
2. T007–T017 (resumo gerado, persistido e no prompt)
3. **Parar e validar**: `npm run typecheck && npm test`; conversa longa mantém decisões antigas

### Incremental Delivery

1. Store → US1 (valor central: continuidade com contexto limitado)
2. US2 → observabilidade (evento + fatia nas métricas + coluna no script)
3. Polish → AGENTS.md e validação com o modelo real

---

## Notes

- Nenhuma dependência nova.
- Não ler `.env`; não commitar sem `npm run typecheck` e `npm test` verdes.
- `lastMessages` permanece no contrato do store (testes de specs/007 dependem dele).

# Implementation Plan: Sumarização de Histórico (Pruning)

**Branch**: `012-history-summarization` | **Date**: 2026-10-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/012-history-summarization/spec.md`

## Summary

Comprimir conversas longas sem perder decisões, fatos e pendências. A janela
recente cai para 8 mensagens; quando 8 ou mais mensagens não resumidas ficam
fora dela, um resumidor (LLM, injetável) mescla o resumo anterior com essas
mensagens num texto de ~150 tokens, gravado em `conversation_summaries` com a
marca da última mensagem coberta. Fora desse gatilho o resumo guardado é só
reutilizado. A regra do gatilho é uma função pura (`planHistory`); a
orquestração fica num Service novo (`loadConversationContext`) chamado por
`runChat` dentro do timeout e do `trackUsage`. O resumo entra no prompt entre
os fatos e o histórico, o turno que o gera ganha um evento `summarize` no
início do rastro, e o detalhamento de contexto ganha a fatia `summary`.
Falha do resumidor nunca derruba o turno. Tudo testado com resumidor falso.

## Technical Context

**Language/Version**: TypeScript (ESM, `strict: true`) sobre Node.js 22 LTS

**Primary Dependencies**: `@langchain/core` / `@langchain/openai` (`createModel` para o resumidor real), `node:sqlite` (`DatabaseSync`), `express`, `zod` — nenhuma dependência nova

**Storage**: SQLite (`OPSPILOT_DB`), nova tabela `conversation_summaries` no DDL idempotente do `SqliteConversationStore`; `:memory:` nos testes

**Testing**: `node:test` via `tsx`; `createFakeSummarizer` determinístico; contract tests compartilhados SQLite/mock

**Target Platform**: servidor Node (API HTTP local)

**Project Type**: web-service (API Express) com agente LangChain/LangGraph

**Performance Goals**: uma chamada extra ao modelo a cada 8 mensagens que saem da janela (≈ a cada 4 turnos); zero chamadas nos demais turnos

**Constraints**: nunca resumir a cada request; turno nunca falha por causa do resumidor; cobertura do resumo nunca retrocede; ordem do prompt fatos → resumo → histórico → pergunta

**Scale/Scope**: 3 arquivos novos (`summarizer.ts`, `fake-summarizer.ts`, `history-service.ts`) + testes; ajustes em `history.ts`, `strategy.ts`, `trace.ts`, `breakdown.ts`, `conversation-store.ts`, ambos os stores, `chat-service.ts`, `server.ts`, `index.ts`, `conversa-long.sh`, `AGENTS.md`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Avaliação |
|-----------|-----------|
| I. Validação na Fronteira (zod) | ✅ Nenhuma entrada HTTP nova; `/chat` mantém `chatRequestSchema`. Saída do resumidor (texto do LLM) é tratada como não confiável: `trim`, vazio = falha. |
| II. Test-First | ✅ Toda lógica nova com teste e resumidor falso (research.md §12); store coberto pelos contract tests nos dois backends. |
| III. MVC | ✅ Model: `ConversationStore` (+3 métodos, só ele fala SQL). Service: `loadConversationContext` e `runChat`. Controller: `server.ts` só repassa `summarizer`. |
| IV. Erros de domínio na borda | ✅ `ConversationNotFoundError` continua vindo do store e sendo traduzido em 404 no Controller; falha do resumidor não é erro de domínio (degradação tratada no Service). |
| V. Funções puras | ✅ `planHistory`, `formatSummaryBlock`, `formatQuestionWithHistory`, `summarizerMessages`, `contextBreakdown` puras; I/O (LLM, SQLite) isolado no resumidor e no store. |
| VI. Segredos | ✅ Nada lido de `.env`; log de falha só com `error.name`. Resumo não amplia exposição (deriva de mensagens já gravadas). |
| Stack / persistência | ✅ SQLite nativo, DDL idempotente no próprio store, sem migration externa. |

**Resultado**: aprovado. Reavaliado após research/data-model/contracts:
continua aprovado, sem violações.

## Project Structure

### Documentation (this feature)

```text
specs/012-history-summarization/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── chat-api.md            # evento summarize, contextBreakdown.summary
│   ├── conversation-store.md  # messagesSince / getSummary / saveSummary
│   └── summarizer.md          # tipo Summarizer, real e fake
├── checklists/
│   └── requirements.md
└── tasks.md                   # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── agents/
│   ├── history.ts               # RECENT_WINDOW/SUMMARY_BATCH, planHistory, formatSummaryBlock, resumo em formatQuestionWithHistory/withHistory
│   ├── history.test.ts
│   ├── summarizer.ts            # novo: Summarizer, summarizerMessages (pura), defaultSummarizer, logSummaryFailure
│   ├── summarizer.test.ts       # novo
│   ├── fake-summarizer.ts       # novo: createFakeSummarizer
│   ├── strategy.ts              # TraceEvent + summarize
│   └── trace.ts                 # rótulo "Resumo"
├── context/
│   ├── breakdown.ts             # fatia summary; doc da ordem corrigida
│   └── breakdown.test.ts
├── store/
│   ├── conversation-store.ts    # StoredMessage, ConversationSummary, 3 métodos novos
│   ├── conversation-store.contract-tests.ts
│   ├── sqlite-conversation-store.ts   # DDL conversation_summaries + métodos
│   └── mock-conversation-store.ts     # mesmos métodos em memória
├── services/
│   ├── history-service.ts       # novo: loadConversationContext
│   ├── history-service.test.ts  # novo
│   ├── chat-service.ts          # usa loadConversationContext dentro de timeout+trackUsage; evento no trace
│   └── chat-service.test.ts
├── http/
│   ├── server.ts                # AppDeps.summarizer → runChat
│   └── server.test.ts
└── index.ts                     # injeta defaultSummarizer

scripts/conversa-long.sh         # coluna "resumo" (* quando há evento summarize)
AGENTS.md                        # seção "Sumarização de histórico"
```

**Structure Decision**: projeto único existente. O resumidor fica em
`src/agents/` (é uma chamada ao modelo, como `reflection.ts`); a orquestração
de carregar/resumir/gravar é Service (`src/services/history-service.ts`); a
persistência estende o Model de conversa.

## Design Notes

- **Fluxo em `runChat`**: `recall` de fatos (fora do timeout, como hoje) →
  `runWithTimeout(trackUsage(async () => { ctx = await
  loadConversationContext(...); breakdown = contextBreakdown(message, ctx.recent,
  facts, ctx.summary); result = await withHistory(withMemory(strategy, facts),
  ctx.recent, ctx.summary).run(...); return { ctx, breakdown, result } }))` →
  grava pergunta/resposta → `learn` → devolve com `trace = [ctx.event?,
  ...result.trace]`.
- **Conversa nova** (sem `conversationId`): não há o que carregar —
  `loadConversationContext` nem é chamado; contexto vazio.
- **`lastMessages`** continua no contrato (usado pelos testes de specs/007), mas
  `runChat` passa a usar `messagesSince`.
- **`HISTORY_LIMIT`** é substituído por `RECENT_WINDOW`; atualizar os usos e
  os testes de specs/007 que dependiam de 12.
- **Script**: o `campos()` do `conversa-long.sh` passa a ler também
  `trace[0].type === "summarize"` e imprime `*` numa coluna `resumo`.

## Complexity Tracking

Sem violações a justificar.

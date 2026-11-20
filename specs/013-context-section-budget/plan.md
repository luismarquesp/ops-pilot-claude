# Implementation Plan: Orçamento de Contexto por Seção (ContextBuilder)

**Branch**: `013-context-section-budget` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/013-context-section-budget/spec.md`

## Summary

Um único módulo puro, `src/context/context-builder.ts`, passa a montar o
prompt do turno de chat para qualquer estratégia: recebe pergunta, fatos
(com `score`), resumo e histórico, aplica um teto por seção em tokens
estimados — resumo 200, janela 1200, memória 300 — e devolve o prompt, o que
foi mantido, um relatório de cortes e o `contextBreakdown`. A janela perde as
mensagens mais antigas, a memória os fatos de menor `score`, o resumo é
encurtado no fim de uma linha; pergunta e instruções de sistema nunca são
tocadas. Os tetos vêm de `CONTEXT_BUDGET_SUMMARY|WINDOW|MEMORY`, validados com
zod na subida (`parseContextBudget`). `runChat` troca a composição
`withHistory(withMemory(...))` por `buildContext` + `strategy.run({ question:
built.prompt })`, e as métricas ganham `contextTrimmed`. Abaixo dos tetos o
prompt é byte a byte o de hoje.

## Technical Context

**Language/Version**: TypeScript (ESM, `strict: true`) sobre Node.js 22 LTS

**Primary Dependencies**: `zod` (validação do env); formatadores existentes de `src/agents/history.ts` e `src/memory/memory-prompt.ts`; `estimateTokens` (specs/011) — nenhuma dependência nova

**Storage**: N/A (nada persistido; resumo guardado do specs/012 não muda)

**Testing**: `node:test` via `tsx`; testes puros do builder com tetos baixos; testes de `runChat` com estratégia falsa que captura a `question` recebida

**Target Platform**: servidor Node (API HTTP local)

**Project Type**: web-service (API Express) com agente LangChain/LangGraph

**Performance Goals**: montagem O(n²) sobre ≤ 15 mensagens e ≤ 3 fatos — desprezível frente à chamada ao modelo; nenhuma chamada extra a modelo, rede ou banco

**Constraints**: prompt idêntico ao atual abaixo dos tetos (SC-003); pergunta nunca alterada (SC-004); cada seção ≤ teto (SC-001); determinístico

**Scale/Scope**: 2 arquivos novos (`context-builder.ts` + teste); ajustes em `chat-service.ts` (+ teste), `history.ts`/`memory-prompt.ts` (remoção dos decoradores e seus testes), `server.ts`, `index.ts`, `.env.example`, `AGENTS.md`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Avaliação |
|-----------|-----------|
| I. Validação na Fronteira (zod) | ✅ Env `CONTEXT_BUDGET_*` é entrada externa e passa por schema zod em `parseContextBudget` antes de chegar ao Service. `/chat` inalterado. |
| II. Test-First | ✅ `context-builder.test.ts` cobre cada regra de corte com tetos baixos, intocabilidade da pergunta, independência das seções e o parse do env; `chat-service.test.ts` cobre métricas e injeção do orçamento. |
| III. MVC | ✅ Sem Model novo. Builder é lógica pura usada pelo Service `runChat`; Controller (`server.ts`) só repassa o orçamento; composição de dependências em `index.ts`. |
| IV. Erros de domínio na borda | ✅ Nenhum erro novo: env inválido degrada para o padrão com log, não lança. |
| V. Funções puras | ✅ `buildContext` e `parseContextBudget` puras; `process.env` e o log ficam em `index.ts`. Remove a composição por decoradores em favor de uma função de string. |
| VI. Segredos | ✅ Nada lido de `.env`; log de valor inválido cita só o nome da variável. `.env.example` documenta as chaves sem valores. |
| Stack / persistência | ✅ Sem mudança. |

**Resultado**: aprovado. Reavaliado após research/data-model/contracts:
continua aprovado, sem violações.

## Project Structure

### Documentation (this feature)

```text
specs/013-context-section-budget/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── context-builder.md   # buildContext / parseContextBudget
│   └── chat-api.md          # metrics.contextTrimmed
├── checklists/
│   └── requirements.md
└── tasks.md                 # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── context/
│   ├── context-builder.ts        # NOVO: buildContext, parseContextBudget, DEFAULT_CONTEXT_BUDGET
│   ├── context-builder.test.ts   # NOVO: tetos baixos cortam na ordem certa
│   └── breakdown.ts              # reaproveitado pelo builder (sem mudança)
├── agents/
│   └── history.ts                # remove withHistory (formatadores ficam)
├── memory/
│   └── memory-prompt.ts          # remove withMemory (formatador fica)
├── services/
│   ├── chat-service.ts           # buildContext no lugar da composição; ChatDeps.budget; metrics.contextTrimmed
│   └── chat-service.test.ts
├── http/
│   └── server.ts                 # AppDeps.contextBudget → runChat
└── index.ts                      # parseContextBudget(process.env) + log de inválidos

.env.example                      # CONTEXT_BUDGET_SUMMARY/WINDOW/MEMORY
AGENTS.md                         # seção "Orçamento de contexto"
```

**Structure Decision**: projeto único (`src/`), testes colocalizados
(`*.test.ts`), como nas features anteriores. O builder fica em `src/context/`
ao lado de `tokens.ts` e `breakdown.ts`, que ele usa.

## Complexity Tracking

Sem violações a justificar.

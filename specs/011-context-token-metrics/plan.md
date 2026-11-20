# Implementation Plan: Medição de Contexto (Tokens)

**Branch**: `011-context-token-metrics` | **Date**: 2026-10-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/011-context-token-metrics/spec.md`

## Summary

Instrumentar o tamanho do contexto de cada turno do `/chat`. Um módulo novo
`src/context/` traz funções puras — `estimateTokens` (`ceil(chars/4)`),
extração do uso real do `LLMResult` do LangChain e `contextBreakdown` por fonte
(pergunta/histórico/memória) — e um rastreador por turno em
`AsyncLocalStorage`. `createModel()` anexa um callback `handleLLMEnd` (aguardado)
quando há escopo ativo, então **todas** as chamadas de qualquer estratégia são
somadas sem mudar o contrato `ReasoningStrategy`. `runChat` abre o escopo em
volta da estratégia e acrescenta `promptTokens` (real, `null` sem uso) e
`contextBreakdown` (estimado) às métricas. `scripts/conversa-long.sh` conduz uma
conversa de N turnos e imprime `promptTokens` por turno.

## Technical Context

**Language/Version**: TypeScript (ESM, `strict: true`) sobre Node.js 22 LTS

**Primary Dependencies**: `@langchain/core` (callbacks, `LLMResult`), `@langchain/openai` (`ChatOpenAI`), `node:async_hooks` (`AsyncLocalStorage`), `express`, `zod` — nenhuma dependência nova

**Storage**: N/A — métricas não são persistidas

**Testing**: `node:test` via `tsx`; estratégia falsa e `LLMResult` falso, sem rede

**Target Platform**: servidor Node (API HTTP local); script em bash POSIX (Git Bash no Windows)

**Project Type**: web-service (API Express) com agente LangChain/LangGraph

**Performance Goals**: overhead desprezível — o callback só soma inteiros; estimativa é O(1) sobre `length`

**Constraints**: não alterar prompt nem resposta (FR-008); turnos concorrentes isolados; refletor de aprendizado fora da contagem; contrato `/chat` só aditivo

**Scale/Scope**: ~4 arquivos novos em `src/context/`, ajustes em `model.ts` e `chat-service.ts`, 1 script, testes

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Avaliação |
|-----------|-----------|
| I. Validação na Fronteira (zod) | ✅ Nenhuma entrada externa nova; `/chat` mantém `chatRequestSchema`. O `LLMResult` (dado de terceiro) é lido defensivamente por `usageFromLLMResult`, que descarta valores não numéricos. |
| II. Test-First | ✅ Cada função/módulo novo nasce com teste (research.md §8); suíte continua sem rede. |
| III. MVC | ✅ Controller (`server.ts`) só repassa `result`; a montagem das métricas fica no Service (`runChat`); `src/context/` é utilitário de domínio, sem HTTP nem SQL. |
| IV. Erros de domínio na borda | ✅ Nenhum erro novo; falha ao ler uso é engolida no handler (não é erro de domínio, e não pode derrubar o turno). |
| V. Funções puras | ✅ `estimateTokens`, `usageFromLLMResult`, `promptTokensOf`, `contextBreakdown` são puras. Efeito (acumular no escopo) isolado em `usage-tracker.ts`, na borda do modelo. |
| VI. Segredos | ✅ Script não lê `.env`; só fala com a API local. Nenhum conteúdo de prompt é logado. |
| Fluxo / comandos | ✅ Script novo não duplica `dev/test/bench`; é ferramenta de observação. |

**Resultado**: aprovado, sem violações. Pós-design: reavaliado após research,
data-model e contracts — continua aprovado.

## Project Structure

### Documentation (this feature)

```text
specs/011-context-token-metrics/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── chat-api.md      # emenda ao /chat + contrato do conversa-long.sh
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── context/                      # novo
│   ├── tokens.ts                 # estimateTokens, TokenUsage, usageFromLLMResult, promptTokensOf (puras)
│   ├── tokens.test.ts
│   ├── breakdown.ts              # ContextBreakdown, contextBreakdown(question, history, facts) (pura)
│   ├── breakdown.test.ts
│   ├── usage-tracker.ts          # AsyncLocalStorage: trackUsage, recordUsage, usageCallbacks
│   └── usage-tracker.test.ts
├── agents/
│   └── model.ts                  # createModel(): callbacks: usageCallbacks()
├── services/
│   ├── chat-service.ts           # trackUsage em volta da estratégia; ChatMetrics + promptTokens/contextBreakdown
│   └── chat-service.test.ts      # casos novos
└── http/
    └── server.test.ts            # 200 traz os campos novos

scripts/
└── conversa-long.sh              # novo

AGENTS.md                         # seção "Medição de contexto"
```

**Structure Decision**: projeto único existente. O módulo `src/context/` segue o
padrão de `src/memory/` (puras + teste ao lado); o script vai para um diretório
`scripts/` novo na raiz.

## Design Notes

- **Ordem em `runChat`**: `breakdown` é calculado antes da execução (com
  `history`, `facts`, `input.message`); `trackUsage(() => composed.run(...))` vai
  **dentro** de `runWithTimeout`; o escopo fecha antes de gravar o turno e de
  disparar `learn` (research.md §3).
- **Timeout**: se estourar, o turno lança `TimeoutError` como hoje; o escopo
  descartado continua acumulando em segundo plano sem efeito.
- **`createModel`**: única mudança é `callbacks: usageCallbacks()`; comentário
  avisando que modelos criados fora de `run()` não são contados.
- **Handler**: subclasse `UsageCallbackHandler extends BaseCallbackHandler` com `super({ _awaitHandler: true })` e `handleLLMEnd`
  (`fromMethods` não aceita `_awaitHandler` no `@langchain/core` instalado),
  com `try/catch` interno.

## Complexity Tracking

Sem violações a justificar.

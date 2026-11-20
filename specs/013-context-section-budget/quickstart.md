# Quickstart: Orçamento de Contexto por Seção

## Pré-requisitos

- `npm install` feito; Node 22.
- Para o roteiro manual: `.env` com `OPENROUTER_API_KEY`/`OPEN_ROUTER_MODEL`
  (não leia nem commite o arquivo).

## 1. Testes automatizados (sem rede)

```bash
npm run typecheck
npm test
```

Esperado, em `src/context/context-builder.test.ts`:

- tetos padrão + entrada pequena → `prompt` igual à composição antiga, `trimmed` zerado;
- `window` baixo → somem as mensagens mais antigas, as recentes ficam inteiras;
- `memory` baixo com fatos fora de ordem → some o de menor `score`;
- `summary` baixo → resumo encurtado no fim de uma linha;
- pergunta gigante com todos os tetos em 0 → `prompt === question`;
- `parseContextBudget` → padrão para ausente/vazio, `invalid` para `abc`/`-1`/`1.5`.

E em `src/services/chat-service.test.ts`: `metrics.contextTrimmed`,
`historyMessages`/`memoryFacts` após corte e `ChatDeps.budget`.

## 2. Roteiro manual com a API

```bash
CONTEXT_BUDGET_WINDOW=60 CONTEXT_BUDGET_MEMORY=20 npm run dev
```

Faça alguns turnos na mesma conversa (`conversationId` devolvido) com
`userId` e mensagens longas, e confira em cada resposta:

- `metrics.contextBreakdown.history ≤ 60` e `memory ≤ 20`;
- `metrics.contextTrimmed.historyMessages > 0` depois de alguns turnos.

```bash
CONTEXT_BUDGET_WINDOW=abc npm run dev
```

Esperado: log citando `CONTEXT_BUDGET_WINDOW` como inválida; o serviço sobe com
janela 1200.

## 3. Sem regressão

`bash scripts/conversa-long.sh` com os padrões: o comportamento de resumo
(coluna `resumo`) não muda; `promptTokens` deixa de crescer além do teto das
seções.

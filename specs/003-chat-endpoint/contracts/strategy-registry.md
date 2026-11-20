# Contract: Strategy Registry

Definido em `src/agents/index.ts` (FR-008). Consumido por `src/http/server.ts` (via
injeção — ver research.md §2) e montado com tools reais pelo bootstrap em
`src/index.ts`.

## Tipos

```ts
function createStrategyRegistry(tools: StructuredToolInterface[]): Map<string, ReasoningStrategy>;

const DEFAULT_STRATEGY_NAME = "react";
```

## Regras do contrato

- A chave de cada entrada é `ReasoningStrategy.name` (mesmo valor usado pela `arena`
  em specs/001) — hoje, `react` e `plan-and-execute`.
- O registro não inclui entradas "refletidas" (não há chave `reflect:react`) — a
  reflexão é responsabilidade do Controller (`server.ts`), aplicada em runtime com
  `withReflection` sobre a estratégia já resolvida (FR-009), não do registro.
- `DEFAULT_STRATEGY_NAME` é o nome usado quando `ChatRequest.strategy` está ausente
  (FR-003) — hoje `"react"`, a mesma estratégia usada como padrão da `arena`
  (specs/001, `contracts/arena-cli.md`).
- O registro é sempre construído a partir de `tools`, nunca é um singleton global —
  isso é o que permite ao teste de integração do Controller substituí-lo por um
  `Map` com uma única estratégia falsa, sem tocar tools/store reais (research.md §2).

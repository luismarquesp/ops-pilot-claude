# Contract: Arena CLI

`src/arena.ts` (FR-015, FR-016) — comando de linha executado via `npm run arena`
(ver `package.json`).

## Flags

| Flag | Obrigatória | Formato | Descrição |
|------|-------------|---------|-----------|
| `--strategies` | não (default: todas as estratégias registradas) | lista separada por vírgula, ex.: `react,plan-and-execute` | seleciona quais `name` de `ReasoningStrategy` (ver reasoning-strategy.md) executar |
| `--max-iterations` | não (default: 8 — research.md §5) | inteiro positivo | sobrescreve `StrategyInput.maxIterations` para todas as estratégias selecionadas nesta execução |

## Entrada

A `arena` roda todas as estratégias selecionadas sobre a **mesma** pergunta
(`StrategyInput.question`), fornecida como argumento posicional ou valor fixo do
cenário de demonstração (detalhe de implementação a definir em `tasks.md`).

## Saída (comportamento observável)

Para cada estratégia executada, na ordem em que foi selecionada:

1. Cabeçalho identificando a estratégia (`name`).
2. O `trace` completo, formatado de forma legível (um evento por linha, com seu tipo).
3. As `metrics` (`llmCalls`, `latencyMs`).
4. A `answer` final.

**Exemplo de invocação**:

```sh
npm run arena -- --strategies react,plan-and-execute --max-iterations 8
```

## Erros

- Um nome de estratégia em `--strategies` que não corresponde a nenhuma estratégia
  registrada resulta em erro claro na CLI (lista de nomes válidos), sem executar
  nenhuma estratégia.
- `--max-iterations` não numérico ou ≤ 0 resulta em erro claro na CLI antes de
  qualquer execução.

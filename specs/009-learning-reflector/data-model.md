# Data Model: Refletor de Aprendizado

Esta feature **não altera o schema**: fatos aprendidos vão para a mesma tabela
`memories` da specs/008 ([data-model](../008-semantic-memory/data-model.md)), via
`MemoryStore.remember`, com as mesmas regras de dedup e isolamento.

## Tipos novos (`src/memory/learning.ts`)

| Tipo | Forma | Notas |
|------|-------|-------|
| `LearningVerdict` | `{ hasLearning: boolean; fact?: string }` | Saída estruturada do extrator; efêmera |
| `LearningExtractor` | `(message: string) => Promise<LearningVerdict>` | Injetável; padrão = LLM com `withStructuredOutput` |
| `LearningOutcome` | `"skipped_secret" \| "nothing" \| "rejected" \| "learned" \| "duplicate" \| "failed"` | Resultado observável de um aprendizado |
| `LearnInput` | `{ userId: string; message: string }` | O que o `runChat` passa ao `learn` |

## Regras de `toLearnableFact` (pura)

| Entrada | Saída |
|---------|-------|
| `hasLearning: false` | `undefined` |
| `fact` ausente, vazio ou só espaços | `undefined` |
| `fact.trim()` com mais de 500 caracteres | `undefined` |
| `containsSecret(fact)` | `undefined` |
| demais | `fact.trim()` |

## Transições de `learnFromMessage`

```text
mensagem ──containsSecret──▶ skipped_secret      (extrator não é chamado)
   │
   ▼ extrator
veredito ──toLearnableFact = undefined──▶ nothing (hasLearning false) | rejected (fato inválido/segredo)
   │
   ▼ memory.remember
created: true  ──▶ learned
created: false ──▶ duplicate
qualquer erro  ──▶ failed (+ log só com o nome do erro)
```

## Mudança no formato do prompt (supera specs/008 research §6)

Os fatos lembrados deixam de mostrar o id:

```text
Fatos lembrados sobre este usuário (mais relevante primeiro):
- <fato>
```

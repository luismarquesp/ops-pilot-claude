# Contract: tools de memória (revisão da specs/008)

Supera [specs/008 contracts/memory-tools.md](../../008-semantic-memory/contracts/memory-tools.md).
`createMemoryTools(memory, userId)` passa a devolver **`remember_fact` e
`forget_preference`**. A tool `forget_fact` é removida.

## `remember_fact`

Sem mudança.

## `forget_preference` (nova)

- **Input** (zod): `{ description: string }`, com trim, 1..500 caracteres. É a
  preferência descrita em linguagem natural ("que eu prefiro respostas curtas").
- **Comportamento**: `forgetPreference(memory, userId, description)` faz o seguinte:
  1. `recall(userId, description, 1)` → o fato mais parecido do usuário, se o score for ≥ 0,3.
  2. Se encontrou: `forget(userId, id)` → `{ "forgotten": true, "fact": "<texto removido>" }`.
  3. Se não encontrou: `{ "forgotten": false }`.
- **Descrição para o LLM** (resumo): esquece um fato/preferência guardado quando
  o plantonista pedir para esquecer ou disser que mudou. Descreva o fato com as
  palavras dele e confirme ao plantonista o texto devolvido em `fact`.
- **Isolamento**: o `userId` fica só na closure; só fatos do próprio usuário
  podem ser encontrados e removidos.

## Prompt

`formatQuestionWithMemory` lista os fatos como `- <fato>`, sem `[id]`.

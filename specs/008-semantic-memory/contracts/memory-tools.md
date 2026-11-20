# Contract: tools de memória do agente

> **Superado por [specs/009 contracts/memory-tools.md](../../009-learning-reflector/contracts/memory-tools.md)**
> (`forget_fact` → `forget_preference`; ids fora do prompt).

`createMemoryTools(memory: MemoryStore, userId: string): StructuredToolInterface[]`
(`src/memory/memory-tools.ts`). O `userId` fica preso na closure; nenhuma tool o
recebe como argumento (research §7). As tools só entram no registry do turno quando
o `/chat` recebe `userId`.

## `remember_fact`

- **Input** (zod): `{ fact: string }`, com trim, 1..500 caracteres.
- **Output** (JSON string): `{ "id": "<uuid>", "fact": "<texto guardado>", "created": true|false }`.
  `created: false` indica que um fato equivalente já existia e foi devolvido.
- **Descrição para o LLM** (resumo): guarda um fato **duradouro** sobre o
  plantonista (papel, time, serviços pelos quais responde, preferências de
  resposta). Não serve para estado de alertas ou incidentes, que muda o tempo todo
  e fica nas outras tools.

## `forget_fact`

- **Input** (zod): `{ memoryId: string (uuid) }`, usando o id que aparece entre
  colchetes nos fatos lembrados do prompt.
- **Output** (JSON string): `{ "forgotten": true|false }`.
- **Descrição para o LLM** (resumo): remove um fato que o plantonista disse estar
  errado ou desatualizado.

## Erros

Nenhuma das duas tools lança erro de domínio para o agente. Com input inválido, o
LangChain devolve o erro de schema como observação; `forget_fact` com id alheio ou
inexistente devolve `{ "forgotten": false }`.

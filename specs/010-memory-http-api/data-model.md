# Data Model: API HTTP de Memória

**Sem mudança de schema.** Usa a tabela `memories` da specs/008
([data-model](../008-semantic-memory/data-model.md)).

## Mudança no `MemoryStore` (`src/memory/memory-store.ts`)

| Operação | Assinatura | Regra |
|----------|------------|-------|
| `list` (nova) | `list(userId: string): Promise<Memory[]>` | Todos os fatos de `userId`, `created_at` decrescente (empate: inserção mais recente primeiro). Não lê o embedding nem chama o embedder. Usuário sem fatos → `[]` |

`remember`, `recall` e `forget` ficam como estão.

## Erros de domínio novos (`src/services/errors.ts`)

| Classe | Campos | Quando |
|--------|--------|--------|
| `SecretDetectedError` | — (mensagem genérica, sem o texto) | `registerFact` com `containsSecret(fact)` |
| `MemoryNotFoundError` | `memoryId: string` | `removeFact` quando `forget` devolve `false` (inexistente **ou** de outro usuário) |

## Validação na borda

| Campo | Regra | Origem |
|-------|-------|--------|
| `userId` (body/query) | string, trim, 1..128 | `userIdSchema` (compartilhado com `/chat`) |
| `fact` (body) | string, trim, 1..500 | `factSchema` (compartilhado com `remember_fact`) |
| `id` (path) | UUID | `z.uuid()` |

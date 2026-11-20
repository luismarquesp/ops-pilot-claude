# Contract: `/memories`

Montado por `createApp` apenas quando `AppDeps.memory` está presente. Sem
autenticação (spec, Assumptions). Erros de validação usam o formato do `/chat`:
`400 { "issues": [...] }`.

Tipo `Memory`:

```json
{ "id": "uuid", "userId": "luis", "fact": "É responsável pelo checkout.", "createdAt": "2026-10-02T12:00:00.000Z" }
```

## POST /memories

```http
POST /memories
Content-Type: application/json

{ "userId": "luis", "fact": "  É responsável pelo checkout.  " }
```

| Status | Quando | Corpo |
|--------|--------|-------|
| 201 | Fato novo guardado (texto com trim) | `{ "memory": Memory }` |
| 200 | Já existia fato equivalente (similaridade > 0,92) | `{ "memory": <Memory existente> }` |
| 400 | `userId`/`fact` ausentes ou fora das regras | `{ "issues": [...] }` |
| 422 | `fact` contém padrão de segredo | `{ "error": "secret_detected" }` (sem ecoar o texto) |
| 500 | Falha do modelo de embeddings | `{ "error": "internal_error" }` |

## GET /memories?userId=luis

| Status | Quando | Corpo |
|--------|--------|-------|
| 200 | Sempre que `userId` for válido (inclusive sem fatos) | `{ "memories": Memory[] }`, do mais recente para o mais antigo |
| 400 | `userId` ausente/inválido | `{ "issues": [...] }` |

## DELETE /memories/:id?userId=luis

| Status | Quando | Corpo |
|--------|--------|-------|
| 204 | Fato `id` pertencia a `userId` e foi removido | — |
| 404 | `id` inexistente **ou** de outro usuário (indistinguíveis) | `{ "error": "memory_not_found", "id": "<id enviado>" }` |
| 400 | `id` não é UUID ou `userId` ausente/inválido | `{ "issues": [...] }` |

## Assinaturas internas

```ts
// src/http/schemas.ts
export const userIdSchema: z.ZodString;            // trim, 1..128

// src/memory/memory-tools.ts
export const factSchema: z.ZodString;              // trim, 1..500 (também usado por remember_fact)

// src/services/memory-service.ts
export function registerFact(memory: MemoryStore, input: { userId: string; fact: string }): Promise<RememberResult>;
export function listFacts(memory: MemoryStore, userId: string): Promise<Memory[]>;
export function removeFact(memory: MemoryStore, input: { userId: string; memoryId: string }): Promise<void>;

// src/http/memory-routes.ts
export function createMemoryRouter(memory: MemoryStore): Router;
```

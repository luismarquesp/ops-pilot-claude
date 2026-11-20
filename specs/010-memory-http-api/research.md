# Research: API HTTP de Memória

Fase 0 do plano. Não há `NEEDS CLARIFICATION` na spec; as seções abaixo fecham
as decisões de design.

## §1 — Camadas

- **Decision**:
  - **Model**: `MemoryStore` ganha `list(userId): Promise<Memory[]>`, implementado
    no `SqliteMemoryStore` com `SELECT ... WHERE user_id = ? ORDER BY created_at DESC, rowid DESC`
    (prepared statement, sem ler o BLOB).
  - **Service**: `src/services/memory-service.ts` com três funções finas sobre o
    `MemoryStore`:
    - `registerFact(memory, { userId, fact })` lança `SecretDetectedError` se
      `containsSecret(fact)`; senão, chama `remember`.
    - `listFacts(memory, userId)` chama `list`.
    - `removeFact(memory, { userId, memoryId })` lança `MemoryNotFoundError` se
      `forget` devolver `false`.
  - **Controller**: `src/http/memory-routes.ts` → `createMemoryRouter(memory): Router`,
    que só valida com zod, chama o Service e traduz os erros em status. O
    `createApp` o monta em `/memories` quando `deps.memory` existe.
- **Rationale**: o Princípio III exige regra de negócio no Service (barreira de
  segredo, "não encontrado") e nada de regra no Controller. O Princípio IV pede
  erros de domínio como classes traduzidas só na borda. Um router separado
  mantém o `server.ts` focado no `/chat`.
- **Alternatives considered**: handlers direto no `server.ts` (mistura dois
  recursos num arquivo já longo); chamar o `MemoryStore` direto do Controller
  (a barreira de segredo seria regra de negócio no Controller).

## §2 — Erros de domínio novos

- **Decision**: em `src/services/errors.ts`, criar:
  - `SecretDetectedError`, sem campos e com mensagem genérica (`"Fato contém um possível segredo"`), **sem** o texto;
  - `MemoryNotFoundError(memoryId)`.

  Tradução no router:
  - `SecretDetectedError` → `422 { error: "secret_detected" }`;
  - `MemoryNotFoundError` → `404 { error: "memory_not_found", id }`.
- **Rationale**: o 422 já é o código do projeto para "entendi, mas não posso
  processar" (`unknown_strategy`), distinto do 400 de schema (FR-004). O 404 não
  diferencia fato alheio de inexistente (FR-007), e o `id` devolvido é o que o
  próprio cliente enviou, então não vaza nada.
- **Alternatives considered**: 400 para segredo (confunde com erro de schema);
  403 para fato alheio (revela que o id existe).

## §3 — Validação (zod) e reaproveitamento de schemas

- **Decision**: `src/http/schemas.ts` exporta
  `userIdSchema = z.string().trim().min(1).max(128)`, usado pelo `/chat` (que
  substitui a definição inline) e pelo router. O schema de fato
  (`z.string().trim().min(1).max(500)`) passa a ser exportado como `factSchema` de
  `src/memory/memory-tools.ts`, usado pela tool `remember_fact` e pelo
  `POST /memories`. O id é validado com `z.uuid()`. Schemas por rota:
  - `POST`: body `z.object({ userId: userIdSchema, fact: factSchema })`.
  - `GET`: query `z.object({ userId: userIdSchema })`.
  - `DELETE`: params `z.object({ id: z.uuid() })` + query `z.object({ userId: userIdSchema })`.

  Qualquer falha → `400 { issues }`, mesmo formato do `/chat`.
- **Rationale**: FR-008 pede as mesmas regras do chat e das ações. Uma única
  definição evita divergência.
- **Alternatives considered**: duplicar os schemas (vão divergir com o tempo).

## §4 — Formato das respostas

- **Decision**:
  - `POST` → `201` (criado) ou `200` (duplicado), com corpo `{ "memory": Memory }`.
  - `GET` → `200 { "memories": Memory[] }`.
  - `DELETE` → `204`, sem corpo.

  `Memory` = `{ id, userId, fact, createdAt }`, o tipo da 008, que nunca expõe o
  vetor.
- **Rationale**: o corpo envelopado (`memory`/`memories`) deixa espaço para
  campos futuros (paginação) sem quebrar clientes. O status já distingue
  criado/duplicado (FR-003), sem precisar de um campo `created`.
- **Alternatives considered**: devolver `RememberResult` cru (`{ memory, created }`;
  redundante com o status).

## §5 — Montagem condicional e falhas

- **Decision**: sem `deps.memory`, o `/memories` não é montado (404 do Express).
  Falha do embedder no `POST` propaga até a rede de segurança existente →
  `500 { error: "internal_error" }`. `GET` e `DELETE` não usam o embedder.
- **Rationale**: é consistente com o `/chat`, que aceita `userId` sem `memory`
  mas não lembra nada. Aqui não há comportamento útil sem memória, então a rota
  simplesmente não existe.

## §6 — Testes

- **Decision**:
  1. `memory-store.test.ts`: `list` em ordem decrescente, isolamento, lista vazia,
     sem chamar o embedder e sem campo `embedding`.
  2. `memory-service.test.ts`: segredo → `SecretDetectedError` sem gravar (e sem
     chamar o embedder); `removeFact` alheio/inexistente →
     `MemoryNotFoundError`.
  3. `memory-routes.test.ts` (HTTP real em porta efêmera, como o `server.test.ts`),
     com `SqliteMemoryStore(":memory:")` + fake embedder. Cobre:
     - os status 201/200/400/422 do `POST`;
     - o `GET` ordenado e isolado;
     - os status 204/404/400 do `DELETE`;
     - integração com o chat: fato do `POST` aparece no prompt de `/chat` com o
       mesmo `userId` (SC-005);
     - `/memories` ausente quando `memory` não é passado.
  4. O teste do `/chat` continua verde com `userIdSchema` extraído.

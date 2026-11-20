# Implementation Plan: API HTTP de Memória

**Branch**: `010-memory-http-api` | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/010-memory-http-api/spec.md`

## Summary

Três rotas novas sobre o `MemoryStore` da 008, sem LLM:
- `POST /memories` faz `remember` com dedup. Responde 201 se criou e 200 se o fato já existia, e 422 `secret_detected` pela barreira `containsSecret` da 009.
- `GET /memories?userId=` lista os fatos do usuário, do mais recente para o mais antigo. Usa uma operação nova, `MemoryStore.list`.
- `DELETE /memories/:id?userId=` remove só fatos do próprio usuário. Responde 204 se removeu e 404 indistinguível se o fato não existe ou é de outro usuário.

As regras ficam num Service fino com erros de domínio, e um router dedicado só
valida (zod, schemas compartilhados com o `/chat` e a `remember_fact`) e traduz.
Ver [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript (ESM, `strict: true`) sobre Node.js 22 LTS

**Primary Dependencies**: nenhuma nova — `express` (Router), `zod` v4

**Storage**: tabela `memories` existente; só uma query nova de leitura

**Testing**: `node:test` via `tsx`; HTTP real em porta efêmera com `SqliteMemoryStore(":memory:")` + `createFakeEmbedder`

**Target Platform**: servidor Node (Linux/Windows), processo único

**Project Type**: web-service (API HTTP)

**Performance Goals**: `GET`/`DELETE` são só SQL indexado por `user_id`; `POST` custa um embedding local (~10–50 ms)

**Constraints**: nenhuma chamada ao LLM; nenhum vetor na resposta; nenhum texto de segredo ecoado; `/chat` inalterado

**Scale/Scope**: dezenas a poucas centenas de fatos por usuário, sem paginação

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Status | Como o design atende |
|-----------|--------|----------------------|
| I. Validação na Fronteira (Zod) | ✅ | body/query/params validados com zod; `userIdSchema` e `factSchema` compartilhados (FR-008) |
| II. Test-First | ✅ | Testes de `list`, do Service e das rotas HTTP antes da implementação |
| III. Camadas (MVC) | ✅ | SQL só no `SqliteMemoryStore`; barreira de segredo e "não encontrado" no Service; router só valida e traduz |
| IV. Erros como classes na borda | ✅ | `SecretDetectedError` e `MemoryNotFoundError` em `services/errors.ts`, traduzidos só no router |
| V. Funções puras | ✅ | Service sem estado (recebe o `MemoryStore`); `containsSecret` puro (reaproveitado) |
| VI. Segredos | ✅ | Fatos com padrão de segredo nunca são gravados nem ecoados na resposta |
| Stack | ✅ | Sem dependências novas |

**Re-check pós-design**: ✅ nenhuma violação.

## Project Structure

### Documentation (this feature)

```text
specs/010-memory-http-api/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── memories-api.md
├── checklists/requirements.md
└── tasks.md                 # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── memory/
│   ├── memory-store.ts            # + list(userId) na interface e no SqliteMemoryStore
│   ├── memory-store.test.ts       # + casos de list
│   └── memory-tools.ts            # exporta factSchema (usado por remember_fact)
├── services/
│   ├── errors.ts                  # + SecretDetectedError, MemoryNotFoundError
│   ├── memory-service.ts          # NOVO: registerFact, listFacts, removeFact
│   └── memory-service.test.ts     # NOVO
├── http/
│   ├── schemas.ts                 # NOVO: userIdSchema (compartilhado)
│   ├── memory-routes.ts           # NOVO: createMemoryRouter(memory)
│   ├── memory-routes.test.ts      # NOVO
│   └── server.ts                  # usa userIdSchema; monta /memories quando há memory
└── index.ts                       # sem mudança (já passa memory ao createApp)
```

Também: [AGENTS.md](../../AGENTS.md), com as rotas `/memories` na seção "Memória semântica".

**Structure Decision**: segue as camadas já usadas: Model em `src/memory/`,
Service em `src/services/` e Controller em `src/http/`. O router separado evita
inchar o `server.ts`, e o `createApp` só o monta.

## Complexity Tracking

Nenhuma violação a justificar.

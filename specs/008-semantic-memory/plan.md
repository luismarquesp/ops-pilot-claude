# Implementation Plan: Memória Semântica por Usuário

**Branch**: `008-semantic-memory` | **Date**: 2026-09-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/008-semantic-memory/spec.md`

## Summary

O OpsPilot ganha uma memória de fatos por usuário. O `MemoryStore` oferece
`remember` (sem duplicar quando a similaridade passa de 0,92), `recall` (top-3 por
produto escalar, com mínimo de 0,3) e `forget` (só do próprio usuário). Os fatos
ficam na tabela `memories` do mesmo `OPSPILOT_DB`, com o embedding do
`all-MiniLM-L6-v2` gravado como BLOB. O modelo roda localmente via
`@huggingface/transformers` (`pooling: "mean"`, `normalize: true`), carregado como
singleton preguiçoso. O `/chat` aceita um `userId` opcional. Quando ele vem, o
recall da mensagem é injetado no prompt pelo decorador puro `withMemory`
(composto por dentro do `withHistory`), e o agente recebe as tools `remember_fact`
e `forget_fact`, presas a esse usuário. A resposta ganha `metrics.memoryFacts`.
Ver [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript (ESM, `strict: true`) sobre Node.js 22 LTS

**Primary Dependencies**: **novo** `@huggingface/transformers` (v3; puxa `onnxruntime-node`); `express`, `zod` v4, `@langchain/*` (inalterados); `node:sqlite` e `node:crypto` nativos

**Storage**: SQLite via `node:sqlite` (`DatabaseSync`), nova tabela `memories` no mesmo arquivo `OPSPILOT_DB`; `:memory:` nos testes

**Testing**: `node:test` via `tsx`; embedder fake com tabela explícita para as regras; um teste com o modelo real (pulável com `OPSPILOT_SKIP_MODEL_TESTS=1`)

**Target Platform**: servidor Node (Linux/Windows), processo único

**Project Type**: web-service (API HTTP de um agente)

**Performance Goals**: recall < 1 s por turno após o primeiro uso (SC-007): 1 embedding (~10–50 ms na CPU) + varredura linear de centenas de vetores de 384 dimensões (< 1 ms)

**Constraints**: estratégias existentes sem mudança de contrato; `arena`/`bench`/MCP intactos; sem `userId`, comportamento idêntico (SC-005); nenhum fato sai da máquina (FR-012)

**Scale/Scope**: poucos operadores; dezenas a poucas centenas de fatos por usuário

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Status | Como o design atende |
|-----------|--------|----------------------|
| I. Validação na Fronteira (Zod) | ✅ | `userId` no `chatRequestSchema`; `fact`/`memoryId` validados por zod nas tools (fronteira LLM → domínio) |
| II. Test-First | ✅ | Testes puros (similaridade, blob, prompt), store sobre `:memory:` + embedder fake, integração HTTP e o teste do modelo real para FR-004 |
| III. Camadas (MVC) | ✅ | SQL só em `SqliteMemoryStore` (Model); o turno em `runChat` (Service); o Controller valida e escolhe o registry via `strategiesFor` |
| IV. Erros como classes na borda | ✅ | Nenhum erro de domínio novo: `forget` de id alheio devolve `false`. Falha do embedder cai na rede de segurança (500) |
| V. Funções puras | ✅ | `dot`, `rankBySimilarity`, `findDuplicate`, `toBlob`/`fromBlob`, `formatQuestionWithMemory` e `withMemory` são puros; I/O isolado no store e no embedder |
| VI. Segredos | ✅ | Nenhum segredo novo; o modelo é público e baixado sem credencial |
| Stack (node:sqlite, DDL idempotente) | ✅ | `CREATE TABLE/INDEX IF NOT EXISTS`, `DatabaseSync` nativo, sem extensão vetorial |

**Re-check pós-design**: ✅ nenhuma violação. Há uma dependência nova pesada,
registrada em Complexity Tracking por transparência.

## Project Structure

### Documentation (this feature)

```text
specs/008-semantic-memory/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── chat-api.md          # emenda ao contrato do specs/007
│   ├── memory-store.md      # Embedder, MemoryStore, funções puras
│   └── memory-tools.md      # remember_fact / forget_fact
├── checklists/requirements.md
└── tasks.md                 # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── memory/                              # NOVO diretório (caminhos pedidos pelo usuário)
│   ├── embeddings.ts                    # Embedder, EMBEDDING_MODEL, createLocalEmbedder (lazy singleton)
│   ├── embeddings.test.ts               # modelo real: fato × pergunta sem palavra em comum
│   ├── fake-embedder.ts                 # createFakeEmbedder(table) — só testes
│   ├── similarity.ts                    # dot, rankBySimilarity, findDuplicate, toBlob/fromBlob
│   ├── similarity.test.ts
│   ├── memory-store.ts                  # tipos, constantes, MemoryStore, SqliteMemoryStore (tabela memories)
│   ├── memory-store.test.ts             # :memory: + fake; persistência em arquivo temporário
│   ├── memory-prompt.ts                 # formatQuestionWithMemory, withMemory
│   ├── memory-prompt.test.ts
│   ├── memory-tools.ts                  # createMemoryTools(memory, userId)
│   └── memory-tools.test.ts
├── services/
│   ├── chat-service.ts                  # userId/memory → recall, withMemory, metrics.memoryFacts
│   └── chat-service.test.ts             # novos casos
├── http/
│   ├── server.ts                        # userId no schema; createApp(deps: AppDeps, opts)
│   └── server.test.ts                   # adapta para strategiesFor + casos de userId
└── index.ts                             # compõe embedder, SqliteMemoryStore e strategiesFor (registry base memoizado)
```

Também: `package.json` (+ `@huggingface/transformers`) e `AGENTS.md` (seção
"Memória semântica" e tools novas).

**Structure Decision**: projeto único existente. A memória fica em `src/memory/`,
como pedido, e contém o próprio Model (`SqliteMemoryStore`) por coesão da feature.
Ela continua sendo a única camada que fala SQL para `memories`. O Controller troca
o `Map` fixo pela fábrica `strategiesFor(userId?)`, porque as tools de memória
dependem do usuário do turno (research §7).

## Complexity Tracking

| Item | Por que é necessário | Alternativa mais simples descartada porque |
|------|----------------------|--------------------------------------------|
| Dependência `@huggingface/transformers` (+ binário `onnxruntime-node`, modelo de ~90 MB no primeiro uso) | FR-012 exige embeddings locais, e o usuário fixou o modelo e a biblioteca | Embeddings via API enviam os fatos para fora (viola FR-012). A constituição só veta terceiros **para SQLite** |
| `createApp` passa a receber `strategiesFor(userId?)` em vez de `Map` | As tools precisam do `userId` fixo na closure para garantir o isolamento | `AsyncLocalStorage` cria estado implícito (Princípio V), e um `userId` como argumento da tool deixaria o LLM trocar de usuário |

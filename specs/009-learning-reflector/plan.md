# Implementation Plan: Refletor de Aprendizado

**Branch**: `009-learning-reflector` | **Date**: 2026-09-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/009-learning-reflector/spec.md`

## Summary

Depois de cada turno bem-sucedido do `/chat` com `userId`, o `runChat` dispara
`learn({ userId, message })` **sem await**. O `learnFromMessage` funciona assim:
- Se a mensagem contém um segredo, nada é aprendido e o LLM nem é chamado.
- Caso contrário, o extrator (`createModel().withStructuredOutput({ hasLearning, fact })`)
  olha só a mensagem do usuário e o `toLearnableFact`, uma função pura, filtra o
  fato proposto (vazio, mais de 500 caracteres ou com padrão de segredo).
- O fato que sobra vai para `memory.remember`, com o dedup da 008.
- Falhas nunca chegam à resposta; vão para o log só com o nome do erro.

A tool `forget_fact` é substituída por `forget_preference { description }`, que
esquece o fato do usuário mais parecido com a descrição (`recall` com k = 1 e
mínimo 0,3). Os ids saem do prompt. O contrato HTTP não muda. Ver
[research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript (ESM, `strict: true`) sobre Node.js 22 LTS

**Primary Dependencies**: nenhuma nova — `@langchain/openai` (`withStructuredOutput`, já usado pelo crítico da reflexão), `zod` v4, `@huggingface/transformers` (via memória da 008)

**Storage**: tabela `memories` existente (specs/008); sem mudança de schema

**Testing**: `node:test` via `tsx`; extrator fake + `SqliteMemoryStore(":memory:")` + fake embedder; eval manual do extrator real em `src/memory/learning-eval.ts` (fora do `npm test`)

**Target Platform**: servidor Node (Linux/Windows), processo único

**Project Type**: web-service (API HTTP de um agente)

**Performance Goals**: nenhum acréscimo à latência da resposta (o aprendizado roda depois, sem await); +1 chamada ao LLM por turno com `userId`, exceto quando a mensagem contém segredo

**Constraints**: nenhum segredo chega à memória (duas barreiras); nenhum conteúdo do usuário em log; arena/bench/MCP intactos

**Scale/Scope**: poucos operadores; 1 fato no máximo por turno

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Status | Como o design atende |
|-----------|--------|----------------------|
| I. Validação na Fronteira (Zod) | ✅ | A saída do LLM é validada pelo schema zod do `withStructuredOutput`. `forget_preference` valida `description` com zod. O `/chat` não muda |
| II. Test-First | ✅ | Testes puros (segredos, `toLearnableFact`), pipeline com fakes, disparo assíncrono no `runChat`, tools e Controller; eval separado para as metas percentuais |
| III. Camadas (MVC) | ✅ | Nenhum SQL novo (usa `MemoryStore`); a orquestração fica no Service (`runChat` + `learnFromMessage`); o Controller só repassa `learn` |
| IV. Erros como classes na borda | ✅ | Nenhum erro novo chega à borda: `learnFromMessage` converte tudo em `"failed"` (o aprendizado é best-effort, fora do caminho da resposta) |
| V. Funções puras | ✅ | `containsSecret`, `toLearnableFact` e `formatQuestionWithMemory` são puros; I/O (LLM, memória, log) é injetado |
| VI. Segredos Nunca Expostos | ✅ | Reforçado: barreira dupla contra segredos na memória, extrator não chamado quando a mensagem contém segredo, log sem conteúdo |
| Stack | ✅ | Sem dependências novas |

**Re-check pós-design**: ✅ nenhuma violação.

## Project Structure

### Documentation (this feature)

```text
specs/009-learning-reflector/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── learning.md         # containsSecret, toLearnableFact, learnFromMessage, ChatDeps.learn
│   └── memory-tools.md     # forget_preference substitui forget_fact (supera o da 008)
├── checklists/requirements.md
└── tasks.md                # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── memory/
│   ├── secrets.ts                 # NOVO: containsSecret (puro)
│   ├── secrets.test.ts            # NOVO
│   ├── learning.ts                # NOVO: tipos, toLearnableFact, learnFromMessage, defaultLearningExtractor, logLearningFailure
│   ├── learning.test.ts           # NOVO
│   ├── learning-eval.ts           # NOVO: eval do extrator real (SC-001..003), fora do npm test
│   ├── memory-tools.ts            # forget_fact → forget_preference (+ forgetPreference exportada)
│   ├── memory-tools.test.ts       # casos de forget_preference; remove os de forget_fact
│   ├── memory-prompt.ts           # fatos sem [id]
│   └── memory-prompt.test.ts      # formato sem id
├── services/
│   ├── chat-service.ts            # ChatDeps.learn, disparo sem await após sucesso
│   └── chat-service.test.ts       # não espera, chamado só no sucesso com userId, sem unhandledRejection; ajusta asserts de [id]
├── http/
│   ├── server.ts                  # AppDeps.learn → runChat
│   └── server.test.ts             # learn recebe o userId; ajusta asserts de [id]
└── index.ts                       # compõe learn = learnFromMessage(…, defaultLearningExtractor, logLearningFailure)
```

Também: [AGENTS.md](../../AGENTS.md), com o refletor na seção "Memória semântica" e
`forget_preference` no lugar de `forget_fact`.

**Structure Decision**: o aprendizado fica em `src/memory/` por coesão com a
memória da 008. O disparo fica no `runChat` (Service), injetado como função, para
manter o Controller fino e os testes sem rede.

## Complexity Tracking

Nenhuma violação a justificar.

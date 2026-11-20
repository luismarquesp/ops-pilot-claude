---

description: "Task list template for feature implementation"
---

# Tasks: Camada de Reflexão sobre Estratégias de Raciocínio

**Input**: Design documents from `/specs/002-reflection-layer/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Testes são obrigatórios nesta feature — constitution Princípio II
(Test-First) e o próprio design (research.md §1: crítico e estratégia de base
injetáveis) tornam o núcleo de controle da reflexão 100% testável sem rede.

**Organization**: Tarefas agrupadas por user story (spec.md) para permitir
implementação e teste independentes de cada uma.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependência pendente)
- **[Story]**: A qual user story a tarefa pertence (US1, US2, US3)
- Caminhos de arquivo exatos em cada descrição

## Path Conventions

Single project (ver plan.md — Project Structure): tudo em `src/agents/`, com o teste
colocado ao lado do código testado (`src/agents/reflection.test.ts`), seguindo o glob
`src/**/*.test.ts` já usado por `npm test`.

## Phase 1: Setup

**Purpose**: confirmar que nada novo precisa ser instalado ou configurado

- [X] T001 Confirmar que nenhuma dependência ou variável de ambiente nova é necessária: `withReflection` reaproveita `@langchain/core`, `zod` e `src/agents/model.ts` (`createModel()`) já instalados/configurados pela feature 001 — nenhuma mudança em `package.json` ou `.env.example`

**Checkpoint**: nada bloqueando o início da fase Foundational

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: tipos compartilhados e o crítico padrão (LLM) — usados por toda user
story desta feature

**⚠️ CRITICAL**: nenhuma user story pode começar antes desta fase estar completa

- [X] T002 [P] Criar `src/agents/reflection.ts` com os tipos `CriticVerdict` (`{ approved: boolean; feedback?: string }`), `Critic` (`(input: { question; answer; observations }) => Promise<CriticVerdict>`), `ReflectionOptions` (`{ maxReflection?: number; critic?: Critic }`) e a constante `DEFAULT_MAX_REFLECTION = 2` (data-model.md, contracts/reflection.md)
- [X] T003 Implementar o crítico padrão em `src/agents/reflection.ts`: schema Zod `{ approved, feedback }`, e uma função que usa `createModel().withStructuredOutput(...)` com um prompt recebendo a pergunta original, a resposta gerada e as observações do rastro (research.md §5) — depende de T002 (FR-003)

**Checkpoint**: tipos e crítico padrão prontos — user stories podem começar

---

## Phase 3: User Story 1 - Resposta revisada antes de chegar ao plantonista (Priority: P1) 🎯 MVP

**Goal**: `withReflection(strategy, opts)` roda a estratégia de base, tem a resposta
avaliada por um crítico, e regenera com o feedback quando reprovada, até aprovar.

**Independent Test**: com uma estratégia de base falsa e um crítico falso (sem LLM
real), verificar que uma reprovação seguida de aprovação produz exatamente uma
regeneração, que o feedback do crítico chega à pergunta da regeneração, e que a
resposta final é a aprovada.

### Tests for User Story 1 ⚠️

> **Escrever estes testes PRIMEIRO, garantir que falham antes de implementar**

- [X] T004 [P] [US1] Testes do loop de reflexão em `src/agents/reflection.test.ts`, usando uma `ReasoningStrategy` falsa (sem LLM) e um `Critic` falso injetados via `opts`: (a) crítico aprova na 1ª avaliação → nenhuma regeneração, resposta = a primeira gerada; (b) crítico reprova e depois aprova → exatamente 1 regeneração, resposta final = a aprovada; (c) a pergunta usada na regeneração incorpora a resposta anterior e o `feedback` do crítico (research.md §2); (d) o `trace` resultante é a concatenação, em ordem, do `trace` de cada geração com um evento `critique` após cada avaliação (FR-007)

### Implementation for User Story 1

- [X] T005 [US1] Implementar `withReflection(strategy, opts)` em `src/agents/reflection.ts`: `name` = `reflect:<strategy.name>`; laço gera → avalia (crítico de T003 por padrão, ou `opts.critic`) → se reprovado, regenera com pergunta derivada (resposta anterior + feedback) → reavalia; `metrics.llmCalls`/`latencyMs` somam todas as gerações e avaliações (FR-002, FR-004, FR-008) — depende de T002, T003, T004 (falhando)

**Checkpoint**: US1 completa e testável isoladamente (loop de reflexão funcional, sem depender da arena)

---

## Phase 4: User Story 2 - Comparar uma estratégia com e sem reflexão na arena (Priority: P2)

**Goal**: a arena permite selecionar `reflect:react` e `reflect:plan-and-execute` como
estratégias próprias, ao lado de `react` e `plan-and-execute`.

**Independent Test**: rodar a arena selecionando `react,reflect:react` sobre o mesmo
input e verificar que ambas aparecem na saída, cada uma com seu próprio rastro e
métricas.

### Implementation for User Story 2

- [X] T006 [US2] Registrar `reflect:react` e `reflect:plan-and-execute` em `src/arena.ts` (array `available`), envolvendo `createReactStrategy(tools)`/`createPlanAndExecuteStrategy(tools)` com `withReflection(...)` (contracts/reflection.md, FR-009) — depende de T005

**Checkpoint**: as quatro estratégias (`react`, `plan-and-execute`, `reflect:react`, `reflect:plan-and-execute`) são selecionáveis na arena

---

## Phase 5: User Story 3 - A revisão nunca roda descontroladamente (Priority: P3)

**Goal**: garantir, com testes determinísticos, que o ciclo de reflexão nunca
ultrapassa `maxReflection` rodadas e nunca propaga uma falha do crítico para fora do
contrato `ReasoningStrategy`.

**Independent Test**: configurar um crítico falso que sempre reprova e verificar que a
execução ainda assim termina após exatamente `maxReflection` avaliações, retornando a
última resposta gerada.

### Tests for User Story 3 ⚠️

- [X] T007 [P] [US3] Testes de limite em `src/agents/reflection.test.ts`: (a) crítico que sempre reprova → exatamente `maxReflection` avaliações e `maxReflection + 1` gerações da estratégia de base, resposta final = a última gerada (FR-005/FR-006, research.md §3); (b) `maxReflection: 0` → nenhuma avaliação ocorre, resposta idêntica à da estratégia de base (edge case da spec); (c) crítico falso que lança uma exceção → `run()` não propaga o erro, encerra com a última resposta válida conhecida e registra a falha como um evento `critique` no rastro (research.md §4) — depende de T005

**Checkpoint**: as três user stories funcionam de forma independente e testável

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: validação final cruzando todas as user stories

- [X] T008 [P] Rodar `npm run typecheck` e corrigir quaisquer erros de tipo introduzidos pela feature (constitution Princípio II)
- [X] T009 [P] Rodar `npm test` e confirmar que todos os testes passam sem qualquer acesso à rede (mesmo padrão da feature 001)
- [X] T010 Executar manualmente o roteiro de `quickstart.md` (rodar `reflect:react` isolado, comparar `react,reflect:react`, e confirmar visualmente o teto de rodadas com `reflect:plan-and-execute`) e corrigir qualquer divergência encontrada

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências — pode começar imediatamente
- **Foundational (Phase 2)**: depende do Setup — BLOQUEIA todas as user stories
- **User Story 1 (Phase 3)**: depende só do Foundational
- **User Story 2 (Phase 4)**: depende de `withReflection` (T005, US1) já existir — não é independente de US1, pois é literalmente a exposição dele na arena
- **User Story 3 (Phase 5)**: depende de `withReflection` (T005, US1) já existir; independente de US2 (pode ser feita em paralelo, já que não toca `arena.ts`)
- **Polish (Phase 6)**: depende de todas as user stories desejadas estarem completas

### User Story Dependencies

- **US1 (P1)**: independente das outras stories — é o MVP (o loop de reflexão em si)
- **US2 (P2)**: consome `withReflection` de US1; adiciona apenas o registro na arena
- **US3 (P3)**: consome `withReflection` de US1; adiciona apenas testes de limite —
  pode ser feita em paralelo com US2, já que não depende dela

### Within Each User Story

- Testes são escritos e DEVEM falhar antes da implementação correspondente
- Tipos/crítico padrão (Foundational) antes do loop de reflexão (US1)
- Loop de reflexão (US1) antes de expô-lo na arena (US2) ou testar seus limites (US3)

### Parallel Opportunities

- T002 pode começar assim que o Setup terminar; T003 depende de T002 (mesmo arquivo)
- T004 (testes de US1) pode ser escrito em paralelo com T002/T003, já que usa dublês, não o crítico real — mas T005 (implementação) só fecha depois que T002/T003 existirem
- Assim que T005 estiver pronto, T006 (US2) e T007 (US3) podem rodar em paralelo — arquivos diferentes (`arena.ts` vs. `reflection.test.ts`), sem dependência entre si
- T008 e T009 (Polish) podem rodar em paralelo

---

## Parallel Example: Após T005 (withReflection pronto)

```bash
Task: "Registrar reflect:react e reflect:plan-and-execute em src/arena.ts"
Task: "Testes de limite (maxReflection, erro do crítico) em src/agents/reflection.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 apenas)

1. Completar Phase 1 (Setup) e Phase 2 (Foundational)
2. Completar Phase 3 (US1): loop de reflexão completo e testado com dublês
3. **PARAR e VALIDAR**: `npm test` cobrindo aprovação imediata, reprovação+aprovação, e feedback incorporado
4. Esse é o MVP demonstrável da camada de reflexão (ainda sem exposição na arena)

### Incremental Delivery

1. Setup + Foundational → tipos e crítico padrão prontos
2. US1 → validar o loop isoladamente com dublês → lógica de reflexão confiável
3. US2 → expor na arena → comparação com/sem reflexão possível (quickstart.md, passo 2)
4. US3 → validar os limites (teto, erro do crítico) → confiança para usar em produção
5. Polish → `typecheck` + `test` verdes, quickstart validado manualmente com LLM real

## Notes

- `[P]` = arquivos diferentes, sem dependência pendente entre as tarefas
- `[Story]` mapeia a tarefa à user story correspondente da spec, para rastreabilidade
- Verificar que os testes falham antes de implementar (Test-First, constitution Princípio II)
- Nenhum teste automatizado (`npm test`) deve chamar o modelo de linguagem real — o
  crítico padrão (LLM real) só é exercitado manualmente via `quickstart.md`, assim
  como `react.ts`/`plan-and-execute.ts` na feature 001

---

description: "Task list template for feature implementation"
---

# Tasks: Endpoint HTTP de Chat sobre o Núcleo de Raciocínio

**Input**: Design documents from `/specs/003-chat-endpoint/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Testes são obrigatórios nesta feature — FR-010 exige testes de integração
do endpoint com uma estratégia falsa determinística, sem rede (constitution
Princípio II).

**Organization**: Tarefas agrupadas por user story (spec.md) para permitir
implementação e teste independentes de cada uma.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependência pendente)
- **[Story]**: A qual user story a tarefa pertence (US1, US2, US3)
- Caminhos de arquivo exatos em cada descrição

## Path Conventions

Single project (ver plan.md — Project Structure): `src/agents/index.ts` (registro),
`src/http/server.ts` + `src/http/server.test.ts` (Controller e seu teste, lado a
lado, seguindo o glob `src/**/*.test.ts` já usado por `npm test`), `src/index.ts`
(bootstrap).

## Phase 1: Setup

**Purpose**: preparar o único ajuste de configuração necessário

- [X] T001 [P] Adicionar `PORT=` ao `.env.example` (porta HTTP do servidor, não sensível — sem mudança em dependências, `express`/`zod` já instalados)

**Checkpoint**: nada bloqueando o início da fase Foundational

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: o registro de estratégias — usado por toda user story desta feature

**⚠️ CRITICAL**: nenhuma user story pode começar antes desta fase estar completa

- [X] T002 [P] Criar `src/agents/index.ts`: `createStrategyRegistry(tools)` retornando `Map<string, ReasoningStrategy>` com as entradas `react` e `plan-and-execute` (via `createReactStrategy`/`createPlanAndExecuteStrategy` já existentes), e a constante `DEFAULT_STRATEGY_NAME = "react"` (contracts/strategy-registry.md, FR-008)

**Checkpoint**: registro pronto — user stories podem começar

---

## Phase 3: User Story 1 - Perguntar ao OpsPilot por HTTP e receber resposta, rastro e métricas (Priority: P1) 🎯 MVP

**Goal**: `POST /chat` com só `message` roda a estratégia padrão e responde 200 com
`answer`/`trace`/`metrics`.

**Independent Test**: com uma `ReasoningStrategy` falsa e determinística injetada no
lugar do registro real, enviar uma requisição só com `message` e verificar que a
resposta 200 reflete exatamente o resultado canônico da falsa.

### Tests for User Story 1 ⚠️

> **Escrever estes testes PRIMEIRO, garantir que falham antes de implementar**

- [X] T003 [P] [US1] Teste de integração em `src/http/server.test.ts`: subir `createApp(registry)` com um registro `Map` contendo só uma `ReasoningStrategy` falsa e determinística (nome `"react"`, `run()` retorna um `StrategyResult` fixo, sem LLM); `app.listen(0)`; `POST /chat` só com `message` via `fetch` nativo → `200` com `answer`/`trace`/`metrics` idênticos ao resultado fixo da falsa (FR-001, FR-004)

### Implementation for User Story 1

- [X] T004 [US1] Implementar `createApp(registry, opts?)` em `src/http/server.ts`: schema Zod do corpo (`message` obrigatório e não vazio), rota `POST /chat` resolvendo `strategy ?? DEFAULT_STRATEGY_NAME` no registro e respondendo `200` com `{ answer, trace, metrics }` do resultado — só o caminho de sucesso por enquanto (contracts/chat-api.md) — depende de T002, T003 (falhando)
- [X] T005 [US1] Escrever o bootstrap real em `src/index.ts`: montar o store (`createJsonIncidentsStore` sobre `src/models/seed-data.json`), as tools (`createOpsTools`), o registro (`createStrategyRegistry`), o app (`createApp`), e chamar `app.listen(process.env.PORT ?? 3000)` (research.md §5) — depende de T002, T004

**Checkpoint**: US1 completa e testável isoladamente (`npm run dev` sobe um servidor de verdade; o teste de integração cobre o caminho de sucesso sem rede)

---

## Phase 4: User Story 2 - Escolher estratégia e reflexão por requisição (Priority: P2)

**Goal**: `strategy` seleciona uma estratégia diferente da padrão; `reflect: true`
aplica `withReflection` sobre a estratégia resolvida.

**Independent Test**: com duas estratégias falsas registradas (nomes diferentes),
enviar a mesma pergunta variando `strategy` e `reflect`, e verificar que cada resposta
reflete exatamente a combinação pedida.

### Tests for User Story 2 ⚠️

- [X] T006 [P] [US2] Testes de integração em `src/http/server.test.ts`: (a) registro com duas estratégias falsas (`"react"` e `"outra"`); `POST /chat` com `strategy: "outra"` → a resposta reflete o resultado da falsa "outra", não a padrão (FR-003); (b) `POST /chat` com `reflect: true` sobre uma estratégia falsa injetada junto de um crítico falso que aprova de primeira → a resposta reflete a execução decorada por `withReflection` (`trace` inclui um evento `critique`, `metrics.llmCalls` soma a chamada extra do crítico) (FR-009)

### Implementation for User Story 2

- [X] T007 [US2] Estender o handler de `POST /chat` em `src/http/server.ts` para ler `strategy`/`reflect` do corpo validado, resolver a estratégia pedida (ou a padrão) no registro, e aplicar `withReflection(...)` sobre ela quando `reflect` for `true`, antes de rodar (FR-009, contracts/chat-api.md) — depende de T004, T006 (falhando)

**Checkpoint**: US1 e US2 funcionam juntas — cliente escolhe estratégia e reflexão livremente

---

## Phase 5: User Story 3 - Falhas de entrada e de execução são previsíveis (Priority: P3)

**Goal**: corpo inválido, estratégia desconhecida e timeout cada um com sua própria
resposta clara e distinguível (400/422/504).

**Independent Test**: enviar, isoladamente, um corpo sem `message`, um corpo com uma
estratégia inexistente, e (com um `timeoutMs` pequeno injetado) uma estratégia falsa
que nunca resolve, e verificar que cada um recebe um código e formato de resposta
diferentes.

### Tests for User Story 3 ⚠️

- [X] T008 [P] [US3] Testes de integração em `src/http/server.test.ts`: (a) `POST /chat` sem `message` (e com `message: ""`) → `400` com `{ issues }` do Zod apontando o campo (FR-005, edge case de string vazia); (b) `POST /chat` com `strategy` inexistente (com e sem `reflect: true` junto) → `422` com `{ error: "unknown_strategy", strategy, available }`, nunca uma tentativa de refletir (FR-006, edge case); (c) `createApp(registry, { timeoutMs: 20 })` com uma estratégia falsa cujo `run()` nunca resolve → `504` com `{ error: "timeout", timeoutMs: 20 }` dentro de um tempo curto de teste (FR-007)

### Implementation for User Story 3

- [X] T009 [US3] Adicionar a `src/http/server.ts`: validação do corpo com `safeParse` → `400` `{ issues: result.error.issues }` quando falha; checagem de estratégia desconhecida → `422` `{ error, strategy, available }` **antes** de aplicar `reflect`; corrida com `Promise.race` contra `opts.timeoutMs ?? 180_000` → `504` `{ error: "timeout", timeoutMs }`, descartando (com `.catch(() => {})`) o resultado tardio da estratégia; middleware de erro genérico → `500` `{ error: "internal_error" }` para qualquer falha inesperada (research.md §1/§4, contracts/chat-api.md) — depende de T007, T008 (falhando)

**Checkpoint**: as três user stories funcionam de forma independente e testável

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: validação final cruzando todas as user stories

- [X] T010 [P] Rodar `npm run typecheck` e corrigir quaisquer erros de tipo introduzidos pela feature (constitution Princípio II)
- [X] T011 [P] Rodar `npm test` e confirmar que todos os testes passam sem qualquer acesso à rede (mesmo padrão das features 001/002)
- [X] T012 Executar manualmente o roteiro de `quickstart.md` (subir `npm run dev`, os 4 `curl`s — sucesso, sucesso com estratégia+reflexão, 400, 422) e corrigir qualquer divergência encontrada
  - 400 e 422 confirmados exatamente como especificado (contracts/chat-api.md).
  - 200 com a estratégia padrão (`react`) confirmado com LLM real (2 chamadas, ~6.7s).
  - `strategy: "plan-and-execute"` + `reflect: true` juntos estourou o teto real de
    180s e recebeu `504 { "error": "timeout", "timeoutMs": 180000 }` corretamente —
    não é um bug: plan-and-execute encadeia várias chamadas sequenciais de LLM, e
    reflect adiciona pelo menos mais uma rodada por cima; a combinação das duas é
    genuinamente lenta. O servidor continuou saudável logo depois (uma requisição
    seguinte recebeu 400 normalmente, sem crash nem unhandled rejection nos logs) —
    valida FR-007 e o descarte fire-and-forget (research.md §1) com um caso real,
    não só sintético. Nenhuma ação corretiva tomada — 180s é o valor que a própria
    spec pediu; se isso for considerado curto demais na prática, é uma decisão de
    produto para uma futura revisão da spec, não um bug desta implementação.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências — pode começar imediatamente
- **Foundational (Phase 2)**: depende do Setup — BLOQUEIA todas as user stories
- **User Story 1 (Phase 3)**: depende só do Foundational
- **User Story 2 (Phase 4)**: depende de `createApp`/`POST /chat` (T004, US1) já existir — estende o mesmo handler, não é totalmente independente
- **User Story 3 (Phase 5)**: depende do handler já estender `strategy`/`reflect` (T007, US2), já que a checagem de estratégia desconhecida interage com o `reflect` (edge case: reflect + estratégia inexistente)
- **Polish (Phase 6)**: depende de todas as user stories desejadas estarem completas

### User Story Dependencies

- **US1 (P1)**: independente das outras stories — é o MVP (`POST /chat` só com `message`)
- **US2 (P2)**: estende o mesmo handler de US1 com `strategy`/`reflect`
- **US3 (P3)**: estende o mesmo handler de US2 com os três caminhos de erro — não é
  independente de US1/US2 nesta feature específica, já que os três casos de erro só
  fazem sentido depois que sucesso, seleção de estratégia e reflexão já existem

### Within Each User Story

- Testes são escritos e DEVEM falhar antes da implementação correspondente
- Registro (Foundational) antes do handler (US1)
- Caminho de sucesso (US1) antes de seleção de estratégia/reflexão (US2)
- Seleção de estratégia/reflexão (US2) antes dos caminhos de erro que dependem dela (US3)

### Parallel Opportunities

- T001 (Setup) e T002 (Foundational) podem rodar em paralelo — arquivos diferentes, sem dependência real entre si
- T010 e T011 (Polish) podem rodar em paralelo

---

## Parallel Example: Setup + Foundational

```bash
Task: "Adicionar PORT= ao .env.example"
Task: "Criar src/agents/index.ts com createStrategyRegistry(tools)"
```

---

## Implementation Strategy

### MVP First (User Story 1 apenas)

1. Completar Phase 1 (Setup) e Phase 2 (Foundational)
2. Completar Phase 3 (US1): `POST /chat` com estratégia padrão, `npm run dev` funcional
3. **PARAR e VALIDAR**: `curl` (quickstart.md, passo 2) e o teste de integração de US1
4. Esse é o MVP demonstrável do endpoint de chat

### Incremental Delivery

1. Setup + Foundational → registro pronto
2. US1 → validar o caminho de sucesso isoladamente → MVP pronto para uso
3. US2 → validar seleção de estratégia + reflexão → paridade com o que a `arena` já oferece
4. US3 → validar os três caminhos de erro → endpoint seguro para integração externa
5. Polish → `typecheck` + `test` verdes, quickstart validado de ponta a ponta

## Notes

- `[P]` = arquivos diferentes, sem dependência pendente entre as tarefas
- `[Story]` mapeia a tarefa à user story correspondente da spec, para rastreabilidade
- Verificar que os testes falham antes de implementar (Test-First, constitution Princípio II)
- Nenhum teste automatizado (`npm test`) deve chamar o modelo de linguagem real nem
  subir o store real — só o teste manual do `quickstart.md` (passo 6→7) usa o
  servidor de verdade com LLM real, mesmo padrão das features 001/002

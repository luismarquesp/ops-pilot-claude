---

description: "Task list template for feature implementation"
---

# Tasks: Núcleo de Raciocínio do OpsPilot

**Input**: Design documents from `/specs/001-reasoning-core/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Testes são obrigatórios nesta feature — FR-017 e o Princípio II
(Test-First) da [constitution](../../.specify/memory/constitution.md) exigem testes
determinísticos, sem rede, para o store e a formatação de rastro.

**Organization**: Tarefas agrupadas por user story (spec.md) para permitir
implementação e teste independentes de cada uma.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependência pendente)
- **[Story]**: A qual user story a tarefa pertence (US1, US2, US3)
- Caminhos de arquivo exatos em cada descrição

## Path Conventions

Single project (ver plan.md — Project Structure): `src/`, com testes `*.test.ts`
colocados ao lado do código testado (glob `src/**/*.test.ts`, já usado por `npm test`).

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: preparar dependências e estrutura antes de qualquer código de domínio

- [X] T001 Criar os diretórios `src/models/`, `src/services/` e `src/agents/` conforme `plan.md` (Project Structure)
- [X] T002 [P] Adicionar `sqlite3` como devDependency (`npm install --save-dev sqlite3`) — necessário para o dialeto Sequelize em memória usado pelos testes determinísticos (research.md §3)
- [X] T003 [P] Adicionar ao `.env.example` as variáveis de conexão MySQL que `src/models/sequelize.ts` vai ler (ex.: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`), ao lado de `OPENROUTER_API_KEY`/`OPEN_ROUTER_MODEL` já existentes

**Checkpoint**: dependências e estrutura prontas para a camada Foundational

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: infraestrutura e contratos de tipo que TODA user story depende — schema de
dados, modelos, erros de domínio e os tipos compartilhados do núcleo de raciocínio

**⚠️ CRITICAL**: nenhuma user story pode começar antes desta fase estar completa

- [X] T004 [P] Criar fábrica de conexão Sequelize em `src/models/sequelize.ts`: instância MySQL (via `mysql2`) lendo config de `process.env` para runtime (sem `dotenv` — constitution Princípio VI), e uma função auxiliar que cria uma instância Sequelize com dialeto `sqlite`/`storage: ":memory:"` para uso em testes (research.md §3)
- [X] T005 [P] Criar model `Service` em `src/models/service.model.ts` (`data-model.md`: `id`, `name` único e obrigatório)
- [X] T006 [P] Criar model `Incident` em `src/models/incident.model.ts` (`data-model.md`: `id`, `title`, `serviceId` com `belongsTo(Service)`, `severity` enum `low|medium|high|critical`, `status` enum `firing|resolved` default `firing`)
- [X] T007 [P] Criar classes de erro de domínio `ServiceNotFoundError` e `IncidentNotFoundError` em `src/services/errors.ts` (constitution Princípio IV)
- [X] T008 [P] Criar os tipos compartilhados do núcleo de raciocínio em `src/agents/strategy.ts`: `TraceEvent`, `Trace`, `Metrics`, `StrategyInput`, `StrategyResult` e a interface `ReasoningStrategy` (contracts/reasoning-strategy.md)
- [X] T009 [P] Criar a fábrica única do modelo de linguagem em `src/agents/model.ts`, lendo `OPENROUTER_API_KEY`/`OPEN_ROUTER_MODEL` via `process.env` (sem `dotenv`), `baseURL` da OpenRouter, temperatura 0 (FR-005)

**Checkpoint**: schema de dados, erros de domínio e contratos de tipo prontos — user stories podem começar

---

## Phase 3: User Story 1 - Investigar e resolver um incidente com uma estratégia de raciocínio (Priority: P1) 🎯 MVP

**Goal**: rodar a estratégia ReAct sobre o cenário semeado e obter uma resposta final
coerente mais o rastro completo do raciocínio.

**Independent Test**: semear o armazenamento, rodar a estratégia `react` com uma
pergunta sobre incidentes em aberto, e verificar que a resposta reflete os alertas
`firing` semeados e que o rastro mostra cada passo, na ordem correta.

### Tests for User Story 1 ⚠️

> **Escrever estes testes PRIMEIRO, garantir que falham antes de implementar**

- [X] T010 [P] [US1] Testes de `src/services/incidents.service.ts` (a implementar) em `src/services/incidents.service.test.ts`: `listAlerts` sem filtro retorna tudo, com filtro retorna só o status pedido, filtro sem correspondência retorna lista vazia; `openIncident` cria incidente `firing` e lança `ServiceNotFoundError` para serviço inexistente; `resolveIncident` marca como `resolved`, lança `IncidentNotFoundError` para id inexistente, e é idempotente ao resolver um incidente já `resolved` — usando a instância Sequelize sqlite em memória de T004
- [X] T011 [P] [US1] Teste de formatação de rastro em `src/agents/trace.test.ts`: cada tipo de `TraceEvent` (thought/action/observation/plan/critique/answer) é formatado de forma legível e a ordem de entrada é preservada na saída

### Implementation for User Story 1

- [X] T012 [US1] Implementar `src/services/incidents.service.ts` (`listAlerts`, `openIncident`, `resolveIncident`) usando os models de T005/T006 e os erros de T007 — depende de T005, T006, T007, T010 (falhando)
- [X] T013 [US1] Implementar o script de seed em `src/models/seed.ts`: popula exatamente 5 `Service` e 6 `Incident` (3 `firing`, 3 `resolved`) usando `incidents.service.ts` — depende de T012 (FR-009)
- [X] T014 [US1] Implementar a formatação de rastro em `src/agents/trace.ts` (função pura que converte `Trace`/`TraceEvent[]` em texto legível) — depende de T008, T011 (falhando)
- [X] T015 [US1] Implementar `src/agents/tools.ts`: schemas Zod e tools LangChain para `list_alerts`, `open_incident`, `resolve_incident`, chamando `incidents.service.ts` e traduzindo erros de domínio em observações de erro (nunca lançando para fora da tool) — depende de T008, T012 (contracts/tools.md, FR-006/FR-007)
- [X] T016 [US1] Implementar `src/agents/react.ts`: estratégia ReAct usando o agente pré-construído do LangGraph com as tools de T015, capturando o rastro completo via streaming de mensagens (research.md §1), respeitando `maxIterations` (default 8) e contando chamadas ao LLM via callback (research.md §4) — depende de T008, T009, T015

**Checkpoint**: US1 completa e demonstrável isoladamente (seed → `react` → resposta + rastro)

---

## Phase 4: User Story 2 - Comparar duas estratégias de raciocínio sobre o mesmo caso (Priority: P2)

**Goal**: rodar ReAct e Plan-and-Execute sobre o mesmo input e ver rastro + métricas de
ambas lado a lado.

**Independent Test**: rodar a `arena` selecionando as duas estratégias sobre o mesmo
input e verificar que a saída mostra, para cada uma, rastro completo e métricas,
respeitando o limite de iterações informado.

### Tests for User Story 2 ⚠️

- [X] T017 [P] [US2] Teste da regra pura de corte de passos do Plan-and-Execute em `src/agents/plan-and-execute.test.ts`: dado um número de passos já executados e uma decisão do replanejador, a função nunca permite continuar além de 8 passos (FR-012) — testável sem rede (constitution Princípio V)

### Implementation for User Story 2

- [X] T018 [US2] Implementar `src/agents/plan-and-execute.ts`: grafo LangGraph com nós `planner` (lista ordenada de passos via saída estruturada), `executor` (um passo por vez usando as tools de T015) e `replanner` (revisa passos restantes, decide continuar ou concluir), aplicando a regra de corte de T017 como checagem estrutural do grafo (não apenas instrução de prompt), capturando o rastro completo e contando chamadas ao LLM — depende de T008, T009, T015, T017 (falhando)
- [X] T019 [US2] Implementar `src/arena.ts`: CLI com flags `--strategies` e `--max-iterations` (contracts/arena-cli.md), resolvendo estratégias por `name` (`react`, `plan-and-execute`), executando as selecionadas sobre o mesmo input e imprimindo rastro (via `trace.ts`) + métricas + resposta de cada uma — depende de T014, T016, T018

**Checkpoint**: US1 e US2 funcionam juntas — a arena compara as duas estratégias

---

## Phase 5: User Story 3 - Confiar no comportamento das ferramentas sem depender de produção real (Priority: P3)

**Goal**: garantir, com testes determinísticos e sem rede, que o seed e as ações sobre
incidentes se comportam exatamente como esperado, independentemente de qualquer
estratégia de raciocínio.

**Independent Test**: rodar o script de seed sozinho (sem invocar nenhuma estratégia) e
verificar diretamente o conteúdo do armazenamento resultante.

### Tests for User Story 3 ⚠️

- [X] T020 [P] [US3] Teste do seed em `src/models/seed.test.ts`: após rodar, o armazenamento contém exatamente 5 `Service` e 6 `Incident` (3 `firing`, 3 `resolved`); rodar o seed uma segunda vez não duplica registros — depende de T013 (FR-009, spec.md US3 AC#1)
- [X] T021 [P] [US3] Teste de validação de schema em `src/agents/tools.test.ts`: cada tool (`list_alerts`, `open_incident`, `resolve_incident`) rejeita entrada inválida (severidade desconhecida, status desconhecido, id não positivo) e aceita entrada válida, sem invocar o modelo de linguagem — depende de T015 (FR-007)

### Implementation for User Story 3

- [X] T022 [US3] Ajustar `src/models/seed.ts` para ser idempotente (verificar/limpar antes de inserir, nunca duplicar ao rodar mais de uma vez) — depende de T013, T020 (falhando)

**Checkpoint**: as três user stories funcionam de forma independente e testável

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: validação final cruzando todas as user stories

- [X] T023 [P] Rodar `npm run typecheck` e corrigir quaisquer erros de tipo introduzidos pela feature (constitution Princípio II)
- [X] T024 [P] Rodar `npm test` e confirmar que todos os testes passam sem qualquer acesso à rede (FR-017, SC-005)
- [ ] T025 Executar manualmente o roteiro de `quickstart.md` (seed → `react` → comparação na arena) e corrigir qualquer divergência encontrada
  - Parcialmente verificado sem credenciais reais: `npx tsx src/arena.ts --strategies nonexistent` e `--max-iterations -1` retornam os erros esperados (contracts/arena-cli.md); `npx tsx src/models/seed.ts` tenta corretamente conectar ao MySQL em `127.0.0.1:3306` e falha de forma controlada (`ECONNREFUSED`) quando não há banco disponível — comportamento correto, não um bug.
  - Falta rodar de fato os passos 1–3 do quickstart (seed real + `react`/`plan-and-execute` via LLM) com `OPENROUTER_API_KEY`/`OPEN_ROUTER_MODEL` e um MySQL acessível — nenhum dos dois está disponível neste ambiente de implementação.

---

## Phase 7: Addendum — Plan-and-Execute revisado e store JSON interino

**Purpose**: ajustes pedidos diretamente durante `/speckit.implement`, após T001-T025:
reescrever `plan-and-execute.ts` seguindo um formato de estado de referência
(`input`/`plan`/`done`/`answer`), e substituir MySQL/Sequelize por um arquivo JSON
como "banco" interino (sem banco real disponível neste ambiente), com execução
puramente em memória nos testes.

- [X] T026 Reescrever `src/agents/plan-and-execute.ts`: estado `input`/`plan`/`done` (tuplas `[passo, resultado]`)/`answer`, planner com saída estruturada via mensagens `[["system", ...], ["user", ...]]`, executor que resolve o passo atual com as tools e empurra `[passo, resultado]` para `done`, replanner que decide `ajustar`/`seguir`/`encerrar` — mantendo `MAX_STEPS`/`shouldContinue` (T017) como o teto de 8 passos
- [X] T027 [P] Criar `src/services/json-store.ts` (`createIncidentsStoreFromData` em memória + `createJsonIncidentsStore` com leitura/gravação em arquivo) e `src/models/seed-data.json` (mesmo dataset do seed: 5 serviços, 6 incidentes, 3 firing/3 resolved), como alternativa ao MySQL/Sequelize enquanto não há um banco disponível
- [X] T028 Apontar `src/arena.ts` para `createJsonIncidentsStore` sobre `seed-data.json`, e adicionar `src/services/json-store.test.ts` (mesma cobertura de `incidents.service.test.ts`, porém puramente em memória, sem Sequelize/sqlite — muito mais rápido: ~1-6ms por teste vs. ~11s de cold start do binding nativo `sqlite3`)

**Nota de escopo**: `src/services/incidents.service.ts` (Sequelize/MySQL) e seus testes
**não foram removidos** — continuam corretos, com typecheck e testes passando — mas
deixaram de ser o que `arena.ts` usa por padrão. Ver nota em `plan.md` (seção
Storage). Isso diverge do que a `constitution.md` declara como stack de persistência;
nenhuma emenda formal foi feita a ela nesta sessão.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências — pode começar imediatamente
- **Foundational (Phase 2)**: depende do Setup — BLOQUEIA todas as user stories
- **User Story 1 (Phase 3)**: depende só do Foundational
- **User Story 2 (Phase 4)**: depende do Foundational **e** das tools/trace de US1 (T014, T015, T016) — não é totalmente independente de US1, pois reaproveita as mesmas tools e a mesma formatação de rastro
- **User Story 3 (Phase 5)**: depende do Foundational **e** do seed/tools de US1 (T013, T015) — os testes de T020/T021 podem começar assim que essas tarefas de US1 estiverem prontas, mesmo antes de US2
- **Polish (Phase 6)**: depende de todas as user stories desejadas estarem completas

### User Story Dependencies

- **US1 (P1)**: independente das outras stories — é o MVP
- **US2 (P2)**: reaproveita `tools.ts`/`trace.ts`/`strategy.ts`/`model.ts` de US1 (Foundational + T014/T015/T016); adiciona a estratégia Plan-and-Execute e a arena
- **US3 (P3)**: reaproveita `seed.ts`/`tools.ts` de US1; adiciona apenas testes determinísticos e o ajuste de idempotência do seed — pode ser feita em paralelo com US2, já que não depende dela

### Within Each User Story

- Testes são escritos e DEVEM falhar antes da implementação correspondente
- Models/erros (Foundational) antes de services
- Services antes de tools
- Tools antes das estratégias que as usam
- Estratégias antes da arena (US2)

### Parallel Opportunities

- T002 e T003 (Setup) podem rodar em paralelo
- T004–T009 (Foundational) podem rodar todos em paralelo — arquivos diferentes, sem dependência entre si
- T010 e T011 (testes de US1) podem rodar em paralelo
- Assim que o Foundational terminar, T017 (teste de US2) pode começar em paralelo com o trabalho de US1, pois não depende de nada de US1
- T020 e T021 (testes de US3) podem rodar em paralelo entre si, assim que T013/T015 (US1) estiverem prontos — em paralelo com o trabalho de US2
- T023 e T024 (Polish) podem rodar em paralelo

---

## Parallel Example: Foundational

```bash
# Depois do Setup, lançar toda a Fase 2 em paralelo (arquivos independentes):
Task: "Criar fábrica de conexão Sequelize em src/models/sequelize.ts"
Task: "Criar model Service em src/models/service.model.ts"
Task: "Criar model Incident em src/models/incident.model.ts"
Task: "Criar erros de domínio em src/services/errors.ts"
Task: "Criar tipos do núcleo de raciocínio em src/agents/strategy.ts"
Task: "Criar fábrica do modelo de linguagem em src/agents/model.ts"
```

## Parallel Example: User Story 1 (testes)

```bash
Task: "Testes de incidents.service em src/services/incidents.service.test.ts"
Task: "Teste de formatação de rastro em src/agents/trace.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 apenas)

1. Completar Phase 1 (Setup) e Phase 2 (Foundational)
2. Completar Phase 3 (US1): seed + tools + ReAct + rastro
3. **PARAR e VALIDAR**: rodar `npm run arena -- --strategies react` (quickstart.md, passo 2) e conferir a resposta e o rastro
4. Esse é o MVP demonstrável do núcleo de raciocínio

### Incremental Delivery

1. Setup + Foundational → base pronta
2. US1 → validar isoladamente → MVP pronto para demo
3. US2 → validar a comparação na arena → demo de duas estratégias
4. US3 → validar os testes determinísticos → confiança para evoluir sem regressão
5. Polish → `typecheck` + `test` verdes, quickstart validado de ponta a ponta

## Notes

- `[P]` = arquivos diferentes, sem dependência pendente entre as tarefas
- `[Story]` mapeia a tarefa à user story correspondente da spec, para rastreabilidade
- Verificar que os testes falham antes de implementar (Test-First, constitution Princípio II)
- Nenhum teste automatizado (`npm test`) deve chamar o modelo de linguagem real ou depender de rede (FR-017) — a validação de `react.ts`/`plan-and-execute.ts`/`arena.ts` com o LLM real é manual, via `quickstart.md`

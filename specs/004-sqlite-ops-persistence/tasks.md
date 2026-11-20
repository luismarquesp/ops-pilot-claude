---

description: "Task list template for feature implementation"
---

# Tasks: Persistência Real de Operações (SQLite)

**Input**: Design documents from `/specs/004-sqlite-ops-persistence/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/, quickstart.md

**Tests**: Incluídos — pedidos explicitamente pela spec (FR-013) e pela constitution
(Princípio II, Test-First).

**Organization**: Tasks agrupadas por user story para permitir implementação e
teste independentes de cada uma.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: A qual user story a tarefa pertence (US1, US2, US3)
- Caminhos de arquivo exatos em cada descrição

## Path Conventions

Projeto único (sem `tests/` separado — testes co-localizados como `*.test.ts`,
convenção já usada no repo). Todos os caminhos abaixo são relativos à raiz do
repositório.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: preparar o terreno antes de tocar em qualquer store ou tool.

- [X] T001 [P] Adicionar `data/` ao `.gitignore` (raiz do repo)
- [X] T002 [P] Remover a dependência não usada `sqlite3` de `package.json` (devDependencies) e rodar `npm install` para atualizar o lockfile — `node:sqlite` é nativo, sem pacote de terceiros (constitution v1.1.0)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: construir e testar a camada Model (`OpsStore` + seus dois backends)
por completo, antes de qualquer tool consumi-la.

**🚨 CRITICAL**: Nenhuma user story pode começar antes desta fase estar completa.

- [X] T003 [P] Remover código Sequelize/MySQL: apagar `src/models/sequelize.ts`, `src/models/service.model.ts`, `src/models/incident.model.ts`, `src/models/seed.ts`, `src/models/seed.test.ts`, `src/models/seed-data.json` (diretório `src/models/` inteiro), `src/services/incidents.service.ts` e `src/services/incidents.service.test.ts` — obsoletos após a constitution v1.1.0 (decisão confirmada em plan.md, Constitution Check)
- [X] T004 [P] Remover o store em arquivo JSON: apagar `src/services/json-store.ts` e `src/services/json-store.test.ts` (a parte "em memória" é reconstruída em `src/store/mock-ops-store.ts`, T009)
- [X] T005 [P] Criar a interface `OpsStore` e os tipos de domínio (`Alert`, `Incident`, `Runbook`, `Severity`, `ServiceTier`, `AlertStatus`, `IncidentStatus`, `OpenIncidentInput`) em `src/store/ops-store.ts`, conforme `data-model.md` e `contracts/ops-store.md`
- [X] T006 [P] Adicionar `RunbookNotFoundError` em `src/services/errors.ts` (mesmo padrão de `ServiceNotFoundError`/`IncidentNotFoundError` já existentes)
- [X] T007 Criar o dataset único do cenário "Mercadinho" em `src/store/mercadinho-seed.ts` (5 serviços com `tier`, 6 alerts — 3 `firing`/3 `resolved`, 3 runbooks — checkout/payments/auth), conforme `data-model.md` §Seed — depende de T005 (tipos)
- [X] T008 [P] Implementar `SqliteOpsStore` em `src/store/sqlite-ops-store.ts`: `createSqliteOpsStore(dbPath = process.env.OPSPILOT_DB ?? "./data/opspilot.db")`, DDL idempotente (`CREATE TABLE IF NOT EXISTS` nas 4 tabelas, com `CHECK` em `tier`/`severity`/`status`), `mkdirSync` do diretório pai quando `dbPath !== ":memory:"`, seed idempotente (guarda por `COUNT(*)` em `services`) a partir de `mercadinho-seed.ts`, todas as queries via `db.prepare(...)` com `?` — depende de T005, T006, T007
- [X] T009 [P] Implementar `MockOpsStore` em `src/store/mock-ops-store.ts` (`createOpsStoreFromData`/equivalente): mesma interface `OpsStore`, dados em memória, sem nenhum I/O de disco, aceitando um dataset inicial (default = `mercadinho-seed.ts`) — sucessor de `createIncidentsStoreFromData` — depende de T005, T006, T007
- [X] T010 [P] Testes de contrato de `SqliteOpsStore(":memory:")` em `src/store/sqlite-ops-store.test.ts` — os 11 casos de `contracts/ops-store.md` (seed inicial, abrir/listar/resolver incidente, filtros de `listAlerts`/`listIncidents`, idempotência de `resolveIncident` e do seed, `getRunbook` com e sem runbook, `CHECK` rejeitando valor fora do enum) — depende de T008
- [X] T011 [P] Testes de contrato de `MockOpsStore` em `src/store/mock-ops-store.test.ts` — os mesmos 11 casos de `contracts/ops-store.md` — depende de T009

**Checkpoint**: `OpsStore` implementado e testado nos dois backends — pronto para as tools consumirem.

---

## Phase 3: User Story 1 - Dados sobrevivem a um restart (Priority: P1) 🎯 MVP

**Goal**: incidentes abertos/resolvidos persistem entre restarts do processo; o
seed inicial aparece sozinho na primeira execução e nunca duplica nas seguintes.

**Independent Test**: `quickstart.md`, passos 2 e 3 — abrir um incidente via
`arena`, reiniciar o processo, confirmar que ele continua aparecendo; rodar o
`arena` de novo do zero e confirmar que a contagem de alerts/serviços não muda.

### Implementation for User Story 1

- [X] T012 [US1] Atualizar `src/agents/tools.ts`: `createOpsTools` passa a receber `OpsStore` (não mais `IncidentsStore`); `open_incident` grava incidentes com `status: "open"` (não mais `"firing"`); `open_incident`/`resolve_incident` ganham descrições revisadas (o que fazem, quando usar, `.describe()` em cada campo do schema) conforme `contracts/tools.md` — depende de T008, T009
- [X] T013 [US1] Migrar `src/agents/tools.test.ts` para os testes existentes de `open_incident`/`resolve_incident`: trocar o fake `IncidentsStore` por um fake `OpsStore` (5 métodos), atualizar as asserções de status para `"open"` — depende de T012
- [X] T014 [P] [US1] Trocar a composição em `src/index.ts`: `createJsonIncidentsStore(SEED_DATA_PATH)` → `createSqliteOpsStore()`, remover a constante/comentário do caminho do seed JSON — depende de T012
- [X] T015 [P] [US1] Trocar a composição em `src/arena.ts`: `createJsonIncidentsStore(SEED_DATA_PATH)` → `createSqliteOpsStore()`, remover `SEED_DATA_PATH` e o comentário "por enquanto, sem MySQL..." (obsoleto) — depende de T012
- [X] T016 [P] [US1] Adaptar `src/bench.ts` para `MockOpsStore`: cenário C1 (pergunta sobre "alertas"/firing) passa a consultar `listAlerts`; cenários C2/C3 ("abra/resolva incidentes") passam a usar `openIncident`/`resolveIncident`/`listIncidents`; atualizar `BENCH_SEED` e as funções `checkC1`/`checkC2`/`checkC3` para o novo shape de dataset (`services` com `tier`, `alerts` separado de `incidents`) — depende de T009, T012
- [X] T017 [US1] Rodar `npm run typecheck` e `npm test`; validar manualmente `quickstart.md` passos 2 e 3 (persistência sobrevive a restart; segundo start não duplica seed) — depende de T012-T016

**Checkpoint**: User Story 1 completa e testável de forma independente — persistência real funcionando ponta a ponta.

---

## Phase 4: User Story 2 - Consultar e filtrar incidentes por status (Priority: P2)

**Goal**: tool `list_incidents` retorna incidentes filtrados por `open` (default),
`resolved` ou `all`.

**Independent Test**: com um `MockOpsStore` pré-carregado com incidentes abertos e
resolvidos (sem depender de `open_incident` ter rodado antes), chamar
`list_incidents` sem filtro, com `"resolved"` e com `"all"`, e conferir que cada
resposta traz exatamente o subconjunto esperado.

### Implementation for User Story 2

- [X] T018 [US2] Adicionar a tool `list_incidents` em `src/agents/tools.ts` (`status: z.enum(["open","resolved","all"]).default("open").describe(...)`, default resolvido na tool antes de chamar `store.listIncidents(...)`) e revisar a descrição de `list_alerts` para deixar explícita a diferença entre as duas (quando usar cada uma) — conforme `contracts/tools.md` — depende de T012
- [X] T019 [P] [US2] Testes de `list_incidents` em `src/agents/tools.test.ts`: sem filtro (equivale a `open`), `"resolved"`, `"all"` — cada um retornando o subconjunto certo a partir de um fake `OpsStore` — depende de T018
- [X] T020 [US2] Validar manualmente `quickstart.md` (listar incidentes por status via `arena`) — depende de T018, T019

**Checkpoint**: User Stories 1 e 2 funcionam juntas — listagem de incidentes com filtro correto.

---

## Phase 5: User Story 3 - Consultar runbook de um serviço (Priority: P3)

**Goal**: tool `consultar_runbook(service)` retorna o procedimento cadastrado, ou
uma mensagem clara quando não existe.

**Independent Test**: `quickstart.md` passo 4 — pedir o runbook de `checkout` (tem
procedimento) e de `search` (não tem) via `arena`.

### Implementation for User Story 3

- [X] T021 [US3] Adicionar a tool `consultar_runbook` em `src/agents/tools.ts` (`service: z.string().min(1).describe(...)`, captura `RunbookNotFoundError` e retorna mensagem de erro textual, nunca lança) — conforme `contracts/tools.md` — depende de T012, T006
- [X] T022 [P] [US3] Testes de `consultar_runbook` em `src/agents/tools.test.ts`: serviço com runbook cadastrado, serviço sem runbook (mensagem de erro, sem exceção não tratada) — depende de T021
- [X] T023 [US3] Validar manualmente `quickstart.md` passo 4 (runbook de checkout/payments/auth retorna conteúdo; serviço sem runbook retorna erro claro) — depende de T021, T022

**Checkpoint**: as 3 user stories funcionam de forma independente.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: consistência final entre as 5 tools e validação de ponta a ponta.

- [X] T024 [P] Passe final de revisão nas 5 descrições de `src/agents/tools.ts` (`list_alerts`, `list_incidents`, `open_incident`, `resolve_incident`, `consultar_runbook`) contra o checklist de 6 regras de `research.md` §7 — agora que todas as tools novas existem, conferir que nenhuma frase-gatilho se sobrepõe entre elas
- [X] T025 [P] Atualizar `AGENTS.md` para refletir a persistência SQLite e as tools novas (constitution, Governance: `AGENTS.md` deve permanecer consistente com a constitution)
- [X] T026 Rodar `npm run typecheck` e `npm test` (suíte completa) e validar `quickstart.md` do início ao fim — depende de todas as tarefas anteriores. `typecheck`/`test` (51 testes) verdes. Quickstart passos 1-4 validados via `arena` com LLM real (persistência sobrevive a restart, seed não duplica, list_incidents filtra, runbook com/sem conteúdo). Passo 5 (`bench`): C1 passou 2/2 (react + plan-and-execute); C2/C3 ficaram parcialmente bloqueados pelo rate limit diário do tier gratuito do OpenRouter (429) — não é uma falha do código (todas as asserções relevantes já são cobertas pelos 51 testes determinísticos); revalidar C2/C3 completos quando a cota resetar

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências — pode começar imediatamente
- **Foundational (Phase 2)**: depende do Setup — BLOQUEIA todas as user stories
- **User Story 1 (Phase 3)**: depende só do Foundational
- **User Story 2 (Phase 4)**: depende do Foundational + de T012 (US1) — `list_incidents`/`list_alerts` vivem no mesmo arquivo (`tools.ts`) já tocado por T012
- **User Story 3 (Phase 5)**: depende do Foundational + de T012 (US1), pelo mesmo motivo (arquivo compartilhado); independente de US2
- **Polish (Phase 6)**: depende de US1 + US2 + US3 completas

### Dentro do Foundational

`T003`, `T004`, `T005`, `T006` são mutuamente independentes (arquivos distintos) →
rodam em paralelo. `T007` depende de `T005`. `T008` e `T009` dependem de `T005`,
`T006`, `T007`, mas são independentes entre si → paralelos. `T010` depende só de
`T008`; `T011` depende só de `T009` → paralelos entre si.

### Dentro de cada User Story

- US1: `T012` → `T013` (mesmo arquivo, sequencial); `T014`/`T015`/`T016` dependem
  só de `T012` e são independentes entre si → paralelos; `T017` fecha a fase.
- US2: `T018` → `T019` (mesmo arquivo/tool, sequencial) → `T020`.
- US3: `T021` → `T022` (mesmo arquivo/tool, sequencial) → `T023`.

### Parallel Opportunities

- Setup: `T001` + `T002` juntas.
- Foundational: `T003`+`T004`+`T005`+`T006` juntas; depois `T008`+`T009` juntas;
  depois `T010`+`T011` juntas.
- US1: `T014`+`T015`+`T016` juntas, depois de `T012`/`T013`.
- Polish: `T024`+`T025` juntas.

---

## Parallel Example: Foundational

```bash
# Depois de T005-T007 prontos, os dois backends em paralelo:
Task: "Implementar SqliteOpsStore em src/store/sqlite-ops-store.ts"
Task: "Implementar MockOpsStore em src/store/mock-ops-store.ts"

# Depois, os testes de contrato de cada um, também em paralelo:
Task: "Testes de contrato de SqliteOpsStore em src/store/sqlite-ops-store.test.ts"
Task: "Testes de contrato de MockOpsStore em src/store/mock-ops-store.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Completar Setup (T001-T002)
2. Completar Foundational (T003-T011) — CRÍTICO, bloqueia tudo
3. Completar User Story 1 (T012-T017)
4. **PARAR e VALIDAR**: persistência sobrevive a restart, seed não duplica
5. Esse já é o valor central da feature — pode ser considerado entregável sozinho

### Incremental Delivery

1. Setup + Foundational → Model layer pronta e testada
2. + US1 → testar independentemente → persistência real funcionando (MVP)
3. + US2 → testar independentemente → filtro de incidentes por status
4. + US3 → testar independentemente → runbooks
5. Polish → consistência final das 5 descrições + validação ponta a ponta

---

## Notes

- `[P]` = arquivos diferentes, sem dependência pendente
- `[Story]` mapeia a tarefa à user story correspondente, para rastreabilidade
- Toda a Foundational fica sob Test-First (Constitution Princípio II): `SqliteOpsStore`/`MockOpsStore` só são considerados prontos com os 11 casos de `contracts/ops-store.md` passando
- Parar em qualquer checkpoint para validar a story isoladamente antes de seguir
- Evitar: tarefas vagas, dois tasks [P] no mesmo arquivo, dependências entre stories que quebrem a independência

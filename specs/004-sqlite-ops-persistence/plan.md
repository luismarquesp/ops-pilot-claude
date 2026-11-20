# Implementation Plan: Persistência Real de Operações (SQLite)

**Branch**: `004-sqlite-ops-persistence` | **Date**: 2026-09-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-sqlite-ops-persistence/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Substituir os dois armazenamentos "interinos" hoje em uso (o store MySQL/Sequelize,
nunca ligado em runtime, e o store em arquivo JSON usado por `arena`/HTTP) por uma
persistência real em SQLite (`node:sqlite`, `DatabaseSync`, nativo do Node — ver
constitution v1.1.0). O domínio ganha uma quarta entidade (`Runbook`) e separa
`Alert` (sinal de monitoramento, status `firing|resolved`) de `Incident` (ação do
operador, status `open|resolved`, com `resolvedAt`/`summary` anuláveis) — hoje as
duas coisas são o mesmo registro. Uma interface `OpsStore` única passa a ser
implementada por dois backends: `SqliteOpsStore` (arquivo em `OPSPILOT_DB`, default
`./data/opspilot.db`; `:memory:` nos testes) para runtime/testes de integração, e um
`MockOpsStore` em memória (sucessor do `json-store` atual, sem persistir em disco)
para os testes de tools/estratégia e para o `bench`, onde reprodutibilidade
execução-a-execução importa mais que persistência real. As tools LangChain ganham
`list_incidents` e `consultar_runbook`, e todas as 5 descrições são revisadas para
deixar claro pra LLM quando usar cada uma (em especial a diferença entre `list_alerts`
× `list_incidents` × `open_incident`) e para expor todo campo fechado como enum
`describe()`d.

## Technical Context

**Language/Version**: TypeScript (ESM, `strict: true`) sobre Node.js 22 LTS+ (validado
localmente em Node 24.16 — `node:sqlite`/`DatabaseSync` disponível sem flag).

**Primary Dependencies**: `node:sqlite` (nativo, sem pacote de terceiros), `zod`
(schemas das tools), `@langchain/core` (`tool()`), mantém o restante do stack já
em uso (`@langchain/langgraph`, `@langchain/openai`, `express`) inalterado.

**Storage**: SQLite via `node:sqlite` `DatabaseSync`. Arquivo único em
`process.env.OPSPILOT_DB ?? "./data/opspilot.db"` no runtime (dev/`arena`/HTTP);
`:memory:` nos testes de integração da store SQLite. `MockOpsStore` (em memória,
sem I/O) continua servindo os testes de tools/estratégia e o `bench`.

**Testing**: `node:test` via `tsx` (`npm test`), como já é o padrão do projeto —
testes co-localizados em `*.test.ts` ao lado do código.

**Target Platform**: processo Node.js single-instance (CLI `arena`/`bench` e
servidor HTTP `express`), sem acesso concorrente multi-processo ao arquivo SQLite
nesta iteração (ver spec.md, Assumptions).

**Project Type**: single project (biblioteca + CLI + servidor HTTP no mesmo `src/`,
sem front-end separado) — mantém a estrutura já existente.

**Performance Goals**: N/A — sem alvo de performance definido pela spec; o volume
de dados do cenário Mercadinho (5 serviços, 6 alertas, poucos incidentes/runbooks)
é trivial para SQLite local.

**Constraints**: DDL e seed DEVEM ser idempotentes (rodar `npm run dev`/`arena`
repetidamente nunca duplica dados nem falha); toda query DEVE usar prepared
statements (nunca SQL concatenado, ver spec FR-005/Constitution Princípio III);
`.env`/segredos não entram em jogo aqui (SQLite não usa credenciais de rede).

**Scale/Scope**: escopo de demo/estudo — um único arquivo `.db` local, dezenas de
linhas por tabela, sem necessidade de índices além das chaves primárias/FKs.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Avaliação |
|---|---|
| I. Validação na Fronteira (Zod) | PASS — os parâmetros de todas as 5 tools (incluindo as 2 novas) são validados via `z.object` com enums para todo campo fechado, antes de chegar ao `OpsStore`. |
| II. Test-First | PASS — plano exige testes `:memory:` da `SqliteOpsStore` (seed, abrir/listar/resolver, filtros, CHECKs) e migração dos testes de tools/estratégia para rodar sobre `:memory:`/`MockOpsStore`, antes do código ser considerado pronto. |
| III. Arquitetura em Camadas (MVC) | PASS — `OpsStore`/`SqliteOpsStore`/`MockOpsStore` são o Model (única camada que fala SQL); tools (`src/agents/tools.ts`) são o equivalente a Service/Controller para o agente, sem lógica de SQL; nenhuma camada fora da store fala SQL diretamente. |
| IV. Erros de Domínio como Classes na Borda | PASS — `ServiceNotFoundError`/`IncidentNotFoundError`/novo `RunbookNotFoundError` continuam em `src/services/errors.ts`, lançados pela store e traduzidos só dentro de cada tool (nunca formatados na store). |
| V. Funções Puras | PASS — a store isola todo I/O (SQLite); a lógica de mapeamento linha↔domínio e os `check()` de bench continuam funções puras sobre os dados já lidos. |
| VI. Segredos Nunca Expostos | PASS — `OPSPILOT_DB` é um caminho de arquivo local, lido via `process.env` nativo, sem segredo envolvido; nada aqui toca `.env`. |

Nenhuma violação — não há necessidade de preencher Complexity Tracking.

**Mudança de escopo explicitamente aprovada pelo usuário** (fora do que a spec de
negócio descreve, mas necessária para não deixar código morto contradizendo a
constitution v1.1.0): remoção do store Sequelize/MySQL (`src/models/sequelize.ts`,
`service.model.ts`, `incident.model.ts`, `src/services/incidents.service.ts` +
teste, `src/models/seed.ts` + teste) e do store em arquivo JSON
(`src/services/json-store.ts` na parte que lê/escreve `seed-data.json`), ambos
substituídos pelas duas implementações de `OpsStore` descritas acima. `Incident`
passa a usar status `open|resolved` (em vez de `firing|resolved`), distinto de
`Alert`, que mantém `firing|resolved`.

## Project Structure

### Documentation (this feature)

```text
specs/004-sqlite-ops-persistence/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── ops-store.md
│   └── tools.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── store/                        # NOVO — Model layer (única a falar SQL)
│   ├── ops-store.ts              # Interface OpsStore + tipos de domínio (Alert,
│   │                              # Incident, Runbook, Severity, ServiceTier, ...)
│   ├── sqlite-ops-store.ts       # createSqliteOpsStore(): OpsStore via node:sqlite
│   ├── mock-ops-store.ts         # createOpsStoreFromData(): OpsStore em memória
│   │                              # (sucessor de services/json-store.ts; usado por
│   │                              # testes e por bench.ts)
│   ├── mercadinho-seed.ts        # Dataset único do cenário "Mercadinho", consumido
│   │                              # tanto pelo seed da SqliteOpsStore quanto pelo
│   │                              # dataset padrão da MockOpsStore
│   ├── sqlite-ops-store.test.ts  # NOVO
│   └── mock-ops-store.test.ts    # NOVO (sucessor de json-store.test.ts)
│
├── services/
│   └── errors.ts                 # ganha RunbookNotFoundError
│                                  # (incidents.service.ts + teste e json-store.ts +
│                                  #  teste são REMOVIDOS — ver Constitution Check)
│
├── models/                       # REMOVIDO por completo (sequelize.ts,
│                                  # service.model.ts, incident.model.ts, seed.ts +
│                                  # teste, seed-data.json) — sem uso de Sequelize/
│                                  # MySQL após a constitution v1.1.0
│
├── agents/
│   ├── tools.ts                  # +list_incidents, +consultar_runbook; revisão de
│   │                              # descrições/describe()/enums nas 5 tools
│   └── tools.test.ts             # migrado para OpsStore fake / MockOpsStore
│
├── arena.ts                      # troca createJsonIncidentsStore → createSqliteOpsStore
├── bench.ts                      # troca para MockOpsStore; cenários C1 (alerta) ×
│                                  # C2/C3 (incidente) mapeados para a entidade certa
├── index.ts                      # troca createJsonIncidentsStore → createSqliteOpsStore
└── http/                         # inalterado (server.ts não conhece a store)

data/                              # NOVO diretório — arquivo .db do OPSPILOT_DB
                                    # default; entra no .gitignore
```

**Structure Decision**: mantém o projeto único existente (sem `tests/` separado —
os testes seguem co-localizados como `*.test.ts`, convenção já em uso no repo).
A única estrutura nova é `src/store/`, que se torna a camada Model única para
persistência, substituindo `src/models/` (Sequelize) e a metade "arquivo" de
`src/services/json-store.ts`.

## Complexity Tracking

> Sem violações de constitution a justificar — seção deixada vazia de propósito.

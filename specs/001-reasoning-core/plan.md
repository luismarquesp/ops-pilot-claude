# Implementation Plan: Núcleo de Raciocínio do OpsPilot

**Branch**: `001-reasoning-core` | **Date**: 2026-09-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-reasoning-core/spec.md`

## Summary

Construir o núcleo de raciocínio do OpsPilot: um contrato comum `ReasoningStrategy`
(nome + `run(input)` → resposta + rastro tipado + métricas), duas estratégias concretas
sobre ele (ReAct via LangGraph pré-construído, e Plan-and-Execute como grafo
planner/executor/replanner com teto de 8 passos), três ferramentas validadas com Zod
que operam sobre incidentes persistidos em MySQL via Sequelize (com seed determinístico
de 5 serviços / 6 alertas), e um comparador de linha de comando (`arena`) que roda 1+
estratégias sobre o mesmo input e imprime rastro + métricas lado a lado. Abordagem
técnica: usar os agentes/grafos pré-construídos do LangGraph em vez de reimplementar o
loop de raciocínio, isolar a camada de persistência atrás de um repositório fino para
permitir testes determinísticos sem rede, e derivar as métricas de chamadas ao LLM via
callbacks do LangChain em vez de contagem manual espalhada pelo código.

## Technical Context

**Language/Version**: TypeScript em modo ESM (`strict: true`), Node.js 22 LTS

**Primary Dependencies**: `@langchain/core`, `@langchain/langgraph` (agente ReAct
pré-construído + grafo customizado para Plan-and-Execute), `@langchain/openai` (cliente
de chat apontando para a `baseURL` da OpenRouter), `zod` (schemas de tools e I/O),
`sequelize` + `mysql2` (persistência)

**Storage**: MySQL via Sequelize — tabelas `Service` e `Incident` (ver
[data-model.md](./data-model.md)). **Atualização pós-implementação**: por enquanto,
sem um MySQL disponível para dev/demo, `arena.ts` e os testes usam
`src/services/json-store.ts` — mesma interface `IncidentsStore`, dados lidos/gravados
em `src/models/seed-data.json` (arena) ou puramente em memória (testes, com o mesmo
JSON como fixture). O código Sequelize/MySQL (`incidents.service.ts` + testes)
permanece no repositório, correto e com typecheck/testes passando, como a
implementação alvo da constitution para quando houver um banco real disponível — só
não é mais o que `arena.ts` usa por padrão.

**Testing**: `node:test` executado via `tsx` (script `npm test` já definido em
`package.json`); arquivos `*.test.ts` colocados ao lado do código que testam, conforme
convenção já em uso no projeto (`src/**/*.test.ts`)

**Target Platform**: Node.js server-side / CLI — sem superfície web nesta feature (a
`arena` é um script de linha de comando)

**Project Type**: single project (backend Node.js + CLI), dentro do repositório único
já existente

**Performance Goals**: não há alvo de performance de produção definido nesta feature;
o que é observável e obrigatório são os limites de passos/iterações (ver Constraints) —
métricas de latência são reportadas, não otimizadas nesta fase

**Constraints**:
- Temperatura do modelo fixa em 0 (determinismo de resposta) — FR-005
- Estratégia Plan-and-Execute NUNCA executa mais que 8 passos, mesmo que o replanejador
  peça mais — FR-012
- Toda estratégia respeita um limite configurável de iterações e o interrompe ao
  atingir o teto, mesmo sem resposta final — FR-013
- Testes de store e de formatação de rastro rodam 100% sem rede (sem LLM, sem chamada
  HTTP real) — FR-017 / SC-005

**Scale/Scope**: dataset de seed fixo e pequeno (5 serviços, 6 alertas: 3 firing / 3
resolved); 2 estratégias de raciocínio; 3 tools (`list_alerts`, `open_incident`,
`resolve_incident`); 1 CLI comparador (`arena`) com flags `--strategies` e
`--max-iterations`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Princípio (constitution v1.0.0) | Avaliação | Status |
|---|----------------------------------|-----------|--------|
| I | Validação na Fronteira (Zod) | As três tools (`list_alerts`, `open_incident`, `resolve_incident`) validam entrada e saída com Zod em `src/agents/tools.ts`, que é a fronteira entre o LLM e o domínio (FR-006, FR-007). | PASS |
| II | Test-First | `data-model.md`/`contracts/` definem o comportamento do store e do formatador de rastro antes da implementação; `tasks.md` (próxima fase) deve nascer com tarefas de teste antes das de implementação, conforme FR-017. | PASS (a verificar em `/speckit-tasks`) |
| III | Arquitetura em Camadas (MVC) | Ver "Structure Decision" abaixo — persistência em `models/`, regra de negócio em `services/`, e `agents/` como camada fina de orquestração/tradução que não acessa o banco diretamente. | PASS |
| IV | Erros de Domínio como Classes na Borda | Erros de domínio (ex.: incidente inexistente) são classes lançadas pelos `services/` e traduzidas em `agents/tools.ts` (a borda desta feature) para eventos de observação no rastro, nunca formatadas dentro do service. | PASS |
| V | Funções Puras | Formatação de rastro e lógica de seleção/filtragem de alertas são funções puras; efeitos colaterais (Sequelize, chamadas ao LLM) ficam isolados em `models/` e `agents/model.ts`. | PASS |
| VI | Segredos Nunca Expostos | `src/agents/model.ts` lê `OPENROUTER_API_KEY`/`OPEN_ROUTER_MODEL` via `process.env` (sem `dotenv`); nenhum artefato desta feature lê ou versiona `.env`. | PASS |

Nenhuma violação identificada — a seção **Complexity Tracking** não se aplica.

## Project Structure

### Documentation (this feature)

```text
specs/001-reasoning-core/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── reasoning-strategy.md
│   ├── tools.md
│   └── arena-cli.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── models/                     # Camada Model (Sequelize / persistência)
│   ├── sequelize.ts            # instância Sequelize + conexão MySQL
│   ├── service.model.ts        # model Service
│   ├── incident.model.ts       # model Incident (status: firing | resolved)
│   └── seed.ts                 # script de seed (FR-009) — 5 serviços, 6 alertas
│
├── services/                    # Camada Service (regra de negócio, funções puras onde possível)
│   ├── incidents.service.ts    # listAlerts / openIncident / resolveIncident + erros de domínio
│   └── errors.ts                # classes de erro de domínio (ex.: IncidentNotFoundError)
│
├── agents/                      # Orquestração do raciocínio (borda LLM ↔ domínio)
│   ├── model.ts                 # fábrica única do chat model (OpenRouter, temperatura 0) — FR-005
│   ├── tools.ts                  # tools LangChain (schemas Zod) sobre incidents.service — FR-006/007
│   ├── strategy.ts               # contrato ReasoningStrategy + tipos de Trace/Metrics — FR-001..004
│   ├── react.ts                   # estratégia ReAct (agente pré-construído do LangGraph) — FR-010
│   ├── plan-and-execute.ts        # estratégia Plan-and-Execute (grafo planner/executor/replanner) — FR-011/012
│   └── trace.ts                   # formatação/serialização do rastro para exibição
│
├── arena.ts                      # CLI comparador (--strategies, --max-iterations) — FR-015/016
└── index.ts                      # entrypoint existente (não afetado por esta feature)
```

**Structure Decision**: projeto único (Option 1), sem separação frontend/backend. A
camada MVC do projeto (Principle III da constitution) é respeitada por `models/` e
`services/`; `agents/` é uma camada de orquestração específica desta feature que atua
como a "borda" (Controller-equivalent) entre o LLM e o domínio — é onde a validação Zod
(Principle I) e a tradução de erros de domínio (Principle IV) acontecem para tools e
para a CLI `arena`. Nenhuma lógica de negócio vive em `agents/`: toda regra sobre
incidentes está em `services/incidents.service.ts`, que `agents/tools.ts` apenas invoca.
Os testes determinísticos (FR-017) ficam ao lado do código testado, como
`src/models/seed.test.ts` e `src/agents/trace.test.ts`, seguindo o glob `src/**/*.test.ts`
já usado pelo script `npm test`.

## Complexity Tracking

*Nenhuma violação da constitution foi identificada nesta feature — seção não aplicável.*

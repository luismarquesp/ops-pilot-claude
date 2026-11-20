# Implementation Plan: Endpoint HTTP de Chat sobre o Núcleo de Raciocínio

**Branch**: `003-chat-endpoint` | **Date**: 2026-09-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-chat-endpoint/spec.md`

## Summary

Expor o núcleo de raciocínio (specs/001) e a camada de reflexão (specs/002) por HTTP:
`POST /chat` recebe `{ message, strategy?, reflect? }` validado com Zod, resolve a
estratégia via um registro único (`src/agents/index.ts`, nome → `ReasoningStrategy`,
padrão `react`), aplica `withReflection` quando `reflect` é verdadeiro, roda com um
teto de 180s, e responde `{ answer, trace, metrics }` (200), `{ issues }` do Zod (400),
estratégia desconhecida (422) ou tempo esgotado (504). Abordagem técnica: registro e
app Express como fábricas parametrizadas (não singletons), para que o teste de
integração suba o servidor real com uma estratégia falsa determinística injetada, sem
LLM nem rede — mesmo princípio de injeção de dependência já usado em specs/001/002.

## Technical Context

**Language/Version**: TypeScript em modo ESM (`strict: true`), Node.js 22 LTS — mesma
base das features 001/002

**Primary Dependencies**: `express` (^5, já instalado — Express 5 propaga
automaticamente erros lançados/rejeitados em handlers `async` para o middleware de
erro, sem precisar de `try/catch` manual em cada rota), `zod` (schema do corpo da
requisição) — reaproveita `ReasoningStrategy`/`createReactStrategy`/
`createPlanAndExecuteStrategy`/`withReflection` já existentes; nenhuma dependência
nova

**Storage**: reaproveita o store JSON já existente (`createJsonIncidentsStore` +
`src/models/seed-data.json`) só no bootstrap real do servidor, para montar as tools
que alimentam o registro de estratégias; esta feature não introduz persistência nova

**Testing**: `node:test` via `tsx`. O teste de integração sobe o app Express real
numa porta efêmera (`app.listen(0)`) com um registro **injetado** contendo apenas uma
`ReasoningStrategy` falsa e determinística, e usa o `fetch` nativo do Node para
chamar `POST /chat` — sem subir o store real, sem LLM, sem rede externa. Evita
adicionar `supertest` (ou similar) como dependência nova

**Target Platform**: Node.js server-side — primeira feature deste projeto que
mantém um processo ouvindo uma porta de rede (`arena`/`bench` continuam CLIs à parte,
sem servidor)

**Project Type**: single project — extensão do repositório já existente

**Performance Goals**: nenhum alvo de throughput definido; a única garantia de tempo
é o teto de 180s por requisição (FR-007) — não uma meta de latência típica

**Constraints**:
- O corpo da requisição é SEMPRE validado com Zod antes de qualquer execução — FR-002
- Uma estratégia desconhecida nunca chega a rodar — é checada antes de aplicar
  `withReflection` (edge case da spec) — FR-006
- Nenhuma requisição fica pendurada além de 180s — FR-007
- Uma execução que só termina depois do timeout é descartada (fire-and-forget); nunca
  gera uma segunda resposta para a mesma requisição — Assumptions da spec

**Scale/Scope**: 1 endpoint (`POST /chat`); 1 registro de estratégias com 2 entradas
(`react`, `plan-and-execute`); reflexão como toggle aplicado sobre qualquer uma das
duas, sem entrada própria no registro

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Princípio (constitution v1.0.0) | Avaliação | Status |
|---|----------------------------------|-----------|--------|
| I | Validação na Fronteira (Zod) | O corpo de `POST /chat` é validado por um schema Zod em `src/http/server.ts` antes de qualquer chamada ao registro ou a uma estratégia — a mesma fronteira já usada para as tools em specs/001. | PASS |
| II | Test-First | O teste de integração (`src/http/server.test.ts`) sobe o app real com uma estratégia falsa injetada via registro, cobrindo sucesso e os três casos de erro (400/422/504), sem LLM nem rede. | PASS |
| III | Arquitetura em Camadas (MVC) | `src/http/server.ts` é o primeiro **Controller** de fato do projeto: só valida entrada HTTP, resolve a estratégia via o registro, e traduz o resultado (ou a falha) em uma resposta HTTP. `src/agents/index.ts` (o registro) fica no mesmo nível de orquestração que `react.ts`/`plan-and-execute.ts`/`reflection.ts` — não é persistência nem regra de negócio nova. | PASS |
| IV | Erros de Domínio como Classes na Borda | Não há um novo erro de domínio "profundo" aqui: "estratégia desconhecida" é uma checagem simples de presença no registro, feita e traduzida no próprio Controller (a borda já é onde a checagem acontece — não há camada mais interna para separar essa responsabilidade). Falhas de validação usam o `ZodError` (já uma classe estruturada) diretamente, sem precisar de um wrapper. | PASS |
| V | Funções Puras | A resolução da estratégia (nome → instância) e a montagem da resposta HTTP a partir de um `StrategyResult` são funções puras; só a montagem do registro real (com tools/store) e o `app.listen` são efeitos colaterais, isolados no bootstrap (`src/index.ts`). | PASS |
| VI | Segredos Nunca Expostos | Nenhum segredo novo — o servidor só lê `PORT` (não sensível) via `process.env`, sem `dotenv`. | PASS |

Nenhuma violação identificada — a seção **Complexity Tracking** não se aplica.

## Project Structure

### Documentation (this feature)

```text
specs/003-chat-endpoint/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── chat-api.md
│   └── strategy-registry.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── agents/
│   ├── ... (já existentes: strategy.ts, model.ts, tools.ts, react.ts,
│   │        plan-and-execute.ts, reflection.ts — nenhum alterado)
│   └── index.ts                # NOVO — registro nome → ReasoningStrategy (FR-008/FR-009)
│
├── http/
│   ├── server.ts                # NOVO — createApp(registry, opts) + POST /chat (Controller)
│   └── server.test.ts           # NOVO — teste de integração, estratégia falsa, sem rede
│
├── index.ts                     # ALTERADO — bootstrap real: monta store/tools/registro e chama app.listen
├── arena.ts                     # (já existe, não alterado)
└── bench.ts                     # (já existe, não alterado)
```

**Structure Decision**: nenhuma mudança de estrutura em relação às features
anteriores. `src/agents/index.ts` entra como mais uma peça de orquestração (mesmo
nível de `react.ts`/`plan-and-execute.ts`/`reflection.ts`), não como persistência.
`src/http/` é um diretório novo, mas seu único arquivo de lógica (`server.ts`) é
exatamente o Controller que a constitution já previa (Princípio III) e que, até
agora, não existia porque nenhuma feature anterior tinha superfície HTTP.
`src/index.ts`, vazio desde o esqueleto inicial do projeto, passa a ser o bootstrap
real — é o que `npm run dev` finalmente executa de fato.

## Complexity Tracking

*Nenhuma violação da constitution foi identificada nesta feature — seção não aplicável.*

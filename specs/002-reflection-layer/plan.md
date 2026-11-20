# Implementation Plan: Camada de Reflexão sobre Estratégias de Raciocínio

**Branch**: `002-reflection-layer` | **Date**: 2026-09-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-reflection-layer/spec.md`

## Summary

Construir um decorador `withReflection(strategy, opts)` que envolve **qualquer**
`ReasoningStrategy` já existente (contrato de `specs/001-reasoning-core/`) com um ciclo
de autocrítica: roda a estratégia de base, um crítico (mesmo modelo, saída estruturada
`{ approved, feedback }`) avalia a resposta contra as observações do rastro daquela
execução; se reprovar, a estratégia de base é reexecutada com o feedback incorporado à
pergunta, e o crítico avalia de novo — até aprovar ou atingir `maxReflection` rodadas
(padrão 2). Cada rodada de avaliação vira um evento `critique` no rastro (tipo que já
existe no contrato); as métricas somam as chamadas de toda execução de base e de toda
avaliação do crítico. A arena passa a expor `reflect:react` e `reflect:plan-and-execute`
como estratégias selecionáveis, ao lado das duas já existentes.

## Technical Context

**Language/Version**: TypeScript em modo ESM (`strict: true`), Node.js 22 LTS — mesma
base de `specs/001-reasoning-core/`

**Primary Dependencies**: `@langchain/core` (fábrica de modelo compartilhada
`createModel()` + `withStructuredOutput` para o veredito do crítico), `zod` (schema do
veredito) — nenhuma dependência nova além do que a 001 já instalou

**Storage**: N/A — camada puramente em memória sobre uma execução de
`ReasoningStrategy` já existente; não introduz nenhuma entidade persistida nem toca
`src/models/`

**Testing**: `node:test` via `tsx`. Diferença importante em relação à 001: o núcleo de
controle da reflexão (quantas rodadas rodam, quando parar, como o feedback é
incorporado na próxima tentativa) é **inteiramente testável de forma determinística e
sem rede**, porque tanto a estratégia de base quanto o crítico são injetáveis — os
testes substituem os dois por dublês (fakes) que não chamam nenhum LLM (ver
research.md §1)

**Target Platform**: Node.js server-side / CLI — mesma superfície de `agents/` +
`arena.ts` já existente

**Project Type**: single project — extensão do núcleo de raciocínio já existente, no
mesmo repositório

**Performance Goals**: nenhum alvo de performance de produção definido; o observável
obrigatório é o teto de rodadas de reflexão (ver Constraints)

**Constraints**:
- Nunca mais que `maxReflection` (padrão 2) rodadas de crítica por execução — FR-005
- Ao atingir o teto sem aprovação, a execução retorna a última resposta gerada, nunca
  um erro — FR-006
- `withReflection` NÃO pode alterar o comportamento da estratégia decorada quando
  reflexão não é usada — ou seja, deve reutilizar `ReasoningStrategy.run()` da
  estratégia de base sem modificá-la — FR-001
- Cada execução individual da estratégia de base dentro de um ciclo de reflexão
  continua respeitando o próprio limite de iterações dessa estratégia — FR-010

**Scale/Scope**: 1 decorador (`withReflection`) aplicável a qualquer
`ReasoningStrategy`; 1 crítico com saída estruturada; 2 novas entradas selecionáveis na
arena (`reflect:react`, `reflect:plan-and-execute`)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Princípio (constitution v1.0.0) | Avaliação | Status |
|---|----------------------------------|-----------|--------|
| I | Validação na Fronteira (Zod) | O veredito do crítico (`{ approved, feedback }`) é validado via Zod na saída estruturada do modelo, mesmo padrão já usado no planner/replanner da 001. | PASS |
| II | Test-First | O loop de reflexão (rodadas, corte, incorporação de feedback) é testado com uma estratégia de base e um crítico falsos, determinísticos e sem rede — ver Technical Context/Testing acima e research.md §1. | PASS |
| III | Arquitetura em Camadas (MVC) | `withReflection` vive em `src/agents/reflection.ts`, ao lado das demais estratégias/orquestração; não introduz nem acessa persistência (`models/`/`services/`). | PASS |
| IV | Erros de Domínio como Classes na Borda | Não há erro de domínio novo aqui; uma falha inesperada do próprio crítico é tratada dentro do `run()` (nunca lançada para fora), preservando a regra já estabelecida em `ReasoningStrategy` de que `run` nunca lança por causa de uma falha interna de um passo (ver contracts/reflection.md). | PASS |
| V | Funções Puras | A decisão de quantas rodadas rodar e quando parar é uma função pura do estado acumulado (rodada atual, veredito, teto); só a chamada à estratégia de base e ao crítico são efeitos colaterais, isolados e injetáveis. | PASS |
| VI | Segredos Nunca Expostos | O crítico reusa `createModel()` (já lê `OPENROUTER_API_KEY`/`OPEN_ROUTER_MODEL` via `process.env`); nenhum artefato novo lê `.env`. | PASS |

Nenhuma violação identificada — a seção **Complexity Tracking** não se aplica.

## Project Structure

### Documentation (this feature)

```text
specs/002-reflection-layer/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── reflection.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/agents/
├── strategy.ts               # (já existe) contrato ReasoningStrategy — reaproveitado, não alterado
├── model.ts                  # (já existe) fábrica única do modelo — reaproveitada pelo crítico
├── react.ts                  # (já existe) — decorado via withReflection, não alterado
├── plan-and-execute.ts       # (já existe) — decorado via withReflection, não alterado
├── reflection.ts             # NOVO — withReflection(strategy, opts), crítico padrão, tipos CriticVerdict/ReflectionOptions
└── reflection.test.ts        # NOVO — testes determinísticos do loop de reflexão (fakes, sem rede)

src/arena.ts                  # ALTERADO — registra reflect:react e reflect:plan-and-execute
```

**Structure Decision**: nenhuma mudança de estrutura em relação à 001. `reflection.ts`
entra em `src/agents/` como mais uma peça de orquestração (mesmo nível de
`react.ts`/`plan-and-execute.ts`), consumindo apenas o contrato `ReasoningStrategy` já
existente — não depende de `services/` nem `models/`. `arena.ts` ganha duas linhas de
registro a mais; nenhum outro arquivo já existente precisa mudar (nem `tools.ts`, nem
`trace.ts`, nem os testes da 001).

## Complexity Tracking

*Nenhuma violação da constitution foi identificada nesta feature — seção não aplicável.*

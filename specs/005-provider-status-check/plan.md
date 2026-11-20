# Implementation Plan: Status de Provedores Externos

**Branch**: `005-provider-status-check` | **Date**: 2026-09-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-provider-status-check/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Nova tool `check_provider_status`, sem dependência do `OpsStore`, que consulta a
statuspage.io pública de um provedor (`github` default, ou `cloudflare`) e
devolve uma linha compacta com o indicador de saúde e a descrição atual — para
o plantonista distinguir "é nosso ou é do provedor?" sem sair da conversa
(spec.md, User Story 1). A chamada usa `fetch` nativo do Node com timeout de
5s via `AbortSignal.timeout`, uma única nova tentativa para falha de rede/5xx,
validação da resposta com `zod`, e nunca lança — qualquer falha final vira uma
string de erro legível devolvida como resultado da tool (spec.md, User Story
2/FR-007, Constitution Princípio IV).

## Technical Context

**Language/Version**: TypeScript (ESM, `strict: true`) sobre Node.js 22 LTS+ —
mesmo stack já em uso; `fetch`/`Response`/`AbortSignal.timeout` já tipam
corretamente com o `tsconfig.json` atual (verificado nesta sessão).

**Primary Dependencies**: `fetch` nativo do Node (zero dependência nova),
`zod` (validação da resposta e do schema da tool), `@langchain/core` (`tool()`)
— mesmas dependências já presentes no `package.json`.

**Storage**: N/A — esta feature não lê nem escreve nenhum dado do `OpsStore`;
é uma consulta somente leitura a um serviço HTTP de terceiros, sem estado
próprio.

**Testing**: `node:test` via `tsx`, como o resto do projeto — `fetch` é
injetado como parâmetro para os testes rodarem com um fake, sem rede real
(spec.md FR-010/SC-005).

**Target Platform**: mesmo processo Node.js que já expõe as tools do
`OpsStore` (CLI `arena`/`bench` e servidor HTTP) — a tool nova é só mais um
item do array de tools passado às estratégias de raciocínio.

**Project Type**: single project — sem mudança de estrutura além de um novo
módulo dentro de `src/agents/`.

**Performance Goals**: N/A — sem alvo formal; o teto de 5s por tentativa (10s
no pior caso, com uma retentativa) já é o requisito de responsividade da spec
(FR-005/SC-002).

**Constraints**: timeout de 5s por tentativa via `AbortSignal.timeout`; exatamente
uma nova tentativa para falha de rede ou HTTP 5xx; HTTP 4xx e resposta que não
bate com o schema Zod NÃO são retentados (falha final imediata); a tool nunca
lança — todo erro final vira string `"Erro: ..."` retornada como resultado
(Constitution Princípio IV).

**Scale/Scope**: 2 provedores suportados nesta versão (github, cloudflare);
uma tool nova; sem UI, sem persistência.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Avaliação |
|---|---|
| I. Validação na Fronteira (Zod) | PASS — o parâmetro `provider` da tool é validado com `z.enum(["github","cloudflare"])`; a resposta HTTP do provedor é validada com um schema Zod antes de ser usada (dado externo não confiável, mesmo raciocínio de "fronteira" aplicado a uma resposta de rede, não só a input HTTP/CLI). |
| II. Test-First | PASS — plano exige testes cobrindo sucesso, timeout e resposta inválida, todos com `fetch` fake (sem rede real), antes da feature ser considerada pronta (spec.md FR-010). |
| III. Arquitetura em Camadas (MVC) | PASS — a tool é a única camada que fala com a API externa (equivalente ao Model desta capacidade, isolado do `OpsStore`); nenhuma lógica de negócio de incidentes é tocada. |
| IV. Erros de Domínio como Classes na Borda | PASS (adaptado) — não há erro de domínio do `OpsStore` aqui; a "borda" é a própria tool: qualquer falha (rede, timeout, validação) é capturada dentro da tool e traduzida em string `"Erro: ..."`, nunca uma exceção não tratada escapando para a estratégia de raciocínio. |
| V. Funções Puras | PASS — a classificação de retry (5xx/rede → retenta; 4xx/resposta inválida → não retenta) e a formatação da linha de resposta são funções puras; o único efeito colateral (a chamada HTTP) fica isolado atrás do parâmetro `fetch` injetável. |
| VI. Segredos Nunca Expostos | PASS — nenhuma chave de API é usada (statuspage.io pública, sem autenticação); nada aqui toca `.env`. |

Nenhuma violação — não há necessidade de preencher Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/005-provider-status-check/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md         # Phase 1 output (/speckit-plan command)
├── contracts/            # Phase 1 output (/speckit-plan command)
│   └── provider-status-tool.md
└── tasks.md              # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/agents/
├── provider-status-tool.ts       # NOVO — createProviderStatusTool(fetchImpl?)
│                                  # sem dependência de OpsStore; injeta fetch
│                                  # para testabilidade (contracts/provider-status-tool.md)
├── provider-status-tool.test.ts  # NOVO — sucesso, timeout, resposta inválida,
│                                  # tudo com fetch fake (sem rede real)
├── tools.ts                       # inalterado — continua só as tools do OpsStore
└── ...                            # demais módulos de agents/ inalterados

src/arena.ts   # tools = [...createOpsTools(store), createProviderStatusTool()]
src/index.ts   # idem
src/bench.ts   # idem — mesmo toolset de produção fica disponível no benchmark
```

**Structure Decision**: nova tool vive em módulo próprio
(`src/agents/provider-status-tool.ts`, não `tool.ts` como no texto original do
usuário — nome mais descritivo para não colidir/confundir com `tools.ts`),
separado de `tools.ts` porque não depende do `OpsStore` — evita acoplar uma
integração HTTP externa à camada de persistência de incidentes. Composição
concatena os dois arrays de tools nos três pontos onde as tools já são
montadas hoje (`index.ts`, `arena.ts`, `bench.ts`).

## Complexity Tracking

> Sem violações de constitution a justificar — seção deixada vazia de propósito.

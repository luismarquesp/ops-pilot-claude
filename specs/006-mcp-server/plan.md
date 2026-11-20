# Implementation Plan: MCP Server (stdio) para OpsPilot

**Branch**: `006-mcp-server` | **Date**: 2026-09-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-mcp-server/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Expor `list_alerts`, `open_incident` e `resolve_incident` também via MCP (stdio),
como um segundo transporte sobre a mesma lógica de negócio já usada pelo agente
LangChain. Para que o `OpsStore` e os schemas zod sejam realmente uma única fonte
de verdade (FR-003/FR-004), a lógica de cada ação (schema de entrada + chamada ao
`OpsStore` + erro de domínio) é extraída de `src/agents/tools.ts` para um módulo
neutro de transporte (`src/agents/ops-actions.ts`); tanto as tools LangChain
quanto o novo servidor MCP (`src/mcp/server.ts`, `@modelcontextprotocol/sdk`,
`StdioServerTransport`) importam desse módulo e só decidem, cada um à sua
maneira, como formatar o erro de domínio na resposta do seu próprio protocolo. O
servidor nunca escreve em stdout (FR-008); todo diagnóstico vai para stderr.

## Technical Context

**Language/Version**: TypeScript (ESM, `strict: true`) sobre Node.js 22 LTS (constitution); SDK exige apenas Node >=18.

**Primary Dependencies**: `@modelcontextprotocol/sdk` (novo — `McpServer` + `StdioServerTransport`, subpaths `@modelcontextprotocol/sdk/server/mcp.js` e `@modelcontextprotocol/sdk/server/stdio.js`); `zod` (já existe, v4, schemas reaproveitados); `tsx` (já existe, roda o script `mcp` sem build).

**Storage**: SQLite via `node:sqlite` (`SqliteOpsStore`, já existente) — mesmo caminho/variável `OPSPILOT_DB` usado pelo restante da aplicação; nenhum store novo ou paralelo.

**Testing**: `node:test` via `tsx` (padrão já usado no projeto). O par cliente/servidor MCP é testado em memória com `InMemoryTransport.createLinkedPair()` do próprio SDK (sem subprocesso real), reaproveitando `createMockOpsStore()` já existente em `src/store/mock-ops-store.ts`. Um teste dedicado garante que nada é escrito em `process.stdout` durante a execução (guarda de FR-008).

**Target Platform**: processo Node local, iniciado por um cliente MCP via stdio (mesmo runtime do resto do projeto — dev em Windows, CI/produção em Linux).

**Project Type**: projeto único existente (Node/TypeScript) — adiciona `src/mcp/` como novo ponto de entrada, sem introduzir um segundo projeto/pacote.

**Performance Goals**: nenhuma meta nova além da já implícita pelo `OpsStore` (leituras/escritas locais em SQLite, tipicamente sub-100ms) — o transporte MCP não adiciona processamento relevante sobre a chamada ao store.

**Constraints**: FR-008 é uma restrição rígida — nenhuma escrita em stdout fora dos frames do protocolo MCP (nada de `console.log`/`console.info`/`console.warn` em `src/mcp/**`; diagnóstico, se necessário, usa `console.error` ou `process.stderr.write`).

**Scale/Scope**: um processo por conexão de cliente MCP (uso local típico de stdio), expondo exatamente 3 ferramentas (`list_alerts`, `open_incident`, `resolve_incident`) — sem `list_incidents`/`consultar_runbook` nesta versão (ver spec, Assumptions).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Validação na Fronteira (Zod)** — PASS. O servidor MCP é uma nova fronteira externa (mesma categoria de "entrada externa" que HTTP/CLI já cobertas). As mesmas instâncias de schema zod hoje usadas por `list_alerts`/`open_incident`/`resolve_incident` em `src/agents/tools.ts` são movidas para `src/agents/ops-actions.ts` e importadas por ambos os transportes — nenhum schema novo ou divergente é criado para o MCP.
- **II. Test-First** — PASS (compromisso do plano). `research.md`/`quickstart.md` definem como testar sem subprocesso real; a fase de tasks DEVE criar `src/mcp/server.test.ts` (e testes para `ops-actions.ts`, se a extração introduzir lógica nova) antes/junto da implementação, cobrindo FR-011 e a guarda de stdout (FR-008).
- **III. Arquitetura em Camadas (MVC)** — PASS. `src/mcp/server.ts` funciona como um Controller (traduz protocolo MCP ↔ ações), sem falar com `OpsStore` diretamente nem reimplementar regra de negócio; a lógica de ação vive em `src/agents/ops-actions.ts` (camada de serviço, já existia implicitamente dentro de `tools.ts`), e `OpsStore`/`SqliteOpsStore` continuam sendo a única camada que fala SQL.
- **IV. Erros de Domínio como Classes na Borda** — PASS. `ServiceNotFoundError`/`IncidentNotFoundError` continuam sendo lançados pelo `OpsStore`/service e são capturados na borda de cada transporte: `tools.ts` formata como string `"Erro: ..."` (comportamento já existente, inalterado); `src/mcp/server.ts` formata como `{ content: [...], isError: true }` — nenhuma exceção de domínio atravessa para fora da tool/handler em nenhum dos dois transportes.
- **V. Funções Puras** — PASS. As funções extraídas para `ops-actions.ts` continuam com a mesma forma (entrada tipada → chamada ao `OpsStore` → retorno ou erro lançado); nenhum efeito colateral novo é introduzido além do já existente (I/O do `OpsStore`).
- **VI. Segredos Nunca Expostos** — PASS. Nenhuma variável de ambiente sensível é necessária para esta feature (`OPSPILOT_DB` não é segredo); caso o script `mcp` precise carregar `.env` no futuro, segue o mesmo mecanismo nativo (`--env-file-if-exists`) já usado pelo script `dev`, sem `dotenv` e sem logar valores.

Nenhuma violação — **Complexity Tracking** fica vazio.

## Project Structure

### Documentation (this feature)

```text
specs/006-mcp-server/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── mcp-tools.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── agents/
│   ├── ops-actions.ts        # NOVO — schemas zod + funções de ação (list/open/resolve),
│   │                          # única fonte de verdade reutilizada pelos dois transportes
│   ├── ops-actions.test.ts   # NOVO — testes da lógica de ação isolada do transporte
│   ├── tools.ts               # EXISTENTE — refatorado para importar de ops-actions.ts
│   │                          # em vez de definir schema/lógica inline
│   ├── tools.test.ts          # EXISTENTE — inalterado no comportamento observável
│   └── ...                    # demais arquivos de agents/ inalterados
├── mcp/
│   ├── server.ts               # NOVO — McpServer + StdioServerTransport, server "opspilot",
│   │                          # registra list_alerts/open_incident/resolve_incident;
│   │                          # nenhum console.log; diagnóstico (se houver) em stderr
│   └── server.test.ts          # NOVO — valida tools/list via InMemoryTransport +
│                                # guarda de "nada em stdout"
├── store/                     # EXISTENTE — OpsStore/SqliteOpsStore/MockOpsStore inalterados
├── http/                      # EXISTENTE — inalterado
└── index.ts                   # EXISTENTE — inalterado (continua só HTTP/LangChain)

package.json                  # adiciona script "mcp": "tsx src/mcp/server.ts"
                                # (ou com --env-file-if-exists=.env, ver research.md)
```

**Structure Decision**: projeto único (sem frontend/mobile). Duas adições sobre a
estrutura já existente: `src/agents/ops-actions.ts` (lógica de ação compartilhada,
extraída de `tools.ts` para ser a única fonte de verdade entre os dois
transportes) e `src/mcp/` (novo transporte MCP/stdio, espelhando o papel de
`src/http/`). Nenhum diretório novo de nível superior — segue o mesmo layout
`src/<camada>/` já usado pelo resto do projeto.

## Complexity Tracking

> Nenhuma violação da Constitution Check — seção não aplicável, tabela omitida.

---

description: "Task list for MCP Server (stdio) para OpsPilot"
---

# Tasks: MCP Server (stdio) para OpsPilot

**Input**: Design documents from `specs/006-mcp-server/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/mcp-tools.md](./contracts/mcp-tools.md), [quickstart.md](./quickstart.md)

**Tests**: incluídos e obrigatórios — a constitution do projeto (Princípio II,
Test-First) exige que toda lógica nova nasça com teste, e o pedido original já
citava explicitamente "Test: sobre o server e valida o list de tools".

**Organization**: tarefas agrupadas por user story (spec.md) para permitir
implementação e teste independentes de cada uma.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: a qual user story esta tarefa pertence (US1, US2, US3)
- Caminhos de arquivo exatos em cada descrição

## Path Conventions

Projeto único Node/TypeScript (ver [plan.md](./plan.md#project-structure)):
`src/agents/`, `src/mcp/`, testes colocalizados como `*.test.ts` (padrão já
usado no projeto, sem diretório `tests/` separado).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: preparar a dependência e o script npm do servidor MCP.

- [X] T001 Instalar `@modelcontextprotocol/sdk` (`npm install @modelcontextprotocol/sdk`), adicionando-o a `dependencies` em `package.json` e atualizando `package-lock.json`.
- [X] T002 [P] Adicionar o script `"mcp": "tsx src/mcp/server.ts"` em `scripts` de `package.json` (sem carregamento de env — ver [research.md](./research.md#6-variáveis-de-ambiente-e-script-npm)).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: extrair a fonte única de verdade (schemas zod + lógica de ação
sobre o `OpsStore`) e criar o esqueleto do servidor MCP — nenhuma user story
pode começar antes disso.

**⚠️ CRITICAL**: nenhuma tarefa de user story pode começar até esta fase estar completa.

- [X] T003 [P] Criar `src/agents/ops-actions.ts`: mover (sem alterar regras) os três schemas zod hoje inline em `src/agents/tools.ts` para constantes exportadas `listAlertsInputSchema`, `openIncidentInputSchema`, `resolveIncidentInputSchema`, e criar as funções `listAlertsAction(store, input)`, `openIncidentAction(store, input)`, `resolveIncidentAction(store, input)` que apenas chamam o método correspondente de `OpsStore` e deixam `ServiceNotFoundError`/`IncidentNotFoundError` propagarem (ver [data-model.md](./data-model.md)).
- [X] T004 [P] Criar `src/agents/ops-actions.test.ts`: testar as três funções de ação diretamente contra `createMockOpsStore()` (`src/store/mock-ops-store.ts`) — casos de sucesso e de propagação dos erros de domínio — escrito antes da tarefa T003 estar "pronta" (test-first, Princípio II).
- [X] T005 Refatorar `src/agents/tools.ts` para importar schemas e (onde fizer sentido) as funções de ação de `ops-actions.ts` em vez de defini-los inline, preservando exatamente o comportamento externo hoje coberto por `src/agents/tools.test.ts` (que deve continuar verde sem alteração). Depende de T003.
- [X] T006 Criar o esqueleto de `src/mcp/server.ts`: uma função `createOpsMcpServer(store: OpsStore): McpServer` que instancia `new McpServer({ name: "opspilot", version: "1.0.0" })` (import de `@modelcontextprotocol/sdk/server/mcp.js`), sem registrar nenhuma tool ainda; e um bloco de entrypoint (`if (import.meta.url === ...)` ou equivalente) que cria a `SqliteOpsStore`, chama `createOpsMcpServer`, conecta via `StdioServerTransport` (`@modelcontextprotocol/sdk/server/stdio.js`) e faz `await server.connect(transport)`. Nenhum `console.log`/`console.info`/`console.warn` em todo o arquivo — apenas `console.error` (stderr) se necessário. Depende de T001.
- [X] T007 [P] Criar `src/mcp/test-support/stdout-guard.ts`: helper reutilizável de teste que substitui temporariamente `process.stdout.write`, executa um callback assíncrono e falha (`assert`) se houve qualquer escrita, restaurando o `write` original ao final (inclusive em caso de exceção).

**Checkpoint**: `ops-actions.ts` e `tools.ts` testados e verdes; `src/mcp/server.ts` conecta via `StdioServerTransport` sem nenhuma tool registrada ainda — a partir daqui as user stories podem começar.

---

## Phase 3: User Story 1 - Conectar um cliente MCP e ver as ferramentas disponíveis (Priority: P1) 🎯 MVP

**Goal**: um cliente MCP conectado ao processo (stdio) do servidor `opspilot` descobre, via `tools/list`, exatamente as três ferramentas esperadas — com nome, descrição e schema corretos — sem que nada além do protocolo MCP apareça em stdout.

**Independent Test**: conectar um `Client` MCP de teste ao `McpServer` (par em memória, ver [research.md §5](./research.md#5-testar-o-servidor-mcp-sem-subir-um-processo-real)) e chamar `listTools()`, validando nome/descrição/schema das três ferramentas e a ausência total de escrita em stdout.

### Tests for User Story 1

> **NOTE**: escrever estes testes primeiro; eles devem falhar até as tarefas de implementação abaixo serem concluídas.

- [X] T008 [P] [US1] Em `src/mcp/server.test.ts`: teste que conecta um `Client` MCP a `createOpsMcpServer(createMockOpsStore())` via `InMemoryTransport.createLinkedPair()`, chama `listTools()` e valida que a resposta contém exatamente `list_alerts`, `open_incident`, `resolve_incident`, cada uma com a `description` e o `inputSchema` equivalentes ao contrato em [contracts/mcp-tools.md](./contracts/mcp-tools.md).
- [X] T009 [P] [US1] Em `src/mcp/server.test.ts`: teste que usa o helper `stdout-guard` (T007) envolvendo a conexão + `listTools()` do teste acima, garantindo zero escritas em `process.stdout` (FR-008/SC-004).

### Implementation for User Story 1

- [X] T010 [US1] Em `src/mcp/server.ts`, dentro de `createOpsMcpServer`, registrar a tool `list_alerts` via `server.registerTool("list_alerts", { description, inputSchema: listAlertsInputSchema.shape }, handler)`, com `handler` chamando `listAlertsAction` (de `ops-actions.ts`) e retornando `{ content: [{ type: "text", text: JSON.stringify(alerts) }] }`. Depende de T006, T003. (Nota de implementação: passado `listAlertsInputSchema` diretamente, não `.shape` — a tipagem instalada do SDK aceita `AnySchema`, então o `ZodObject` completo é aceito e é ainda mais fiel a "mesma fonte de verdade" que extrair `.shape`; comportamento observável idêntico, confirmado pelos testes T008/T013.)
- [X] T011 [US1] Em `src/mcp/server.ts`, registrar a tool `open_incident` (`openIncidentInputSchema.shape`), chamando `openIncidentAction`; em caso de `ServiceNotFoundError`, retornar `{ content: [{ type: "text", text: error.message }], isError: true }` em vez de deixar a exceção propagar. Depende de T006, T003.
- [X] T012 [US1] Em `src/mcp/server.ts`, registrar a tool `resolve_incident` (`resolveIncidentInputSchema.shape`), chamando `resolveIncidentAction`; em caso de `IncidentNotFoundError`, retornar `{ content: [{ type: "text", text: error.message }], isError: true }`. Depende de T006, T003.

**Checkpoint**: T008 e T009 passam — o servidor `opspilot` anuncia corretamente as três ferramentas e não escreve nada fora do protocolo em stdout. As três tools já estão funcionalmente implementadas (a API do SDK exige o handler completo no momento do registro); as próximas fases adicionam a cobertura de teste dedicada a cada chamada.

---

## Phase 4: User Story 2 - Consultar alertas e abrir um incidente por um cliente MCP (Priority: P2)

**Goal**: pela conexão MCP, `list_alerts` e `open_incident` produzem os mesmos resultados (dados e erros de domínio) que as ferramentas LangChain equivalentes.

**Independent Test**: pelo par cliente/servidor em memória, chamar `callTool("list_alerts", ...)` e `callTool("open_incident", ...)` e validar sucesso e erro de serviço inexistente.

### Tests for User Story 2

- [X] T013 [P] [US2] Em `src/mcp/server.test.ts`: `callTool("list_alerts", {})` contra `createMockOpsStore()` retorna os alertas com status `firing` (comportamento padrão), igual ao que `list_alerts` já produz via LangChain.
- [X] T014 [P] [US2] Em `src/mcp/server.test.ts`: `callTool("open_incident", { title, service, severity })` com dados válidos retorna o incidente criado (`status: "open"`, `resolvedAt: null`).
- [X] T015 [P] [US2] Em `src/mcp/server.test.ts`: `callTool("open_incident", { ..., service: "servico-inexistente" })` retorna `isError: true` com mensagem legível (`ServiceNotFoundError`), e uma chamada seguinte bem-sucedida confirma que o processo/servidor continua respondendo normalmente (FR-006, SC-003).

### Implementation for User Story 2

Nenhuma implementação nova é necessária nesta fase — `list_alerts` e `open_incident` já foram implementadas por completo na Fase 3 (T010, T011), já que a API do SDK exige o handler no momento do registro. Caso algum dos testes T013–T015 revele divergência em relação ao contrato, corrigir diretamente em `src/mcp/server.ts`/`src/agents/ops-actions.ts` como parte destas tarefas.

**Checkpoint**: User Stories 1 e 2 funcionam de ponta a ponta e de forma independente.

---

## Phase 5: User Story 3 - Resolver um incidente por um cliente MCP (Priority: P3)

**Goal**: pela conexão MCP, `resolve_incident` fecha o ciclo de vida de um incidente aberto (via `open_incident`), com o mesmo comportamento de erro para ids inexistentes.

**Independent Test**: pelo par cliente/servidor em memória, chamar `callTool("resolve_incident", ...)` com um id válido e com um id inexistente.

### Tests for User Story 3

- [X] T016 [P] [US3] Em `src/mcp/server.test.ts`: `callTool("resolve_incident", { id })` com um id de incidente existente (do `createMockOpsStore()`) retorna o incidente com `status: "resolved"` e `resolvedAt` preenchido.
- [X] T017 [P] [US3] Em `src/mcp/server.test.ts`: `callTool("resolve_incident", { id: <inexistente> })` retorna `isError: true` com mensagem legível (`IncidentNotFoundError`), e uma chamada seguinte bem-sucedida confirma que o servidor continua respondendo (FR-007, SC-003).

### Implementation for User Story 3

Nenhuma implementação nova é necessária — `resolve_incident` já foi implementada por completo na Fase 3 (T012). Corrigir em `src/mcp/server.ts`/`src/agents/ops-actions.ts` apenas se T016/T017 revelarem divergência em relação ao contrato.

**Checkpoint**: as três user stories funcionam de ponta a ponta, cada uma comprovável de forma independente.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: consolidar documentação e validar a feature como um todo.

- [X] T018 [P] Atualizar [AGENTS.md](../../AGENTS.md) para listar `npm run mcp` junto dos demais scripts já documentados (`dev`, `arena`, `bench`, `typecheck`).
- [X] T019 Rodar `npm run typecheck` e `npm test` na raiz do projeto e confirmar que toda a suíte (existente + nova) está verde.
- [X] T020 [P] Executar a validação manual descrita em [quickstart.md](./quickstart.md) (`npx @modelcontextprotocol/inspector npm run mcp`) e confirmar cada item do "Critério de pronto" daquele documento. (Nota de execução: o Inspector é uma UI interativa em navegador, indisponível neste shell não interativo; substituído por um smoke test com o `Client`/`StdioClientTransport` reais do próprio SDK spawnando `node --import tsx src/mcp/server.ts` como subprocesso de verdade — tools/list retornou as 3 ferramentas, as 3 chamadas + 1 erro de domínio funcionaram ponta a ponta, e uma segunda checagem, spawnando o processo cru e inspecionando os bytes brutos de stdout, confirmou que só há frames JSON-RPC válidos ali, com o diagnóstico em stderr. Script descartado após a execução, não versionado.)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências — pode começar imediatamente.
- **Foundational (Phase 2)**: depende do Setup (T001 para a dependência do SDK) — BLOQUEIA todas as user stories.
- **User Stories (Phase 3+)**: todas dependem da conclusão da fase Foundational.
  - US1 (Phase 3) precisa terminar antes de US2/US3 terem algo para testar, porque US1 é quem registra as três tools (a API do SDK não permite registrar uma tool "incompleta"). US2 e US3 são, na prática, cobertura de teste adicional sobre o que US1 já entrega — mantidas como fases separadas porque cada uma tem seu próprio critério de teste independente (spec.md).
- **Polish (Phase 6)**: depende de todas as user stories desejadas estarem completas.

### Dentro de cada User Story

- Testes (T008/T009, T013–T015, T016/T017) são escritos antes de qualquer implementação nova ser considerada "pronta" — mesmo quando a implementação já existe de uma fase anterior, os testes daquela fase são o critério de aceite.
- Registro de tool depende sempre de T003 (schemas/ações) e T006 (esqueleto do servidor).

### Parallel Opportunities

- T001 e T002 podem rodar em paralelo (arquivos diferentes de `package.json`, mas o mesmo arquivo — na prática, aplicar T001 primeiro e T002 em seguida evita conflito de edição simultânea no mesmo arquivo).
- T003, T004 e T007 são arquivos novos e independentes entre si — podem rodar em paralelo.
- Dentro de cada user story, todos os testes marcados [P] (T008+T009; T013+T014+T015; T016+T017) podem ser escritos em paralelo, pois vivem no mesmo arquivo mas cobrem casos independentes (mesclar depois se necessário).
- T010, T011, T012 tocam o mesmo arquivo (`src/mcp/server.ts`) — não são paralelizáveis entre si, mesmo sem marcação [P] explícita.

---

## Parallel Example: Foundational (Phase 2)

```bash
# Em paralelo, após T001/T002:
Task: "Criar src/agents/ops-actions.ts com schemas e funções de ação (T003)"
Task: "Criar src/agents/ops-actions.test.ts cobrindo as funções de ação (T004)"
Task: "Criar src/mcp/test-support/stdout-guard.ts (T007)"

# Em seguida (depende de T003):
Task: "Refatorar src/agents/tools.ts para consumir ops-actions.ts (T005)"
Task: "Criar o esqueleto de src/mcp/server.ts (T006)"
```

## Parallel Example: User Story 1

```bash
# Testes em paralelo (mesmo arquivo, casos independentes):
Task: "Teste de tools/list com as 3 ferramentas esperadas (T008)"
Task: "Teste de ausência de escrita em stdout durante conexão/list (T009)"

# Implementação sequencial (mesmo arquivo src/mcp/server.ts):
Task: "Registrar list_alerts (T010)"
Task: "Registrar open_incident (T011)"
Task: "Registrar resolve_incident (T012)"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Completar a Fase 1 (Setup).
2. Completar a Fase 2 (Foundational) — bloqueia tudo o resto.
3. Completar a Fase 3 (User Story 1): as três tools já ficam funcionalmente implementadas e o servidor `opspilot` já é utilizável de ponta a ponta por qualquer cliente MCP.
4. **Parar e validar**: rodar T008/T009 e confirmar a descoberta correta das ferramentas.

### Incremental Delivery

1. Setup + Foundational → base pronta.
2. User Story 1 → testar de forma independente → já é o MVP (servidor completo e descobrível).
3. User Story 2 → adiciona cobertura de teste dedicada para `list_alerts`/`open_incident` → testar de forma independente.
4. User Story 3 → adiciona cobertura de teste dedicada para `resolve_incident` → testar de forma independente.
5. Polish → documentação (AGENTS.md), gate final (`typecheck`/`test`), validação manual via quickstart.

## Notes

- [P] = arquivos diferentes (ou casos independentes no mesmo arquivo de teste), sem dependência de tarefa incompleta.
- Diferente do padrão genérico do template, aqui US2/US3 não introduzem implementação nova porque a API do `@modelcontextprotocol/sdk` (`registerTool`) exige o handler completo já no momento do registro (Fase 3) — a divisão por user story continua válida como critério de teste/aceite independente, não como sequência de implementação.
- Verificar que os testes falham antes da tarefa de implementação correspondente ser considerada concluída (Princípio II da constitution).
- Rodar `npm run typecheck` e `npm test` sempre que um grupo de tarefas for concluído, não só na Fase 6.

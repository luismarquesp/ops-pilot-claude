---

description: "Task list template for feature implementation"
---

# Tasks: Status de Provedores Externos

**Input**: Design documents from `/specs/005-provider-status-check/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/, quickstart.md

**Tests**: Incluídos — pedidos explicitamente pela spec (FR-010) e pela
constitution (Princípio II, Test-First).

**Organization**: Tasks agrupadas por user story para permitir implementação e
teste independentes de cada uma.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: A qual user story a tarefa pertence (US1, US2)
- Caminhos de arquivo exatos em cada descrição

## Path Conventions

Projeto único, testes co-localizados como `*.test.ts` (convenção já usada no
repo). Caminhos relativos à raiz do repositório.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: preparar os tipos/constantes que a tool vai usar — sem nenhuma
dependência nova (`fetch`/`AbortSignal.timeout` são nativos do Node 22 e já
tipam com o `tsconfig.json` atual).

- [X] T001 Criar `src/agents/provider-status-tool.ts` com os tipos e constantes do `data-model.md`: `Provider` (`"github" | "cloudflare"`), `StatusIndicator` (`"none" | "minor" | "major" | "critical"`), mapa `PROVIDER_STATUS_URLS` (provider → URL da statuspage.io), e o schema Zod `statusPageResponseSchema` (`{ status: { indicator, description } }`) — sem lógica de fetch/retry ainda

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: implementar a tool por completo (transporte + retry + validação
+ formatação) antes de testá-la ou integrá-la — é uma função única e coesa,
não dá para dividir a lógica entre as user stories.

**🚨 CRITICAL**: Nenhuma user story pode começar antes desta fase estar completa.

- [X] T002 Implementar `createProviderStatusTool(fetchImpl: typeof fetch = fetch): StructuredToolInterface` em `src/agents/provider-status-tool.ts`: schema da tool (`provider: z.enum(["github","cloudflare"]).default("github").describe(...)`), passo de transporte (`fetch` + `{ signal: AbortSignal.timeout(5000) }`, HTTP `5xx` tratado como falha retryable), uma única retentativa automática para falha de rede/timeout/`5xx`, parse do JSON + `statusPageResponseSchema.parse(...)` (HTTP `4xx` e resposta fora do schema NÃO são retentados), retorno de sucesso como `"${provider}: ${indicator} — ${description}"`, e captura de qualquer falha final retornando `"Erro: não foi possível consultar o status do ${provider} (${motivo})."` (nunca lança) — conforme `contracts/provider-status-tool.md` — depende de T001
- [X] T003 Criar `src/agents/provider-status-tool.test.ts` com um `fetchImpl` fake configurável (respostas customizáveis por chamada, contador de invocações) reutilizado pelos testes de US1 e US2 — depende de T002

**Checkpoint**: tool completa, pronta para ser testada e integrada nas composições.

---

## Phase 3: User Story 1 - Checar se o problema é nosso ou do provedor (Priority: P1) 🎯 MVP

**Goal**: o plantonista consegue perguntar pelo status de GitHub ou Cloudflare
de dentro da conversa e recebe uma resposta objetiva de uma linha.

**Independent Test**: `quickstart.md` passos 2-4 — pedir o status do GitHub
(default), do Cloudflare, e de um provedor não suportado via `arena`.

### Tests for User Story 1

- [X] T004 [US1] Teste em `src/agents/provider-status-tool.test.ts`: `provider` omitido → `fetchImpl` é chamado com a URL do GitHub (default) — caso 1 de `contracts/provider-status-tool.md` — depende de T003
- [X] T005 [US1] Teste em `src/agents/provider-status-tool.test.ts`: `provider: "cloudflare"` → `fetchImpl` é chamado com a URL do Cloudflare, não a do GitHub — caso 2 — depende de T003
- [X] T006 [US1] Teste em `src/agents/provider-status-tool.test.ts`: `provider` fora do enum → tool rejeita antes de qualquer chamada, `fetchImpl` fake nunca é invocado — caso 3 — depende de T003
- [X] T007 [US1] Teste em `src/agents/provider-status-tool.test.ts`: sucesso na 1ª tentativa → retorna a linha compacta `"${provider}: ${indicator} — ${description}"` — caso 4 — depende de T003

### Implementation for User Story 1

- [X] T008 [P] [US1] Integrar a tool na composição: `src/index.ts`, `src/arena.ts` e `src/bench.ts` passam a montar o array de tools como `[...createOpsTools(store), createProviderStatusTool()]` — depende de T002
- [X] T009 [US1] Rodar `npm run typecheck` e `npm test`; validar manualmente `quickstart.md` passos 2-4 via `arena` (GitHub default, Cloudflare, provedor inválido) — depende de T004-T008. Validado com dados reais: GitHub "none — All Systems Operational"; Cloudflare "minor — Minor Service Outage" (incidente real detectado ao vivo); "AWS" corretamente recusado sem nenhuma chamada de tool (0 invocações de `check_provider_status`)

**Checkpoint**: User Story 1 completa e testável de forma independente — consulta de status funcionando ponta a ponta.

---

## Phase 4: User Story 2 - Resposta confiável mesmo quando o provedor está lento ou instável (Priority: P2)

**Goal**: falha de rede/timeout/`5xx` ganha uma retentativa automática; `4xx`
e resposta em formato inesperado falham direto; toda falha final vira uma
string de erro legível, nunca uma exceção.

**Independent Test**: com o `fetchImpl` fake do `provider-status-tool.test.ts`,
simular timeout, falha de rede seguida de sucesso, `5xx` persistente, `4xx`, e
resposta fora do schema — conferir o número de chamadas e o resultado em cada
caso.

### Tests for User Story 2

- [X] T010 [US2] Teste em `src/agents/provider-status-tool.test.ts`: 1ª tentativa falha por rede (`fetchImpl` rejeita a promise) e a 2ª tem sucesso → retorna a linha compacta normalmente, `fetchImpl` chamado exatamente 2x — caso 5 — depende de T003
- [X] T011 [US2] Teste em `src/agents/provider-status-tool.test.ts`: 1ª e 2ª tentativa retornam HTTP `500` → retorna a string de erro, `fetchImpl` chamado exatamente 2x — caso 6 — depende de T003
- [X] T012 [US2] Teste em `src/agents/provider-status-tool.test.ts`: `fetchImpl` nunca resolve (respeita o `AbortSignal` do timeout) → tool retorna a string de erro em vez de travar o teste — caso 7 — depende de T003
- [X] T013 [US2] Teste em `src/agents/provider-status-tool.test.ts`: HTTP `404` → retorna a string de erro imediatamente, `fetchImpl` chamado exatamente 1x (sem retentativa) — caso 8 — depende de T003
- [X] T014 [US2] Teste em `src/agents/provider-status-tool.test.ts`: corpo da resposta fora do schema Zod (`status` ausente, ou `indicator` fora do enum) → retorna a string de erro imediatamente, `fetchImpl` chamado exatamente 1x (sem retentativa) — caso 9 — depende de T003

### Implementation for User Story 2

- [X] T015 [US2] Rodar `npm run typecheck` e `npm test`, confirmando os 9 casos de `contracts/provider-status-tool.md` verdes — depende de T010-T014. Todos os 9 casos verdes (suíte completa: 60/60)

**Checkpoint**: User Stories 1 e 2 funcionam juntas — consulta de status resiliente a falha de rede/timeout/resposta inesperada.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: consistência final da descrição da tool nova frente às tools já
existentes, e validação de ponta a ponta.

- [X] T016 [P] Revisar a descrição de `check_provider_status` em `src/agents/provider-status-tool.ts` contra o checklist de 6 regras (`contracts/provider-status-tool.md` §"Descrição da tool") — conferir que não sobrepõe frase-gatilho com `open_incident`/`list_incidents`. Revisada: as 6 regras conferem; confirmado ao vivo que o modelo nunca confundiu esta tool com as do OpsStore
- [X] T017 Rodar `npm run typecheck` e `npm test` (suíte completa do projeto, não só desta feature) e validar `quickstart.md` do início ao fim — depende de todas as tarefas anteriores. `typecheck` limpo; 60/60 testes; quickstart passos 1-4 validados (passo 5 é só uma nota, sem ação)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências — pode começar imediatamente
- **Foundational (Phase 2)**: depende do Setup — BLOQUEIA todas as user stories
- **User Story 1 (Phase 3)**: depende só do Foundational
- **User Story 2 (Phase 4)**: depende do Foundational; os testes de US2
  (T010-T014) escrevem no mesmo arquivo que os de US1 (T004-T007) —
  `provider-status-tool.test.ts` — então, embora US2 não dependa
  *funcionalmente* de US1, os dois conjuntos de teste não podem ser editados
  ao mesmo tempo por pessoas diferentes sem conflito de arquivo
- **Polish (Phase 5)**: depende de US1 + US2 completas

### Dentro de cada Fase

- Foundational: `T002` → `T003` (mesmo arquivo/assunto, sequencial)
- US1: `T004`-`T007` sequenciais entre si (mesmo arquivo de teste); `T008` é
  independente (arquivos de composição, não o de teste) → paralelo a
  `T004`-`T007`; `T009` fecha a fase, depende de tudo antes
- US2: `T010`-`T014` sequenciais entre si (mesmo arquivo de teste); `T015`
  fecha a fase
- Polish: `T016` independente (só toca a descrição da tool); `T017` fecha,
  depende de tudo

### Parallel Opportunities

- US1: `T008` (composição) roda em paralelo aos testes `T004`-`T007`.
- Setup/Foundational/testes de uma mesma user story são majoritariamente
  sequenciais nesta feature — é um único arquivo de implementação e um único
  arquivo de teste, então o paralelismo real é limitado (diferente da feature
  004, que tinha múltiplos arquivos de store).

---

## Parallel Example: User Story 1

```bash
# T008 (composição) pode rodar ao mesmo tempo que os testes T004-T007,
# já que toca arquivos diferentes (index.ts/arena.ts/bench.ts vs. o .test.ts):
Task: "Integrar a tool em src/index.ts, src/arena.ts e src/bench.ts"
Task: "Escrever os testes de provider default/seleção/enum inválido/sucesso em provider-status-tool.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Completar Setup (T001)
2. Completar Foundational (T002-T003) — CRÍTICO, bloqueia tudo
3. Completar User Story 1 (T004-T009)
4. **PARAR e VALIDAR**: consulta de status funciona via `arena`, para os dois provedores e para um inválido
5. Esse já é o valor central da feature — pode ser considerado entregável sozinho

### Incremental Delivery

1. Setup + Foundational → tool implementada e pronta para testar
2. + US1 → testar independentemente → consulta de status funcionando (MVP)
3. + US2 → testar independentemente → resiliência a falha/timeout/resposta inesperada
4. Polish → consistência da descrição + validação ponta a ponta

---

## Notes

- `[P]` = arquivos diferentes, sem dependência pendente
- `[Story]` mapeia a tarefa à user story correspondente, para rastreabilidade
- Foundational fica sob Test-First (Constitution Princípio II): a tool só é
  considerada pronta com os 9 casos de `contracts/provider-status-tool.md`
  passando
- Parar em qualquer checkpoint para validar a story isoladamente antes de seguir
- Evitar: tarefas vagas, dois tasks [P] no mesmo arquivo, dependências entre stories que quebrem a independência

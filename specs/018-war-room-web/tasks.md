---

description: "Task list for 018-war-room-web"
---

# Tasks: War room web

**Input**: Design documents from `specs/018-war-room-web/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md) e [contracts/](./contracts/)

**Tests**: obrigatórios (constitution, Princípio II).

- Cada fatia escreve o teste antes e o vê falhar **pelo motivo certo**:
  asserção, não erro de sintaxe ou de import.
- API: `node:test` via `tsx`, com `npm test` na raiz.
- Web: Vitest, com `npm --prefix web test`. O desvio está justificado no plan.

**Organization**: as tarefas estão agrupadas por user story.

- API em `src/`, web em `web/`.
- Arquivos CRLF continuam CRLF: `src/http/server.ts`, `src/http/server.test.ts`,
  `src/index.ts`, `AGENTS.md`.
- Arquivos novos usam LF.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência pendente).
- **[Story]**: US1..US5 do spec.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: o pacote `web/` existe, builda sob `/opspilot/` e roda testes.

- [X] T001 Criar o pacote `web/`:
  - `web/package.json`, com scripts `dev`, `build`, `preview`, `test`
    (`vitest run`) e `typecheck` (`tsc --noEmit`);
  - dependências fixas: `react`/`react-dom` 18, `zod` 4 e `react-markdown`;
  - dev: `vite`, `@vitejs/plugin-react`, `typescript`, `vitest`, `jsdom`,
    `@testing-library/react`, `@testing-library/user-event`, `vitest-axe` e
    `@types/react*`;
  - rodar `npm --prefix web install`.
- [X] T002 [P] Criar `web/vite.config.ts`:
  - `base: "/opspilot/"`;
  - plugin React;
  - bloco `test`: `environment: "jsdom"`, `setupFiles: ["src/test/setup.ts"]`,
    `css: true`.
- [X] T003 [P] Criar `web/tsconfig.json` (`strict`, `noUncheckedIndexedAccess`,
  `jsx: react-jsx`, `moduleResolution: bundler`, `types: ["vite/client",
  "vitest/globals"]`) e `web/index.html` (`<html lang="pt-BR">`,
  `<meta name="color-scheme" content="light dark">`, título "OpsPilot · War
  room").
- [X] T004 [P] Criar `web/src/test/setup.ts`, que registra os matchers do
  `vitest-axe` e do Testing Library e faz `cleanup` depois de cada teste.
- [X] T005 [P] Criar `web/src/styles/tokens.css`, com os tokens das design
  instructions:
  - cores semânticas (`--color-bg`, `surface`, `text`, `muted`, `border`,
    `primary`, `danger`, `warning`, `success`, `info`, `focus`);
  - `--space-1..16`, `--text-xs..2xl`, raios e duração;
  - temas claro, escuro via `prefers-color-scheme` com
    `:root:not([data-theme="light"])`, e `:root[data-theme="dark"]`.

  Criar também `web/src/styles/global.css`:
  - reset;
  - `body` com fundo explícito;
  - `:focus-visible` com anel de 2px;
  - `prefers-reduced-motion`;
  - `tabular-nums` utilitário;
  - fonte mono para ids.
- [X] T006 Criar `web/src/main.tsx` e um `web/src/App.tsx` mínimo (header
  "OpsPilot · War room" + `<main>`), importando os dois CSS no `main.tsx`.
  Criar `web/src/App.test.tsx` renderizando o App e conferindo o título.
  Rodar `npm --prefix web test` e `npm --prefix web run build`: o
  `web/dist/index.html` precisa referenciar `/opspilot/assets/`.
- [X] T007 [P] Acrescentar `web/node_modules/` e `web/dist/` ao `.gitignore`.

**Checkpoint**: `npm --prefix web test`, `typecheck` e `build` verdes. O
`npm test` da raiz não mudou.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: a API fala com navegadores (CORS + `/health`), e a web tem
cliente, validação, configuração e o diálogo acessível de que todas as
histórias dependem.

**⚠️ CRITICAL**: nenhuma user story começa antes desta fase.

### API

- [X] T008 [P] Testes de `corsHeaders(origin, allowed, method)` e de
  `parseCorsOrigins(env)` em `src/http/cors.test.ts`, conforme
  [contracts/cors.md](./contracts/cors.md):
  - origem na lista → `Allow-Origin` + `Vary` + `Expose-Headers: X-Request-Id`;
  - preflight → `Allow-Methods`, `Allow-Headers` e `Max-Age`;
  - fora da lista ou lista vazia → `{}`;
  - sem `*` e sem credentials;
  - comparação em minúsculas;
  - `CORS_ORIGINS` com itens inválidos, com caminho ou com barra final →
    ignorados + `invalid: ["CORS_ORIGINS"]`.
- [X] T009 Implementar `src/http/cors.ts`:
  - `corsHeaders` e `parseCorsOrigins`, puras, com zod;
  - `corsMiddleware(allowed)`, que aplica os cabeçalhos e responde 204 aos
    `OPTIONS`.
- [X] T010 Testes HTTP em `src/http/server.test.ts` (CRLF):
  - `GET /health` → 200 `{ status: "ok" }`, sem `requestId`;
  - com `corsOrigins: ["http://localhost:5173"]`:
    - `POST /chat` com `Origin` permitido expõe `X-Request-Id`;
    - `OPTIONS /chat` → 204;
    - origem estranha → sem `Allow-Origin`;
  - sem `corsOrigins` → nenhum cabeçalho CORS.
- [X] T011 Em `src/http/server.ts` (CRLF):
  - `AppDeps.corsOrigins?: readonly string[]`;
  - montar `corsMiddleware` antes de tudo;
  - adicionar `app.get("/health")`.

  Em `src/index.ts` (CRLF): ler `CORS_ORIGINS` via `parseCorsOrigins`, com
  aviso só com o nome da variável. Em `.env.example`: documentar
  `CORS_ORIGINS`.

### Web

- [X] T012 [P] Testes de `web/src/config.test.ts`:
  - `defaultApiUrl({ envUrl, dev, origin })` (research §9);
  - `loadSettings`/`saveSettings` com `localStorage` falso, que inclui um que
    lança em toda chamada: o padrão é devolvido e nada quebra;
  - só as chaves `opspilot.apiUrl`, `opspilot.theme` e
    `opspilot.conversationId`;
  - `apiUrlSchema` aceita http/https e recusa `ftp:`, vazio e lixo.
- [X] T013 [P] Implementar `web/src/config.ts`: `defaultApiUrl`, `apiUrlSchema`
  (zod), `loadSettings`, `saveSettings`, `loadConversationId` e
  `saveConversationId`, com `try/catch` em todo acesso.
- [X] T014 [P] Testes de `web/src/api/schemas.test.ts`:
  - `chatOkSchema`;
  - schemas de erro (`issues`, `conversation_not_found`, `model_unavailable` +
    `modelsTried`, `timeout`, `internal_error`, `unknown_strategy`);
  - `traceEventSchema` aceita um tipo desconhecido pelo ramo genérico;
  - um corpo fora do contrato falha.
- [X] T015 [P] Implementar `web/src/api/schemas.ts`:
  - schemas zod do 200 e dos erros;
  - `traceEventSchema` como união discriminada dos tipos conhecidos,
    `route | plan | thought | action | observation | critique | fallback |
    summarize | answer`, todos com `node`, mais o ramo `unknownTraceEvent`
    (research §10);
  - `metricsSchema`.
- [X] T016 [P] Testes de `web/src/api/client.test.ts`, com `fetch` falso:
  - `postChat` → `{ kind: "ok" }`;
  - os códigos de erro viram `{ kind: "error", code, requestId, ... }`;
  - `TypeError` → `{ kind: "network" }`;
  - corpo fora do schema → `{ kind: "invalid", requestId }`, com
    `requestId` do cabeçalho;
  - `AbortSignal` abortado → `{ kind: "cancelled" }`;
  - a URL é montada sem barra dupla.
- [X] T017 Implementar `web/src/api/client.ts`:
  - `createApiClient({ baseUrl, fetch })`;
  - `postChat({ message, conversationId }, signal)`, que nunca lança e
    devolve uma união discriminada.
- [X] T018 [P] Testes de `web/src/components/Dialog.test.tsx`:
  - abre com o foco no primeiro elemento;
  - `Tab` fica preso dentro;
  - `Esc` fecha e devolve o foco ao gatilho;
  - `role="dialog"` + `aria-modal` + `aria-labelledby`;
  - `axe` sem violações.
- [X] T019 Implementar `web/src/components/Dialog.tsx`, um diálogo acessível
  reutilizado pelo `TraceDrawer` e pelo `SettingsDialog`.

**Checkpoint**: os testes das duas suítes estão verdes, e a API aceita
`http://localhost:5173` com `CORS_ORIGINS`.

---

## Phase 3: User Story 1 - Conversar com o copiloto (Priority: P1) 🎯 MVP

**Goal**: perguntar, ver o progresso e receber a resposta na mesma conversa,
com erros humanos e estado vazio.

**Independent Test**: com a API no ar, duas perguntas seguidas aparecem em
ordem, e a segunda reaproveita a conversa. Com a API devolvendo 503, a
mensagem humana e o `requestId` aparecem, e o texto continua no campo.

### Tests for User Story 1

- [X] T020 [P] [US1] Testes de `web/src/state/chat.test.ts`, para o
  `chatReducer`:
  - `send` acrescenta a mensagem do usuário + assistente `sending`;
  - `answered` guarda `conversationId`, `answer`, `trace`, `metrics` e
    `requestId`;
  - `failed` mantém `draft`;
  - `cancelled`;
  - `newConversation` limpa as mensagens e o id;
  - o reducer não muta o estado.
- [X] T021 [P] [US1] Testes de `web/src/api/errors.test.ts`: `describeError`
  mapeia cada código da tabela das design instructions para
  `{ title, action }`, e `network`/`invalid`/`cancelled` têm mensagens
  próprias. Nenhuma mensagem contém stack ou texto cru.
- [X] T022 [P] [US1] Testes de componentes em
  `web/src/components/chat.test.tsx`:
  - **`MessageList`**:
    - estado vazio com exemplos clicáveis, que preenchem e enviam;
    - `role="log"` + `aria-live`;
    - Markdown renderizado e HTML cru **não** executado (`<img onerror>`
      vira texto).
  - **`Composer`**:
    - envio desativado com texto em branco;
    - `Enter` envia e `Shift+Enter` quebra linha;
    - `<label>` visível.
  - **`PendingIndicator`**:
    - só aparece depois de 300ms (fake timers);
    - mostra os segundos decorridos;
    - botão Cancelar.
  - **`ErrorNotice`**: `requestId` copiável e ação correta.
  - `axe` sem violações em cada um.
- [X] T023 [US1] Teste de integração em `web/src/App.test.tsx`, com `fetch`
  falso:
  - perguntar → resposta;
  - a segunda pergunta envia o `conversationId`;
  - 503 → `ErrorNotice` + texto preservado;
  - "Nova conversa" → lista vazia e a próxima pergunta vai sem id;
  - Cancelar → mensagem cancelada.

### Implementation for User Story 1

- [X] T024 [P] [US1] Implementar `web/src/state/chat.ts` (`chatReducer`, tipos
  `ChatMessage`/`ChatState`, puro).
- [X] T025 [P] [US1] Implementar `web/src/api/errors.ts` (`describeError`,
  puro).
- [X] T026 [P] [US1] Implementar `web/src/components/MessageList.tsx`,
  `AssistantMessage.tsx` (com `react-markdown`, sem `rehype-raw`),
  `Composer.tsx`, `PendingIndicator.tsx` e `ErrorNotice.tsx`, só com tokens.
- [X] T027 [US1] Ligar tudo em `web/src/App.tsx`:
  - `useReducer`;
  - cliente criado a partir das configurações;
  - `AbortController` por envio;
  - `conversationId` salvo via `saveConversationId`;
  - botão "Nova conversa" no header.

**Checkpoint**: a US1 funciona sozinha contra a API real (quickstart §4,
item 1).

---

## Phase 4: User Story 2 - Ver o raciocínio (Priority: P1)

**Goal**: "Ver raciocínio" abre o rastro tipado do turno, com métricas.

**Independent Test**: depois de uma pergunta que usa uma tool, o painel mostra
os passos na ordem e com o tipo certo. Um tipo desconhecido não quebra, e
`Esc` devolve o foco ao botão.

### Tests for User Story 2

- [X] T028 [P] [US2] Gerar as fixtures de contrato em
  `src/http/fixtures.export.test.ts` (research §11):
  - sobe o `createApp` com fakes;
  - grava `web/src/test/fixtures/chat-ok.json` (rastro com `route`,
    `action`, `observation` e `answer`), `chat-fallback.json`,
    `chat-summarize.json` e `chat-503.json`;
  - só grava quando `OPSPILOT_WRITE_FIXTURES=1`;
  - sem a variável, compara com o arquivo existente e falha se divergir.
- [X] T029 [P] [US2] Em `web/src/api/schemas.test.ts`, validar todas as
  fixtures de `web/src/test/fixtures/` com os schemas da web.
- [X] T030 [P] [US2] Testes de `web/src/components/trace.test.tsx`:
  - `TraceStep` renderiza ícone + rótulo de texto + `node` para cada tipo
    conhecido;
  - `action` mostra `tool` e `args` formatados;
  - `plan` mostra a lista numerada;
  - `fallback` aparece como aviso;
  - tipo desconhecido usa a forma genérica;
  - conteúdo longo é recolhível.
  - `TraceDrawer`:
    - métricas no topo (`llmCalls`, `promptTokens`, `latencyMs`,
      `modelUsed`, cortes);
    - "sem passos";
    - abre pelo botão "Ver raciocínio" e fecha com `Esc`, devolvendo o foco.
  - `axe` sem violações.

### Implementation for User Story 2

- [X] T031 [P] [US2] Implementar `web/src/components/traceMeta.ts`
  (`TRACE_STEP_META`: tipo → `{ label, icon }`, pura) e
  `web/src/components/TraceStep.tsx`, com `switch` exaustivo (`never` no
  `default` dos conhecidos) e ramo genérico.
- [X] T032 [US2] Implementar `web/src/components/TraceDrawer.tsx` sobre o
  `Dialog`. Adicionar o botão "Ver raciocínio" em `AssistantMessage.tsx`.
- [X] T033 [US2] Gerar as fixtures (`OPSPILOT_WRITE_FIXTURES=1 npm test --
  src/http/fixtures.export.test.ts`) e rodar as duas suítes.

**Checkpoint**: US1 + US2 entregam a war room de leitura.

---

## Phase 5: User Story 3 - Aprovar ou negar ações sensíveis (Priority: P2)

**Goal**:
- **API**: pausa antes de `open_incident`/`resolve_incident` (202), decisão
  atômica, execução única e retomada por replay.
- **Web**: cartão aprovar/negar, recuperação depois de recarregar e
  expiração.

**Independent Test**: "resolva o incidente 3" gera um cartão. Negar deixa o
incidente aberto. Aprovar resolve. Um segundo `approve` recebe 409. Ao
recarregar com o cartão pendente, o cartão volta.

### Tests for User Story 3 — API

- [X] T034 [P] [US3] Testes de `src/agents/approvals.test.ts`:
  - `isSensitiveTool`;
  - `callKey`: estável com chaves em outra ordem e diferente com args
    diferentes;
  - `approvalSummary` para as duas tools;
  - `ledgerObservation`: aprovada → resultado, negada/expirada → "negado pelo
    plantonista; não executado";
  - `ledgerPromptSection`: vazio → `""`.
- [X] T035 [P] [US3] Suíte de contrato em
  `src/store/approval-store.contract-tests.ts`, rodada por
  `src/store/mock-approval-store.test.ts` e
  `src/store/sqlite-approval-store.test.ts`:
  - `create`/`get`;
  - `listPending` em ordem, omitindo as expiradas e marcando-as;
  - `decide`:
    - `pending` → `approved`/`denied`;
    - a segunda decisão lança `ApprovalAlreadyDecidedError`;
    - depois de `expires_at`, lança `ApprovalExpiredError` e o status fica
      `expired`;
    - id inexistente → `ApprovalNotFoundError`;
  - `saveResult`;
  - `ledger(turnId)` só com as decididas.

  Só no SQLite: a aprovação sobrevive a uma nova instância no mesmo arquivo
  (FR-013c).
- [X] T036 [P] [US3] Testes de `src/agents/approval-gate.test.ts`:
  - sem escopo, a tool embrulhada executa direto;
  - dentro de `trackApprovals`:
    - a primeira chamada sensível não executa, devolve
      `APPROVAL_PENDING_OBSERVATION` e registra a pendência;
    - uma segunda chamada sensível diferente não é registrada;
  - com livro:
    - a chamada idêntica aprovada devolve o resultado guardado sem executar;
    - a negada devolve a negação;
  - tools não sensíveis passam direto.
- [X] T037 [P] [US3] Testes em `src/services/chat-service.test.ts`, com
  estratégia falsa que chama a tool embrulhada:
  - pausa → `PendingApproval` com aprovação gravada (`turnId`, `route`,
    `reflect`, `message`);
  - conversa criada vazia quando não veio id;
  - nada gravado na conversa;
  - `learn` não chamado;
  - rastro termina em `approval`, com os eventos posteriores cortados.
- [X] T038 [P] [US3] Testes de `src/services/approval-service.test.ts`:
  - `decideApproval(approve)` executa a ação **uma vez**: o `OpsStore` falso
    conta as chamadas, mesmo com duas decisões concorrentes (`Promise.all`)
    → uma passa e a outra recebe 409;
  - guarda o resultado;
  - retoma com override da rota guardada e `source: "resume"`;
  - o rastro final começa com `decision`;
  - o turno final grava pergunta + resposta e dispara o `learn`;
  - `deny` não executa;
  - expirada → `ApprovalExpiredError` sem executar;
  - turno retomado que pausa numa ação nova → novo `PendingApproval`, com o
    mesmo `turnId` e o livro acumulado.
- [X] T039 [P] [US3] Testes de `src/http/approval-routes.test.ts` e de
  `src/http/server.test.ts` (CRLF):
  - `POST /chat` 202 no formato de
    [contracts/chat-approvals-api.md](./contracts/chat-approvals-api.md),
    registrado em `requests` com `status 202`;
  - `POST /chat/approvals/:id`: 200, 202 encadeado, 400 (não-UUID ou corpo),
    404, 409, 410;
  - `GET /chat/approvals?conversationId=` → só pendentes; 400 se não for
    UUID;
  - `requestId` em todos os corpos.
- [X] T040 [P] [US3] Testes de log em `src/obs/log-fields.test.ts`:
  - `approval` → só `approvalId` + `tool`, sem `args`/`summary`;
  - `decision` → `approvalId` + `decision`, sem `result`.

  Testes de rótulo em `src/agents/trace.test.ts`.

### Implementation for User Story 3 — API

- [X] T041 [P] [US3] Implementar `src/agents/approvals.ts` (puras,
  data-model.md) e adicionar os eventos `approval`/`decision` ao `TraceEvent`
  em `src/agents/strategy.ts`. Em `src/agents/router.ts`, adicionar
  `"resume"` à `RouteSource`. Em `src/agents/trace.ts`, adicionar os
  rótulos.
- [X] T042 [P] [US3] Implementar `src/store/approval-store.ts` (interface +
  tipos), `src/store/sqlite-approval-store.ts` (DDL idempotente, índices,
  `UPDATE` condicional) e `src/store/mock-approval-store.ts`. Em
  `src/services/errors.ts`, adicionar `ApprovalNotFoundError`,
  `ApprovalAlreadyDecidedError` e `ApprovalExpiredError`.
- [X] T043 [US3] Implementar `src/agents/approval-gate.ts`:
  - `trackApprovals(fn, { ledger })`, com `AsyncLocalStorage`;
  - `withApprovalGate(tool)`;
  - `pendingApproval()`.

  Em `src/agents/index.ts`, embrulhar as tools sensíveis na montagem do
  registry.
- [X] T044 [US3] Em `src/context/context-builder.ts`, aceitar `decisions` e
  emitir `ledgerPromptSection` logo antes da pergunta, nunca cortada. Os
  testes atuais do `buildContext` continuam iguais sem `decisions`.
- [X] T045 [US3] Em `src/graph/production-graph.ts`:
  - `ProductionInput` ganha `resume?: { route }` e `decisions?`;
  - o roteador emite `source: "resume"` sem chamar o modelo;
  - o nó da estratégia insere o evento `approval` depois do `action`
    pendente e corta o resto.
- [X] T046 [US3] Em `src/services/chat-service.ts`:
  - `runChat` roda dentro de `trackApprovals`;
  - devolve `ChatResult | PendingApproval` (`kind`);
  - na pausa: cria a conversa se preciso, grava a `Approval` (TTL de 15 min)
    e não grava mensagens nem chama o `learn`;
  - aceita `resume` (`turnId`, `route`, `decisions`).
- [X] T047 [US3] Implementar `src/services/approval-service.ts`:
  - `decideApproval`: decide atômico → executa via `ops-actions` se aprovou
    → `saveResult`;
  - `resumeTurn`: livro + `runChat` com resume e evento `decision` no início;
  - `listPendingApprovals`.
- [X] T048 [US3] Implementar `src/http/approval-routes.ts` (zod no `:id`, no
  corpo e no `conversationId`; erros de domínio → 404/409/410). Em
  `src/http/server.ts` (CRLF):
  - `AppDeps.approvals?`;
  - 202 do `/chat`;
  - montar as rotas sob `/chat/approvals`, dentro do `requestContext`;
  - `RequestErrorCode` com os três códigos novos em
    `src/store/request-store.ts`.
- [X] T049 [US3] Em `src/obs/log-fields.ts`, adicionar os campos permitidos de
  `approval`/`decision`. Em `src/index.ts` (CRLF), instanciar
  `SqliteApprovalStore` e passar o `OpsStore` ao serviço de aprovação.

### Tests for User Story 3 — Web

- [X] T050 [P] [US3] Exportar as fixtures `chat-202.json` e
  `approval-decided-200.json` em `src/http/fixtures.export.test.ts`, e
  validá-las em `web/src/api/schemas.test.ts` (`chatPendingSchema`,
  `approvalListSchema` e os erros 409/410).
- [X] T051 [P] [US3] Testes no `web/src/state/chat.test.ts`:
  - `paused` cria o cartão `pending`;
  - `send` recusado com cartão pendente;
  - `decide` → `deciding`;
  - `decided` → `approved`/`denied` + resposta final;
  - `decideFailed` volta a `pending` com erro;
  - 409/410 aplicam o status devolvido;
  - `restore` (recarregar) cria os cartões e a flag `resumed`.
- [X] T052 [P] [US3] Testes de `web/src/components/ApprovalCard.test.tsx`:
  - resumo em linguagem humana;
  - "Detalhes técnicos" recolhível;
  - Aprovar é a ação primária;
  - duplo clique gera uma única chamada;
  - botões desativados fora de `pending`;
  - contagem até expirar;
  - estados `approved`/`denied`/`expired`/erro;
  - `Composer` bloqueado com explicação;
  - `axe` sem violações.
- [X] T053 [US3] Teste de integração em `web/src/App.test.tsx`:
  - 202 → cartão;
  - Negar → resposta final;
  - recarregar (remontar o App com `conversationId` salvo) → `GET
    /chat/approvals` → o cartão volta.

### Implementation for User Story 3 — Web

- [X] T054 [P] [US3] Em `web/src/api/schemas.ts`, adicionar
  `chatPendingSchema`, `approvalListSchema`, os erros de aprovação e os
  eventos `approval`/`decision`. Em `web/src/api/client.ts`, adicionar
  `postChat` com `kind: "pending"`, `decideApproval(id, decision)` e
  `listPendingApprovals(conversationId)`.
- [X] T055 [P] [US3] Implementar `web/src/components/ApprovalCard.tsx`. Em
  `web/src/components/TraceStep.tsx` e `traceMeta.ts`, adicionar
  `approval`/`decision`.
- [X] T056 [US3] Em `web/src/state/chat.ts` e `web/src/App.tsx`:
  - ações de aprovação;
  - bloqueio do `Composer`;
  - recuperação no carregamento quando há `conversationId` salvo, com o aviso
    "Conversa retomada".

**Checkpoint**: quickstart §3 e §4 (item 3) passam. Nenhuma ação sensível roda
sem "Aprovar" (SC-003).

---

## Phase 6: User Story 4 - Apontar para outra API (Priority: P2)

**Goal**: a engrenagem configura o endereço da API, testa a conexão e
distingue "inacessível" de "origem não autorizada".

**Independent Test**: trocar para outra porta, perguntar e ver a resposta vir
dela. Recarregar mantém o endereço. Uma URL inválida mostra erro no campo.

- [X] T057 [P] [US4] Testes de `testConnection` em
  `web/src/api/client.test.ts` (research §7):
  - ok → `connected`;
  - `TypeError` + `no-cors` resolve → `cors_blocked`;
  - as duas falham → `unreachable`;
  - status ≠ 200 → `unexpected`.
- [X] T058 [P] [US4] Testes de `web/src/components/SettingsDialog.test.tsx`:
  - abre pela engrenagem (`aria-label="Configurações"`);
  - mostra o padrão;
  - URL inválida → erro junto ao campo (`aria-invalid` +
    `aria-describedby`) e nada salvo;
  - "Testar conexão" mostra os três resultados;
  - salvar outra URL chama `onSave`;
  - seletor de tema claro/escuro/sistema aplica `data-theme` no `<html>`;
  - `axe` sem violações.
- [X] T059 [US4] Teste em `web/src/App.test.tsx`: salvar uma URL diferente
  inicia nova conversa e as próximas chamadas vão para a URL nova.
- [X] T060 [US4] Implementar:
  - `testConnection` em `web/src/api/client.ts`;
  - `web/src/components/SettingsDialog.tsx` e
    `web/src/components/ThemeToggle.tsx`;
  - em `web/src/App.tsx`: botão engrenagem no header, `newConversation` ao
    trocar a URL e tema persistido.

**Checkpoint**: quickstart §4 (item 4) passa.

---

## Phase 7: User Story 5 - Publicar sob um caminho e acessar de outra origem (Priority: P3)

**Goal**: a versão publicada funciona sob `/opspilot/` e fala com a API
liberada por CORS.

**Independent Test**: `npm --prefix web run preview` em `/opspilot/` não tem
nenhum 404. Origem permitida funciona e origem estranha é bloqueada.

- [X] T061 [P] [US5] Teste em `web/src/build.test.ts`: roda `vite build` num
  diretório temporário e confere que todo `src=`/`href=` do `index.html`
  começa com `/opspilot/` (SC-007).
- [X] T062 [US5] Configurar `preview` com `base` em `web/vite.config.ts`. Em
  `web/README.md`, documentar:
  - publicação sob `/opspilot/` (exemplo de `location /opspilot/` com
    fallback para `index.html`);
  - `VITE_OPSPILOT_API_URL`;
  - a necessidade de incluir a origem publicada em `CORS_ORIGINS`.

**Checkpoint**: quickstart §2 e §5 passam.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T063 [P] Teste de acessibilidade em `web/src/a11y.test.tsx`: renderiza
  conversa com respostas, `TraceDrawer` aberto, `ApprovalCard` pendente e
  `SettingsDialog`, com `data-theme="light"` e `"dark"`. `axe` sem violações
  sérias nos dois temas (SC-005).
- [X] T064 [P] Teste de teclado em `web/src/keyboard.test.tsx`: o fluxo
  perguntar → ver raciocínio → aprovar → configurar roda só com
  `userEvent.keyboard`/`tab` (SC-006).
- [X] T065 [P] Atualizar `AGENTS.md` (CRLF):
  - seção "War room web" (pacote `web/`, comandos `npm --prefix web …`, base
    `/opspilot/`);
  - seção "Aprovação de ações sensíveis" (portão, 202,
    `/chat/approvals`, replay, TTL, eventos `approval`/`decision`,
    `source: "resume"`);
  - seção "CORS e /health";
  - incluir `CORS_ORIGINS`.
- [X] T066 [P] Atualizar `.env.example` com `CORS_ORIGINS` e criar
  `web/.env.example` com `VITE_OPSPILOT_API_URL`.
- [X] T067 Rodar `npm run typecheck`, `npm test`,
  `npm --prefix web run typecheck`, `npm --prefix web test` e
  `npm --prefix web run build`, e executar o [quickstart.md](./quickstart.md)
  contra a API real, com banco descartável no scratchpad. Registrar o
  resultado no fim deste arquivo.
- [X] T068 Recomendar ao usuário uma emenda MINOR à constitution
  (`/speckit-constitution`), que acrescente à Stack o pacote `web/` (React,
  Vite, Vitest). Não aplicar sem pedido.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (1)** → **Foundational (2)** → histórias.
- **US1** depende só da fase 2. **US2** depende da US1 (botão na
  `AssistantMessage`).
- **US3 — API** (T034–T049) depende só da fase 2 e pode andar **em paralelo**
  com US1/US2.
- **US3 — Web** (T050–T056) depende da US1 e da US3 — API.
- **US4** depende da US1 (header/App). Pode correr em paralelo com US2/US3.
- **US5** depende da fase 1 e da fase 2 (CORS). É independente das outras
  histórias.
- **Polish** depende de todas.

### Within Each User Story

- O teste vem antes e falha pela asserção.
- Na API: puras → store → gate/grafo → service → controller. Na web:
  schema/cliente → reducer → componentes → App.
- `server.ts`, `server.test.ts`, `App.tsx` e `chat.ts` são arquivos
  compartilhados: as tarefas que os tocam são sequenciais entre histórias.

### Parallel Opportunities

- **Fase 1**: T002–T005, T007.
- **Fase 2**: T008, T012, T014, T016 e T018 (testes) e depois T013 e T015.
- **US1**: T020–T022 juntos e depois T024–T026 juntos.
- **US3 — API**: T034–T040 (testes, todos em arquivos distintos, menos o
  `server.test.ts`) e depois T041 e T042.
- **Duas frentes**: uma pessoa ou agente em US3 — API enquanto outra faz
  US1 → US2 → US4 na web.

## Parallel Example: User Story 3 — API

```text
Task: "T034 Testes de src/agents/approvals.test.ts"
Task: "T035 Suíte de contrato do ApprovalStore"
Task: "T036 Testes de src/agents/approval-gate.test.ts"
Task: "T040 Testes de log-fields e trace"
# depois
Task: "T041 approvals.ts + eventos + RouteSource"
Task: "T042 ApprovalStore (interface, SQLite, mock) + erros"
```

## Implementation Strategy

### MVP First (US1)

1. Fases 1 e 2.
2. US1. Validar com a API real: conversa, erros e cancelamento.
3. Parar e demonstrar. Isso já substitui o `curl`.

### Incremental Delivery

1. Fases 1 + 2 + US1 → MVP de conversa.
2. US2 → war room de leitura (raciocínio).
3. US3 → aprovação (API + web), a principal proteção de produção.
4. US4 → endereço configurável.
5. US5 + Polish → publicação, acessibilidade verificada e docs.

---

## Resultado da validação (2026-11-20)

- **Automático**:
  - API: `npm run typecheck` limpo; `npm test` 500/500 (baseline: 424).
  - Web: `npm --prefix web run typecheck` limpo; `npm --prefix web test` 189/189;
    `build` com o JS inicial a 115 KB gzip (meta < ~200 KB).
- **API real** (banco descartável, `CORS_ORIGINS=http://localhost:5173`):
  - `/health` → 200.
  - Preflight de origem permitida → 204 com `Allow-Origin` e `Expose-Headers:
    X-Request-Id`. Origem estranha → sem cabeçalho CORS.
  - "abra um incidente high em payments…" → **202**, com
    `approval.tool = open_incident`, os args certos e o rastro
    `route → action → approval`.
  - `GET /chat/approvals` → 1 pendente.
  - **Negar** → 200: o rastro começa em `decision: denied` + `route: resume`
    e nenhum incidente foi aberto.
  - Repetir a decisão → 409. A lista fica vazia depois.
  - `GET /requests/<id do 202>` → `status 202`, `outcome ok`, rastro até o
    `approval`.
  - **Aprovar** (nova pergunta) → 200: o incidente #1 foi aberto **uma** vez
    e `decision.result` traz o incidente.
  - Logs: 0 ocorrências do título do incidente; o `approval` sai só com
    `approvalId` e `tool`.
- **Publicado**: `vite preview` em `/opspilot/` → `index.html`, JS, CSS e uma
  rota desconhecida respondem 200.
- **Não verificado em navegador real**: teclado, temas, zoom de 200% e 360px
  estão cobertos só pelos testes automatizados (jsdom + axe + contraste dos
  tokens). O quickstart §4 interativo ainda não foi feito.
- **Desvios do tasks.md**:
  - Os testes de aprovação do `runChat` ficaram em
    `src/services/chat-service.approvals.test.ts`, e não no
    `chat-service.test.ts` (CRLF).
  - O contrato da API também ganhou a fixture `approvals-list.json`.
  - Os helpers de teste da web estão em `web/src/test/http.ts`.

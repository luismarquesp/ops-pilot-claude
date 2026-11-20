# Implementation Plan: War room web

**Branch**: `018-war-room-web` | **Date**: 2026-11-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/018-war-room-web/spec.md`

## Summary

A feature tem duas partes, entregues em fatias independentes: a API e a web.

### API

**Portão de aprovação** (research §1–§5):

- `withApprovalGate` embrulha `open_incident` e `resolve_incident`. Dentro do
  escopo `trackApprovals`, que só o `runChat` abre, o portão não executa a
  ação: registra a chamada pendente e devolve ao agente uma observação fixa.
- No fim do grafo, se houve pendência, o `runChat` faz três coisas:
  - grava a `Approval`, na tabela nova `approvals` do mesmo `OPSPILOT_DB`;
  - cria a conversa, se ainda não existir;
  - devolve um `PendingApproval`.
- O Controller responde **202**.

**Retomada**:

- `POST /chat/approvals/:id` decide de forma atômica, com `UPDATE`
  condicional.
- Se aprovada, executa a ação **uma vez** via `ops-actions` e guarda o
  resultado.
- Depois roda o turno de novo, com:
  - a mesma pergunta, conversa, usuário, rota (`source: "resume"`) e
    `reflect`;
  - o **livro** de decisões do turno.
- O portão responde do livro, sem executar nem pausar.
- Uma ação nova não decidida pausa de novo (outro 202).
- `GET /chat/approvals?conversationId=` recupera os cartões pendentes depois
  de recarregar a página.
- A expiração é preguiçosa: 15 minutos, tratada como negada.

**Endpoints novos de infraestrutura**: `GET /health` e o middleware CORS
próprio (`CORS_ORIGINS`, lista exata, expõe `X-Request-Id`).

### Web

`web/` é um pacote próprio: Vite + React + TS `strict`, com
`base: "/opspilot/"`.

- **Cliente da API**: `fetch` injetável, schemas zod de todas as respostas e
  `AbortController` para cancelar.
- **Reducer puro da conversa**, com o invariante de cartão pendente bloqueando
  o envio.
- **Componentes** conforme [contracts/web-ui.md](./contracts/web-ui.md):
  `TraceDrawer` tipado por união discriminada, `ApprovalCard` e
  `SettingsDialog` com "Testar conexão" em duas etapas (research §7).
- **Tokens de design e temas** conforme as design instructions.

## Technical Context

**Language/Version**: TypeScript `strict`. API: Node 22, ESM. Web: ES2022 no
navegador.

**Primary Dependencies**:

- **API**: as existentes, sem dependência nova. O CORS é próprio.
- **Web**:
  - `react` e `react-dom` 18;
  - `vite` + `@vitejs/plugin-react`;
  - `zod` 4;
  - `react-markdown`.
- **Web, só em dev**:
  - `vitest`;
  - `@testing-library/react` e `@testing-library/user-event`;
  - `jsdom`;
  - `vitest-axe`.

**Storage**:

- **API**: SQLite (`node:sqlite`), com tabela nova `approvals` em DDL
  idempotente.
- **Web**: `localStorage` só para `apiUrl`, `theme` e `conversationId`
  (FR-021).

**Testing**:

- **API**: `node:test` via `tsx`, com:
  - suíte de contrato do `ApprovalStore` (mock + SQLite);
  - testes do portão com o fake de estratégia que chama tools;
  - testes HTTP do 202, da decisão, do 409, do 410 e do CORS.
- **Web**: Vitest + Testing Library, com:
  - reducer e cliente puros;
  - componentes por estado;
  - axe nos dois temas;
  - fixtures geradas pela API (research §11).

**Target Platform**: navegadores evergreen. A API continua em Node 22.

**Project Type**: web-service existente + SPA nova.

**Performance Goals**: a primeira renderização útil da war room em menos de 1s
em rede local; o bundle inicial deve ficar abaixo de ~200 KB gzip. A espera
pelo `/chat` é limitada pelo timeout de 180s, que já existe.

**Constraints**:

- Nenhuma ação sensível roda sem "Aprovar" (SC-003).
- Uma execução por aprovação.
- Nada de conteúdo de conversa no navegador.
- Funciona sob `/opspilot/`.
- WCAG 2.2 AA.

**Scale/Scope**: uma pessoa por navegador e poucas conversas simultâneas; uma
tela com quatro áreas: conversa, raciocínio, cartão e configurações.

## Constitution Check

*GATE: antes do Phase 0 e de novo depois do Phase 1.*

| Princípio | Situação |
|-----------|----------|
| I. Validação zod na fronteira | ✅ API: `decision`, `:id`, `conversationId` e `CORS_ORIGINS` via zod. Web: toda resposta da API passa por schema zod antes da UI (FR-009) |
| II. Test-first | ✅ API em `node:test`. Web usa Vitest, desvio justificado em Complexity Tracking. `npm run typecheck`/`npm test` da raiz seguem cobrindo a API, e a web tem os seus |
| III. MVC | ✅ Model: `ApprovalStore`. Service: `approval-service` (decidir, executar, retomar) e `runChat`. Controller: `approval-routes` e o `/chat` traduzem para HTTP. A web é cliente e não tem camada de domínio |
| IV. Erros de domínio como classes | ✅ `ApprovalNotFoundError`, `ApprovalAlreadyDecidedError` e `ApprovalExpiredError` são traduzidos no Controller (404/409/410) |
| V. Funções puras | ✅ `callKey`, `approvalSummary`, `ledgerPromptSection`, `corsHeaders`, `parseCorsOrigins`, `chatReducer`, `defaultApiUrl` e o mapa de erros da UI |
| VI. Segredos | ✅ A chave da OpenRouter fica só na API. A web não tem segredo (`VITE_*` é público por definição e só guarda a URL). O `.env` não é lido |
| Stack | ⚠ React/Vite/Vitest não estão na seção Stack, que só descreve a API. Ver Complexity Tracking; uma emenda MINOR à constitution é recomendada depois desta feature |

Reavaliado depois do Phase 1: nenhum princípio foi violado pelo design. Só os
dois desvios registrados abaixo.

## Project Structure

### Documentation (this feature)

```text
specs/018-war-room-web/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── chat-approvals-api.md
│   ├── cors.md
│   └── web-ui.md
└── tasks.md            # /speckit-tasks
```

### Source Code

```text
src/                                   # API (existente)
├── agents/
│   ├── approvals.ts                   # NOVO: SENSITIVE_TOOLS, callKey, approvalSummary, ledger* (puras)
│   ├── approval-gate.ts               # NOVO: withApprovalGate + trackApprovals (AsyncLocalStorage)
│   ├── strategy.ts                    # + eventos approval/decision
│   ├── router.ts                      # + RouteSource "resume"
│   ├── trace.ts                       # + rótulos
│   └── index.ts                       # registry embrulha as tools sensíveis
├── context/context-builder.ts         # + seção de decisões (nunca cortada)
├── graph/production-graph.ts          # + resume (override com source "resume"), corte do rastro na pausa
├── services/
│   ├── chat-service.ts                # runChat → ChatResult | PendingApproval
│   ├── approval-service.ts            # NOVO: decideApproval, resumeTurn, listPendingApprovals
│   └── errors.ts                      # + 3 erros de aprovação
├── store/
│   ├── approval-store.ts              # NOVO: interface
│   ├── sqlite-approval-store.ts       # NOVO
│   ├── mock-approval-store.ts         # NOVO
│   └── approval-store.contract-tests.ts
├── obs/log-fields.ts                  # + approval/decision na lista permitida
├── http/
│   ├── cors.ts                        # NOVO: corsHeaders, parseCorsOrigins, middleware
│   ├── approval-routes.ts             # NOVO: POST /chat/approvals/:id, GET /chat/approvals
│   └── server.ts                      # 202, /health, CORS, AppDeps.approvals/corsOrigins
└── index.ts                           # SqliteApprovalStore, CORS_ORIGINS

web/                                   # NOVO pacote
├── package.json  vite.config.ts  tsconfig.json  index.html
└── src/
    ├── main.tsx  App.tsx
    ├── styles/tokens.css  styles/global.css   # tokens + temas (design instructions)
    ├── config.ts                      # defaultApiUrl, settings em localStorage (try/catch)
    ├── api/
    │   ├── schemas.ts                 # zod: ChatOk, ChatPending, erros, TraceEvent (união + unknown)
    │   ├── client.ts                  # sendChat, decideApproval, listPending, testConnection
    │   └── errors.ts                  # ApiError → mensagem/ação (tabela das design instructions)
    ├── state/chat.ts                  # chatReducer (puro)
    ├── components/
    │   ├── MessageList.tsx  AssistantMessage.tsx  PendingIndicator.tsx  Composer.tsx
    │   ├── TraceDrawer.tsx  TraceStep.tsx  traceMeta.ts
    │   ├── ApprovalCard.tsx  SettingsDialog.tsx  ErrorNotice.tsx  ThemeToggle.tsx
    │   └── Dialog.tsx                 # foco preso, Esc, devolve foco
    └── test/
        ├── setup.ts                   # jsdom + vitest-axe
        └── fixtures/*.json            # geradas por src/http/fixtures.export.test.ts
```

**Structure Decision**:

- A API continua em `src/`, sem reorganizar.
- A web é um pacote isolado em `web/`, com o próprio `package.json`, para que
  os `npm test` e `tsconfig` da raiz não mudem (`include: ["src"]`).
- O `.github/instructions/design.instructions.md` (`applyTo: "web/**"`) já
  cobre a pasta.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Testes da web em Vitest, não em `node:test` (Princípio II cita `node:test`) | componentes React importam CSS e usam `import.meta.env`. O Vitest aplica as mesmas transformações do build do Vite, e o teste testa o que vai ao ar | `node:test` + `tsx` + `global-jsdom` quebra em `import "./x.css"` e em `import.meta.env`, e exigiria stubs que divergem do build |
| Dependências de UI (React, Vite, react-markdown) fora da seção Stack | a spec pede Vite + React + TS. A seção Stack só descreve a API | escrever a UI sem framework (DOM puro) aumenta muito o código de acessibilidade e estado, e contraria o pedido |
| Replay do turno na retomada (refaz chamadas ao modelo) | é a única forma de retomar as três estratégias sem checkpointer persistente (research §1) | checkpointer SQLite do LangGraph exige `better-sqlite3` (proibido). Um checkpointer próprio acopla as estratégias ao grafo |

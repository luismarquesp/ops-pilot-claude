# Data Model: War room web

## API (SQLite, mesmo `OPSPILOT_DB`)

### Tabela `approvals` (nova, `SqliteApprovalStore`, DDL idempotente)

| Coluna            | Tipo    | Regra                                                                          |
| ----------------- | ------- | ------------------------------------------------------------------------------ |
| `id`              | TEXT PK | UUID gerado na pausa                                                           |
| `turn_id`         | TEXT    | UUID do turno; igual em toda a cadeia de pausas do mesmo turno (research §1)   |
| `conversation_id` | TEXT    | NOT NULL — criada na pausa se o pedido não tinha (research §4)                 |
| `request_id`      | TEXT    | `requestId` da requisição que pausou (specs/016)                               |
| `message`         | TEXT    | pergunta original, para o replay                                               |
| `user_id`         | TEXT    | nullable                                                                       |
| `route`           | TEXT    | rota decidida na pausa; o replay usa como override (`source: "resume"`)        |
| `reflect`         | INTEGER | 0/1, repassado ao replay                                                       |
| `tool`            | TEXT    | ∈ `SENSITIVE_TOOLS`                                                            |
| `args_json`       | TEXT    | argumentos validados pelo schema da tool (`ops-actions`)                       |
| `summary`         | TEXT    | `approvalSummary(tool, args)` — linguagem humana                               |
| `status`          | TEXT    | CHECK `pending \| approved \| denied \| expired`                               |
| `created_at`      | TEXT    | ISO                                                                            |
| `expires_at`      | TEXT    | ISO = `created_at + 15 min` (`APPROVAL_TTL_MS`)                                |
| `decided_at`      | TEXT    | nullable                                                                       |
| `result_json`     | TEXT    | nullable; saída da ação aprovada (JSON do incidente ou `"Erro: …"`)            |

Índices: `(conversation_id, status)` e `(turn_id)`.

**Transições** (as demais são proibidas):

```text
pending ──aprovar (antes de expires_at)──▶ approved ──(executa 1×, grava result_json)
pending ──negar   (antes de expires_at)──▶ denied
pending ──qualquer leitura/decisão ≥ expires_at──▶ expired
```

### Interface `ApprovalStore` (`src/store/approval-store.ts`)

- `create(record): Promise<Approval>`
- `get(id, now): Promise<Approval | undefined>` — marca `expired` se for o caso.
- `listPending(conversationId, now): Promise<Approval[]>` — mesma regra de
  expiração; ordem de `created_at`.
- `decide(id, decision, now): Promise<Approval>` — atômico. Lança
  `ApprovalNotFoundError`, `ApprovalAlreadyDecidedError` ou
  `ApprovalExpiredError`.
- `saveResult(id, result): Promise<void>`
- `ledger(turnId): Promise<ApprovalDecision[]>` — decididas do turno.

Implementações: `SqliteApprovalStore` e `createMockApprovalStore`, com a mesma
suíte de contrato (`approval-store.contract-tests.ts`).

### Funções puras (`src/agents/approvals.ts`)

- `SENSITIVE_TOOLS`, `isSensitiveTool(name)`
- `callKey(tool, args)` — JSON canônico, com chaves ordenadas.
- `approvalSummary(tool, args)`:
  - "Abrir incidente SEV2 «Fila travada» em pagamentos";
  - "Resolver o incidente #3".
- `ledgerObservation(decision)` — observação devolvida pelo portão no replay.
- `ledgerPromptSection(ledger)` — seção `Decisões do plantonista neste turno:`
  do `buildContext`. Nunca é cortada pelo orçamento, como a pergunta.

### Eventos novos no rastro (`TraceEvent`, research §5)

- `{ type: "approval"; approvalId; tool; args; summary }`
- `{ type: "decision"; approvalId; decision: "approved" | "denied" | "expired"; result?: string }`
- `RouteSource` ganha `"resume"`.

### `RequestRecord` (specs/016) — sem mudança de schema

- Pausa: `status 202`, `outcome "ok"`, `errorCode null`.
- Decisão: requisição própria, 200 ou 202.
- Novos `RequestErrorCode`: `approval_not_found` (404),
  `approval_already_decided` (409), `approval_expired` (410).

## Web (estado em memória; nada de conteúdo persistido — FR-021)

| Entidade      | Campos                                                                                                                   | Estados                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `ChatMessage` | `id` local, `role` (`user` \| `assistant`), `text`, `requestId?`, `trace?`, `metrics?`, `error?`                         | `sending` → `answered` \| `failed` \| `cancelled`             |
| `TraceStep`   | união discriminada por `type` + ramo `unknown` (research §10)                                                            | —                                                             |
| `ApprovalCard`| `approvalId`, `tool`, `args`, `summary`, `expiresAt`, `requestId`, `error?`                                              | `pending` → `deciding` → `approved` \| `denied` \| `expired`; `deciding` → `pending` (falha) |
| `Settings`    | `apiUrl` (URL http/https), `theme` (`light` \| `dark` \| `system`)                                                       | —                                                             |
| `Session`     | `conversationId?`, `resumed` (veio de recarregar)                                                                        | —                                                             |

Reducer puro `chatReducer(state, action)` em `web/src/state/chat.ts`. Ações:

- `send`, `answered`, `paused`, `failed`, `cancelled`;
- `decide`, `decided`, `decideFailed`;
- `newConversation`, `restore`.

Invariante: com um `ApprovalCard` em `pending` ou `deciding`, `send` é
recusada (FR-012).

`localStorage` guarda só as chaves `opspilot.apiUrl`, `opspilot.theme` e
`opspilot.conversationId`.

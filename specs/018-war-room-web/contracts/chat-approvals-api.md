# Contract: aprovação de ações sensíveis (API)

Emenda a [specs/016-persisted-trace-logs/contracts/chat-api.md](../../016-persisted-trace-logs/contracts/chat-api.md).
O request do `POST /chat` não muda. Tudo sob `/chat` passa pelo
`requestContext`, então toda resposta traz `X-Request-Id` e `requestId` no
corpo.

## POST /chat → 202 (novo)

Quando o agente tenta `open_incident` ou `resolve_incident` dentro de um turno
do `/chat`:

```json
{
  "requestId": "0f8d6a1e-…",
  "conversationId": "5b1f3c2e-…",
  "status": "approval_required",
  "approval": {
    "id": "a1b2c3d4-…",
    "tool": "resolve_incident",
    "args": { "id": 3 },
    "summary": "Resolver o incidente #3",
    "createdAt": "2026-11-20T12:00:00.000Z",
    "expiresAt": "2026-11-20T12:15:00.000Z"
  },
  "trace": [
    { "type": "route", "route": "react", "reason": "…", "source": "router", "node": "roteador" },
    { "type": "action", "tool": "resolve_incident", "args": { "id": 3 }, "node": "react" },
    { "type": "approval", "approvalId": "a1b2c3d4-…", "tool": "resolve_incident", "args": { "id": 3 }, "summary": "Resolver o incidente #3", "node": "react" }
  ],
  "metrics": { "…": "mesmo formato do 200" }
}
```

- O 202 nunca traz `answer`, e a resposta do LLM daquele turno é descartada.
- O rastro termina no evento `approval`.
- A pergunta **não** é gravada na conversa e o `learn` não dispara. A conversa
  é criada (vazia) se o pedido não tinha `conversationId`.
- O registro em `requests` é gravado com `status 202`, `outcome "ok"` e o
  rastro acima.

## POST /chat/approvals/:id (novo)

Request: `{ "decision": "approve" | "deny" }`. O corpo é validado por zod, e o
`:id` precisa ser UUID.

| Status | Quando | Corpo |
|--------|--------|-------|
| 200 | decidida; o turno retomado terminou | mesmo corpo do `POST /chat` 200, com rastro começando por `{ "type": "decision", "approvalId", "decision", "result"?, "node": "contexto" }` e `route` com `source: "resume"` |
| 202 | decidida; o turno retomado pausou numa **outra** ação sensível | mesmo corpo do 202 acima, com uma nova `approval` |
| 400 | id não-UUID ou corpo inválido | `{ requestId, issues }` |
| 404 | aprovação inexistente | `{ requestId, error: "approval_not_found", approvalId }` |
| 409 | já decidida | `{ requestId, error: "approval_already_decided", approvalId, status }` |
| 410 | expirada (≥ 15 min) | `{ requestId, error: "approval_expired", approvalId }` |
| 503 / 504 / 500 | falha no turno retomado | mesmos corpos do `/chat`. Se a decisão foi `approve`, a ação **já foi executada**, e a aprovação fica `approved` com `result` |

Regras:

- Aprovar executa a ação no máximo uma vez, mesmo com decisões concorrentes.
  O perdedor recebe 409.
- Negar nunca executa.
- No turno retomado, uma chamada idêntica (`callKey`) a uma ação já decidida
  devolve a decisão guardada, sem pausar nem executar.
- Pergunta e resposta são gravadas na conversa só no 200 final, e o `learn`
  dispara só nele.

## GET /chat/approvals?conversationId=<uuid> (novo)

Recupera os cartões depois de recarregar a página.

- 200 → `{ requestId, approvals: [ { id, tool, args, summary, status, createdAt, expiresAt } ] }`
  - só `pending`, com expiradas já marcadas e omitidas;
  - ordem de `createdAt`.
- 400 se `conversationId` não for UUID.
- Conversa sem aprovações → `{ approvals: [] }`.

## GET /health (novo)

- `200 { "status": "ok" }`
- Sem dependências, não é gravado em `requests` e não tem `requestId`.
- Serve ao "Testar conexão" da web (research §7).

## Eventos do rastro (`GraphTraceEvent`)

| type | campos | node | log (`chat.trace.event`) |
|------|--------|------|--------------------------|
| `approval` | `approvalId`, `tool`, `args`, `summary` | rota da estratégia | `approvalId`, `tool` |
| `decision` | `approvalId`, `decision`, `result?` | `contexto` | `approvalId`, `decision` |

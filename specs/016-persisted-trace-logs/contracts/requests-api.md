# Contract: GET /requests/:id

Montado só quando o app recebe um `RequestStore` (`AppDeps.requests`). Não
tem autenticação, como `/chat` e `/memories`.

## 200

```json
{
  "request": {
    "id": "0f8d6a1e-...",
    "startedAt": "2026-11-17T12:00:00.000Z",
    "durationMs": 4210,
    "status": 200,
    "outcome": "ok",
    "errorCode": null,
    "conversationId": "5b1f3c2e-...",
    "userId": "ana",
    "route": "react",
    "routeSource": "router",
    "modelUsed": "...",
    "promptTokens": 1830,
    "latencyMs": 4100,
    "metrics": { "llmCalls": 3, "latencyMs": 4100, "promptTokens": 1830, "modelUsed": "...", "...": "ChatMetrics completo" }
  },
  "trace": [
    { "type": "route", "route": "react", "reason": "...", "source": "router", "node": "roteador" },
    { "type": "action", "tool": "list_alerts", "args": {}, "node": "react" },
    { "type": "observation", "content": "...", "node": "react" },
    { "type": "answer", "content": "...", "node": "react" }
  ]
}
```

- `trace` vem em ordem de ocorrência. A posição de cada evento é o seu
  índice. É igual (`deepEqual`) ao `trace` da resposta do `/chat`, e
  `request.metrics` é igual a `metrics`.
- Em turno com erro: `outcome: "error"`, `status` e `errorCode` preenchidos; `metrics`, `modelUsed`, `promptTokens` e `latencyMs` como `null`,
  `route` e `routeSource` como `null`, e `trace: []`.

## Erros

| Status | Corpo |
|--------|-------|
| 400 | `{ issues }` — `:id` não é UUID |
| 404 | `{ error: "request_not_found", requestId }` — nunca gravado, ou a gravação falhou |

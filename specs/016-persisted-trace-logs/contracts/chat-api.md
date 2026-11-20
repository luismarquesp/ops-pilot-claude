# Contract: POST /chat (revisão para requestId)

Emenda a [specs/015-model-resilience/contracts/chat-api.md](../../015-model-resilience/contracts/chat-api.md).
Request inalterado. Um cabeçalho `X-Request-Id` enviado pelo cliente é
ignorado.

## Toda resposta

- Cabeçalho `X-Request-Id: <uuid>`, gerado pelo servidor e único por
  requisição.
- Corpo com `requestId` igual ao cabeçalho, somado aos campos de hoje.

## 200

```json
{
  "requestId": "0f8d6a1e-...",
  "conversationId": "5b1f3c2e-...",
  "answer": "...",
  "trace": [ { "type": "route", "route": "react", "reason": "...", "source": "router", "node": "roteador" }, "..." ],
  "metrics": { "...": "inalterado" }
}
```

## Erros

| Status | Corpo | Persistido em `requests`? |
|--------|-------|---------------------------|
| 400 validação | `{ requestId, issues }` | não |
| 422 estratégia | `{ requestId, error: "unknown_strategy", strategy, available }` | não |
| 404 conversa | `{ requestId, error: "conversation_not_found", conversationId }` | sim, sem rastro |
| 503 modelo | `{ requestId, error: "model_unavailable", modelsTried }` | sim, sem rastro |
| 504 tempo | `{ requestId, error: "timeout", timeoutMs }` | sim, sem rastro |
| 500 inesperado no turno | `{ requestId, error: "internal_error" }` | sim, sem rastro |
| 500 JSON malformado | `{ requestId, error: "internal_error" }` | não |

Uma falha ao persistir não muda nenhuma linha desta tabela.

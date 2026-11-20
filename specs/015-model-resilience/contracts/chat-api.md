# Contract: POST /chat (revisão para resiliência de modelo)

Emenda a [specs/014-unified-production-graph/contracts/chat-api.md](../../014-unified-production-graph/contracts/chat-api.md).
Request inalterado.

## 200 — turno em que a reserva assumiu

```json
{
  "conversationId": "5b1f3c2e-...",
  "answer": "...",
  "trace": [
    { "type": "fallback", "from": "openai/gpt-oss-20b:free", "to": "meta-llama/llama-3.3-70b-instruct:free", "reason": "RateLimitError", "node": "roteador" },
    { "type": "route", "route": "react", "reason": "...", "source": "router", "node": "roteador" },
    { "type": "answer", "content": "...", "node": "react" }
  ],
  "metrics": { "modelUsed": "meta-llama/llama-3.3-70b-instruct:free", "llmCalls": 3, "...": "inalterado" }
}
```

| Campo | Mudança |
|-------|---------|
| `metrics.modelUsed` | **novo**, sempre presente: modelo que produziu a resposta final; `null` se a estratégia não chamou o modelo |
| `trace[]` `type: "fallback"` | **novo**: `from`, `to`, `reason` (nome do erro) e `node`; no máximo um por par `from → to` por turno; ausente sem troca |
| `metrics.promptTokens` | inclui tentativas e reservas que informarem uso |

## 503 — nenhum modelo respondeu

```json
{ "error": "model_unavailable", "modelsTried": ["openai/gpt-oss-20b:free", "meta-llama/llama-3.3-70b-instruct:free"] }
```

- Nada é gravado na conversa e o `learn` não é disparado.
- Só acontece quando a chamada da qual a resposta depende esgota a cadeia.
  Falhas totais do roteador, do crítico, do resumidor e do aprendizado seguem
  tolerantes.
- O 504 (timeout) prevalece se o teto vencer antes.

## Demais erros

400, 404, 422 e 504 não mudam. Um 500 continua valendo para erros que não vêm
do modelo.

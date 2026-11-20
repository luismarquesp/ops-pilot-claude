# Contract: POST /chat (revisão para o grafo unificado)

Emenda a [specs/013-context-section-budget/contracts/chat-api.md](../../013-context-section-budget/contracts/chat-api.md).

## Request

| Campo | Mudança |
|-------|---------|
| `strategy` | continua opcional. Valores: `react`, `plan-and-execute`, `reflection` (novo). Ausente → o roteador decide (antes: `react` fixo). Presente → override |
| `reflect` | sem mudança; aplica reflexão sobre a rota, sem duplicar quando a rota já é `reflection` |
| demais | sem mudança |

## 200

```json
{
  "conversationId": "5b1f3c2e-...",
  "answer": "...",
  "trace": [
    { "type": "summarize", "content": "...", "messagesSummarized": 8, "node": "contexto" },
    { "type": "route", "route": "plan-and-execute", "reason": "Pedido em vários passos sobre cada alerta.", "source": "router", "node": "roteador" },
    { "type": "plan", "steps": ["..."], "node": "plan-and-execute" },
    { "type": "answer", "content": "...", "node": "plan-and-execute" }
  ],
  "metrics": { "llmCalls": 5, "...": "inalterado" }
}
```

| Campo | Mudança |
|-------|---------|
| `trace[].node` | **novo**, sempre presente: `contexto`, `roteador`, `react`, `plan-and-execute`, `reflection` |
| `trace[]` `type: "route"` | **novo**, exatamente um por turno: `route`, `reason`, `source` (`router` \| `override` \| `fallback`) |
| `metrics.llmCalls` | inclui a chamada do roteador (0 em override) |
| `metrics.promptTokens` | inclui o roteador |

Override: `{ "type": "route", "route": "react", "reason": "Estratégia definida na requisição.", "source": "override", "node": "roteador" }`.

## Erros

| Status | Quando |
|--------|--------|
| 422 `unknown_strategy` | `strategy` fora das rotas disponíveis. `available` lista as rotas (agora com `reflection`). Nada é gravado |
| 404 / 504 / 400 / 500 | sem mudança. A chamada do roteador conta no teto de 504 |

A falha do roteador **não** é erro HTTP: vira `source: "fallback"` com `react`.

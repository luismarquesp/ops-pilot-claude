# Contract: POST /chat (revisão para orçamento de contexto)

Emenda a [specs/012-history-summarization/contracts/chat-api.md](../../012-history-summarization/contracts/chat-api.md).
Request, erros e rastro não mudam.

## Efeito no contexto

O prompt continua fatos → resumo → histórico → pergunta, mas cada seção é
limitada pelo orçamento ([context-builder.md](./context-builder.md)). Abaixo
dos tetos o prompt é idêntico ao anterior.

## 200 — turno com cortes

```json
{
  "conversationId": "5b1f3c2e-...",
  "answer": "...",
  "trace": [ ... ],
  "metrics": {
    "llmCalls": 1,
    "latencyMs": 1830,
    "historyMessages": 5,
    "memoryFacts": 2,
    "promptTokens": 2950,
    "contextBreakdown": { "question": 12, "history": 1180, "memory": 41, "summary": 198, "total": 1431 },
    "contextTrimmed": { "historyMessages": 3, "memoryFacts": 1, "summaryTruncated": true }
  }
}
```

| Campo | Mudança |
|-------|---------|
| `metrics.contextTrimmed` | **novo**; sempre presente; zerado/`false` sem cortes |
| `metrics.historyMessages` | mensagens que entraram por extenso **após** o corte |
| `metrics.memoryFacts` | fatos que entraram **após** o corte |
| `metrics.contextBreakdown` | calculado sobre o conteúdo mantido; cada fatia ≤ seu teto |

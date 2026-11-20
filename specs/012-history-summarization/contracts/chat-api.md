# Contract: POST /chat (revisão para sumarização)

Emenda a [specs/011-context-token-metrics/contracts/chat-api.md](../../011-context-token-metrics/contracts/chat-api.md).
Request e erros não mudam.

## Efeito no contexto

O prompt do turno passa a ser, nesta ordem: fatos lembrados (com `userId`) →
`Resumo da conversa até aqui:` (se houver) → histórico recente por extenso
(8 a 15 mensagens) → pergunta atual.

## 200 — turno que gerou resumo

```json
{
  "conversationId": "5b1f3c2e-...",
  "answer": "...",
  "trace": [
    {
      "type": "summarize",
      "content": "Decisões: rollback do checkout aprovado. Fatos: ... Pendências: ...",
      "messagesSummarized": 8
    },
    { "type": "action", "tool": "list_alerts", "args": {} },
    ...
  ],
  "metrics": {
    "llmCalls": 2,
    "latencyMs": 2410,
    "historyMessages": 8,
    "memoryFacts": 0,
    "promptTokens": 3890,
    "contextBreakdown": { "question": 9, "history": 260, "memory": 0, "summary": 152, "total": 421 }
  }
}
```

| Campo | Mudança |
|-------|---------|
| `trace[0]` `summarize` | **novo**; só no turno em que um resumo novo foi gravado; `content` = resumo, `messagesSummarized` = mensagens absorvidas neste turno |
| `metrics.historyMessages` | conta só as mensagens por extenso (antes: até 12; agora 8–15) |
| `metrics.contextBreakdown.summary` | **novo**; estimado do bloco de resumo (0 sem resumo) |
| `metrics.contextBreakdown.total` | passa a somar `summary` |
| `metrics.llmCalls` | inalterado: conta só as chamadas da estratégia |
| `metrics.promptTokens` | passa a incluir a chamada do resumidor quando houver |

Falha do resumidor: resposta 200 normal, sem evento `summarize`.

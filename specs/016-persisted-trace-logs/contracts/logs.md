# Contract: linhas de log JSON (`src/obs/logger.ts`)

Uma linha por acontecimento na saída padrão. Cada linha é um objeto JSON
isolado com `time` (ISO-8601), `level` (`info` | `warn` | `error`) e `event`,
mais os campos abaixo. Campos ausentes são omitidos.

**Nunca** aparecem nos logs:
- texto da pergunta, da resposta, do resumo, de pensamentos, de críticas ou de
  observações;
- argumentos de tools e passos de plano;
- o `reason` do roteador;
- mensagens ou stacks de erro.

## Eventos

| `event` | level | Campos |
|---------|-------|--------|
| `chat.request.start` | info | `requestId`, `method`, `path` |
| `chat.trace.event` | info | `requestId`, `seq`, `type`, `node`; conforme o tipo: `tool` (action), `route` e `source` (route), `from`, `to` e `reason` (fallback, nome do erro), `messagesSummarized` (summarize), `steps` (plan, **contagem**) |
| `chat.request.end` | info (warn se status ≥ 500) | `requestId`, `status`, `durationMs`, `errorCode?`; em 200 também `route`, `llmCalls`, `promptTokens`, `modelUsed`, `historyMessages`, `memoryFacts` |
| `model.unavailable` | warn | `requestId`, `modelsTried` (lista de ids) |
| `request.persist.failed` | error | `requestId`, `errorName` |
| `http.unexpected_error` | error | `requestId?`, `errorName` |

Ordem por requisição bem-sucedida:
1. `start`;
2. um `chat.trace.event` por evento do rastro, em `seq` crescente;
3. `end`.

## Exemplo

```json
{"time":"2026-11-17T12:00:00.000Z","level":"info","event":"chat.request.start","requestId":"0f8d...","method":"POST","path":"/chat"}
{"time":"2026-11-17T12:00:04.100Z","level":"info","event":"chat.trace.event","requestId":"0f8d...","seq":1,"type":"action","node":"react","tool":"list_alerts"}
{"time":"2026-11-17T12:00:04.210Z","level":"info","event":"chat.request.end","requestId":"0f8d...","status":200,"durationMs":4210,"route":"react","llmCalls":3,"promptTokens":1830,"modelUsed":"...","historyMessages":2,"memoryFacts":0}
```

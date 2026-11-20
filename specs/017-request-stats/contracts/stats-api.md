# Contract: GET /stats

`GET /stats?since=24h` — `since` opcional, `^[1-9]\d*(m|h|d)$`, ≤ 30d. Padrão `24h`.

**200**
```json
{
  "since": "24h",
  "from": "2026-11-17T12:00:00.000Z",
  "to": "2026-11-18T12:00:00.000Z",
  "total": 3, "errors": 1, "errorRate": 0.3333,
  "cost": { "usd": 0.000275, "unpriced": 0 },
  "latencyMs": { "p50": 130, "p95": 900 },
  "byRoute": [ { "route": "react", "total": 2, "errors": 0, "errorRate": 0, "cost": { "usd": 0.000275, "unpriced": 0 }, "latencyMs": { "p50": 130, "p95": 900 } },
               { "route": null, "total": 1, "errors": 1, "errorRate": 1, "cost": { "usd": 0, "unpriced": 0 }, "latencyMs": { "p50": 40, "p95": 40 } } ],
  "byModel": [ { "model": "openai/gpt-4o-mini", "...": "mesmo bloco" } ]
}
```

**400** `{ "issues": [...] }` para `since` inválido.

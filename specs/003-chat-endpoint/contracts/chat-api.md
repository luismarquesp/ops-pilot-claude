# Contract: POST /chat

Definido em `src/http/server.ts` (FR-001 a FR-007, FR-009). Único endpoint desta
feature.

## Request

```http
POST /chat
Content-Type: application/json

{
  "message": "Como está o plantão?",
  "strategy": "plan-and-execute",
  "reflect": true
}
```

Schema Zod (ver [data-model.md](../data-model.md) — `ChatRequest`):

```ts
z.object({
  message: z.string().min(1),
  strategy: z.string().optional(),
  reflect: z.boolean().optional(),
});
```

## Responses

### 200 — sucesso

```json
{
  "answer": "...",
  "trace": [{ "type": "action", "tool": "list_alerts", "args": { "status": "firing" } }],
  "metrics": { "llmCalls": 2, "latencyMs": 3120 }
}
```

Mesma forma de `StrategyResult` (specs/001/contracts/reasoning-strategy.md) — nenhum
campo adicionado nem removido.

### 400 — corpo inválido

```json
{ "issues": [{ "code": "too_small", "path": ["message"], "message": "..." }] }
```

`issues` é exatamente `result.error.issues` do Zod (FR-005) — sem reformatação.

### 422 — estratégia desconhecida

```json
{ "error": "unknown_strategy", "strategy": "foo", "available": ["react", "plan-and-execute"] }
```

Retornado antes de qualquer tentativa de aplicar `reflect` (edge case da spec).

### 504 — tempo esgotado

```json
{ "error": "timeout", "timeoutMs": 180000 }
```

A execução da estratégia pode continuar rodando em segundo plano depois desta
resposta; o resultado, quando chegar, é descartado (research.md §1) — nunca há uma
segunda resposta para a mesma requisição.

### 500 — erro inesperado

```json
{ "error": "internal_error" }
```

Rede de segurança para qualquer falha fora dos casos acima (research.md §4) — não é
um requisito funcional explícito da spec, mas evita deixar uma exceção não tratada
sem resposta.

## Regras do contrato

- Validação do corpo acontece antes de qualquer outra coisa — nenhuma estratégia é
  resolvida nem executada para um corpo inválido.
- Resolução de `strategy` (contra o [Registro de Estratégias](../data-model.md#registro-de-estratégias-strategyregistry))
  acontece antes de aplicar `reflect` — uma estratégia desconhecida nunca chega a ser
  "refletida".
- Quando `strategy` está ausente, a estratégia padrão é `react` (FR-003).
- O teto de tempo (180s) é medido do recebimento da requisição até a resposta ser
  enviada, e vale para qualquer estratégia (com ou sem reflexão).

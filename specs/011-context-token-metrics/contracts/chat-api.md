# Contract: POST /chat (revisão para medição de contexto)

Emenda ao contrato de [specs/008-semantic-memory/contracts/chat-api.md](../../008-semantic-memory/contracts/chat-api.md).
Request, erros (400/404/422/504/500) e demais campos não mudam.

## 200 — sucesso (campos novos em `metrics`)

```json
{
  "conversationId": "5b1f3c2e-...",
  "answer": "...",
  "trace": [ ... ],
  "metrics": {
    "llmCalls": 2,
    "latencyMs": 1834,
    "historyMessages": 12,
    "memoryFacts": 1,
    "promptTokens": 3120,
    "contextBreakdown": {
      "question": 9,
      "history": 412,
      "memory": 21,
      "total": 442
    }
  }
}
```

| Campo | Tipo | Semântica |
|-------|------|-----------|
| `metrics.promptTokens` | `integer \| null` | **Real**: soma dos tokens de entrada informados pelo provedor em todas as chamadas ao modelo do turno. `null` quando nenhuma chamada informou uso. Sempre presente. |
| `metrics.contextBreakdown.question` | `integer ≥ 0` | **Estimado** (`ceil(chars/4)`) da mensagem atual. |
| `metrics.contextBreakdown.history` | `integer ≥ 0` | Estimado do bloco de histórico injetado (0 sem histórico). |
| `metrics.contextBreakdown.memory` | `integer ≥ 0` | Estimado do bloco de fatos lembrados (0 sem `userId`/fatos). |
| `metrics.contextBreakdown.total` | `integer ≥ 0` | `question + history + memory`. |

Notas:

- `total` cobre só o que o serviço de chat monta; instruções de sistema,
  schemas de tools e mensagens intermediárias do agente ficam de fora, então
  `total < promptTokens` é o esperado.
- Chamadas do refletor de aprendizado (specs/009), feitas depois da resposta,
  não entram em `promptTokens`.

# Contract: `scripts/conversa-long.sh`

```bash
OPSPILOT_URL=http://localhost:3000 TURNS=15 USER_ID=luis scripts/conversa-long.sh
```

| Variável | Default | Efeito |
|----------|---------|--------|
| `OPSPILOT_URL` | `http://localhost:3000` | base da API |
| `TURNS` | `15` | número de turnos |
| `USER_ID` | (vazio) | se definido, enviado como `userId` |

Saída (stdout), uma linha por turno após o cabeçalho:

```text
conversa 5b1f3c2e-...
turno  promptTokens  historico  estimado
1      812           0          31
2      1290          2          118
...
```

- `promptTokens` nulo → `n/d`.
- API fora do ar ou status ≠ 200 → mensagem em stderr (com o status e o corpo)
  e código de saída `1`.

# Contract: POST /chat (revisão para memória semântica)

Emenda ao contrato de [specs/007-persistent-conversation/contracts/chat-api.md](../../007-persistent-conversation/contracts/chat-api.md)
(que por sua vez emenda o de specs/003). Tudo que não está listado aqui continua valendo.

## Request

```http
POST /chat
Content-Type: application/json

{
  "message": "qual SGBD guarda os dados de cobrança?",
  "userId": "luis",
  "conversationId": "5b1f3c2e-8a4d-4f7e-9c1a-2d3e4f5a6b7c",
  "strategy": "react"
}
```

`userId` é **opcional**: string com trim, de 1 a 128 caracteres. Fora disso, a resposta
é `400 { issues }` (formato atual).

## Efeito de `userId`

1. `recall(userId, message)` → até 3 fatos, injetados antes do histórico/pergunta
   (research §6).
2. As tools `remember_fact`/`forget_fact` ficam disponíveis ao agente nesse turno,
   presas a esse `userId` ([memory-tools.md](./memory-tools.md)).

Sem `userId`, nada disso acontece: mesmas tools e mesma pergunta de hoje.

## Responses

### 200 — sucesso (campo novo marcado)

```json
{
  "conversationId": "5b1f3c2e-...",
  "answer": "...",
  "trace": [ ... ],
  "metrics": { "llmCalls": 2, "latencyMs": 3120, "historyMessages": 4, "memoryFacts": 1 }
}
```

- `metrics.memoryFacts` (**novo**): sempre presente, 0..3; vale 0 sem `userId`.
- `userId` não é ecoado.

### Erros

Os mesmos de antes (400, 404 `conversation_not_found`, 422 `unknown_strategy`,
504 `timeout`, 500 `internal_error`). Uma falha ao carregar ou rodar o modelo de
embeddings num turno com `userId` resulta em **500 `internal_error`**.

## Assinatura do Controller

```ts
export interface AppDeps {
	strategiesFor(userId?: string): Map<string, ReasoningStrategy>;
	conversations: ConversationStore;
	memory?: MemoryStore;            // ausente → userId é aceito, mas sem recall (0 fatos)
}
export function createApp(deps: AppDeps, opts?: CreateAppOptions): Express;
```

`runChat` recebe `userId?` em `ChatInput` e `memory?` em `ChatDeps`. A composição fica
`withHistory(withMemory(strategy, facts), history)`.

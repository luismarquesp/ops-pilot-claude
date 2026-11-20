# Contract: POST /chat (revisão para conversa persistente)

Emenda ao contrato de [specs/003-chat-endpoint/contracts/chat-api.md](../../003-chat-endpoint/contracts/chat-api.md).
Tudo que não está listado aqui continua valendo como lá.

## Request

```http
POST /chat
Content-Type: application/json

{
  "message": "abre um incidente para o segundo",
  "conversationId": "5b1f3c2e-8a4d-4f7e-9c1a-2d3e4f5a6b7c",
  "strategy": "react",
  "reflect": false
}
```

`conversationId` é opcional; quando presente deve ser um UUID (`z.uuid()`).

## Responses

### 200 — sucesso (campos novos marcados)

```json
{
  "answer": "...",
  "trace": [ ... ],
  "metrics": { "llmCalls": 2, "latencyMs": 3120, "historyMessages": 4 },
  "conversationId": "5b1f3c2e-8a4d-4f7e-9c1a-2d3e4f5a6b7c"
}
```

- `conversationId` (novo): o id recebido, ou o da conversa recém-criada quando a
  requisição não trouxe nenhum.
- `metrics.historyMessages` (novo): mensagens anteriores fornecidas ao raciocínio
  (0–12). Sempre presente.

### 400 — corpo inválido

Inalterado. Inclui `conversationId` que não seja UUID (`issues` do Zod).

### 404 — conversa não encontrada (novo)

```json
{ "error": "conversation_not_found", "conversationId": "5b1f3c2e-..." }
```

Nenhuma estratégia é executada e nenhuma conversa é criada.

### 422 / 504 / 500

Inalterados. Nenhum deles grava nada na conversa.

## Ordem de avaliação

1. Validação Zod → 400
2. Resolução da estratégia → 422
3. Carga do histórico (`lastMessages(id, 12)`) se `conversationId` presente → 404
4. Execução com teto de tempo, estratégia composta como
   `withHistory(reflect ? withReflection(base) : base, history)` → 504 / 500
5. Só em sucesso: `create()` (se não havia id), `append(id, "user", message)` e
   `append(id, "assistant", answer)` → 200

Os passos 3–5 vivem no serviço `runChat` (`src/services/chat-service.ts`); o
Controller só valida, resolve a estratégia e traduz `ConversationNotFoundError` →
404 e `TimeoutError` → 504.

## Regras

- O rastro (`trace`) nunca é gravado como mensagem.
- Sem `conversationId`, `answer`/`trace` são idênticos ao comportamento anterior
  (a pergunta chega à estratégia sem alteração).

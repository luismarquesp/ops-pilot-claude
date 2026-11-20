# Quickstart: Conversa Persistente no Chat

## Pré-requisitos

- Node.js 22 LTS, `npm install` feito.
- Para o teste manual: `.env` com `OPENROUTER_API_KEY`/`OPEN_ROUTER_MODEL`
  (ver `.env.example`).

## 1. Checagens automáticas (sem rede, sem arquivo)

```bash
npm run typecheck
npm test
```

Esperado: tudo verde, incluindo
- suíte de contrato do `ConversationStore` sobre `":memory:"` e sobre o fake
  ([contracts/conversation-store.md](./contracts/conversation-store.md));
- testes de `withHistory` / `formatQuestionWithHistory`;
- testes de integração do `/chat` com estratégia fake
  ([contracts/chat-api.md](./contracts/chat-api.md)).

## 2. Conversa de ponta a ponta (manual)

```bash
npm run dev
```

Primeiro turno, sem id:

```bash
curl -s localhost:3000/chat -H 'content-type: application/json' \
  -d '{"message":"quais alertas estão disparando?"}'
```

Esperado: 200 com `conversationId` (UUID) e `metrics.historyMessages = 0`.

Acompanhamento, com o id devolvido:

```bash
curl -s localhost:3000/chat -H 'content-type: application/json' \
  -d '{"message":"abre um incidente para o segundo","conversationId":"<id>"}'
```

Esperado: 200, mesmo `conversationId`, `metrics.historyMessages = 2`, e a resposta
se refere ao segundo alerta listado no turno anterior.

## 3. Sobrevive a restart (US2)

Pare (`Ctrl+C`) e rode `npm run dev` de novo; repita o acompanhamento com o mesmo
id. Esperado: `historyMessages = 4`.

## 4. Erros

```bash
# id inexistente → 404 conversation_not_found
curl -s localhost:3000/chat -H 'content-type: application/json' \
  -d '{"message":"oi","conversationId":"00000000-0000-4000-8000-000000000000"}'

# id malformado → 400 com issues do Zod
curl -s localhost:3000/chat -H 'content-type: application/json' \
  -d '{"message":"oi","conversationId":"abc"}'
```

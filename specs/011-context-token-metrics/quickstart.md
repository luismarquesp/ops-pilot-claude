# Quickstart: Medição de Contexto (Tokens)

## Pré-requisitos

- Node 22, `npm install` feito.
- Para os cenários 3–4: `.env` com `OPENROUTER_API_KEY` e `OPEN_ROUTER_MODEL`
  (não leia nem commite o arquivo), e `curl` no shell (Git Bash no Windows).

## 1. Testes automatizados (sem rede)

```bash
npm run typecheck
npm test
```

Esperado: tudo verde, incluindo os novos `src/context/*.test.ts` e os casos
novos de `chat-service.test.ts` / `server.test.ts` (research.md §8).

## 2. Um turno pela API

```bash
npm run dev
curl -s localhost:3000/chat -H 'content-type: application/json' \
  -d '{"message":"quais alertas estão disparando?"}'
```

Esperado: `metrics.promptTokens` inteiro (ou `null` se o modelo não reportar
uso) e `metrics.contextBreakdown` com `history: 0`, `memory: 0` e
`total === question` ([contracts/chat-api.md](./contracts/chat-api.md)).

## 3. Conversa longa

Com a API rodando em outro terminal:

```bash
bash scripts/conversa-long.sh
```

Esperado: 15 linhas; `historico` sobe 0, 2, 4 … até 12 e para; `estimado` e
`promptTokens` crescem junto e se estabilizam (com oscilação) a partir do
turno 7 (SC-004).

## 4. Falha controlada do script

```bash
OPSPILOT_URL=http://localhost:9 bash scripts/conversa-long.sh; echo "exit=$?"
```

Esperado: mensagem de erro em stderr e `exit=1`.

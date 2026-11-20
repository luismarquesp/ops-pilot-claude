# Quickstart: Resiliência de Modelo

## Automático

```bash
npm run typecheck
npm test
```

O que os testes cobrem, com runnables falsos e sem rede:

- `parseModelChain`;
- `summarizeAttempts`;
- `withResilience`: retry que recupera, troca para a reserva, segunda
  reserva, falha total → `ModelUnavailableError`;
- eventos `fallback` por nó e deduplicados;
- `metrics.modelUsed`;
- 503 sem gravar nada;
- erro que não vem do modelo continua 500.

Ver [contracts/model-factory.md](./contracts/model-factory.md).

## Manual (API real, `npm run dev`)

As variáveis vão no `.env` ou no ambiente do shell. Não é preciso abrir o
`.env` para isso.

1. **Troca para a reserva**: `OPEN_ROUTER_MODEL=modelo/inexistente` e
   `OPENROUTER_MODEL_FALLBACK=<um modelo válido>`.
   ```bash
   curl -s localhost:3000/chat -H 'content-type: application/json' \
     -d '{"message":"Lista os alertas disparando.","strategy":"react"}' | jq '{modelUsed: .metrics.modelUsed, trace: [.trace[] | select(.type=="fallback")]}'
   ```
   Esperado: `modelUsed` igual à reserva e um único evento `fallback` com
   `from: "modelo/inexistente"`.
2. **Indisponível**: as duas variáveis com modelos inexistentes → HTTP 503
   `{ error: "model_unavailable", modelsTried: [...] }`, e nada é gravado na
   conversa.
3. **Saudável**: a configuração normal → `modelUsed` igual ao primário e
   nenhum evento `fallback`.
4. **Conversa longa** (`bash scripts/conversa-long.sh`): a nova coluna
   `modelo` mostra `metrics.modelUsed` por turno.

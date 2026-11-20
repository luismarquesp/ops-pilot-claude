# Quickstart: Rastro persistido + logs estruturados

## Automático

```bash
npm run typecheck
npm test
```

O que os testes cobrem, sem rede:

- **Funções puras**:
  - `formatLogLine`: uma linha, JSON válido;
  - `traceEventLogFields`: lista permitida;
  - `requestEndLogFields`, `buildRequestRecord`, `routeOf` e `withRequestId`.
- **`RequestStore`**: contract test no mock e no SQLite `:memory:`, cobrindo
  ordem, transação, id repetido, `get` inexistente e cascade.
- **`recordRequest`**: falha do store é engolida e logada só com o nome.
- **Controller**:
  - `requestId` igual no corpo e no cabeçalho em 200, 400, 404, 422, 500, 503
    e 504;
  - `X-Request-Id` do cliente ignorado;
  - o `GET /requests/:id` devolve o mesmo `trace` e as mesmas `metrics`;
  - 404 e 400 no GET;
  - falha de persistência não muda a resposta.
- **Logs**: com marcadores únicos na pergunta e nas observações, nenhuma linha
  capturada os contém.

Ver [contracts/](./contracts/) e [data-model.md](./data-model.md).

## Manual (API real, `npm run dev`)

1. **Id e rastro**:
   ```bash
   curl -si -X POST localhost:3000/chat -H 'content-type: application/json' \
     -d '{"message":"quais alertas estão disparando?"}'
   ```
   Esperado: cabeçalho `X-Request-Id` igual ao `requestId` do corpo.
2. **Consulta**: `curl -s localhost:3000/requests/<requestId>`. Esperado:
   `request.status = 200` e `trace` igual ao da resposta anterior.
3. **Reinício**: pare e suba a API de novo, depois repita o passo 2. O
   registro continua lá.
4. **Logs**: no terminal do `npm run dev`, cada linha é JSON. Filtre por
   requisição:
   ```bash
   npm run dev | grep '"requestId":"<requestId>"'
   ```
   Esperado: `start`, os `chat.trace.event` e o `end`, sem o texto da
   pergunta nem da resposta.
5. **Erros**:
   - `curl -s localhost:3000/requests/nao-e-uuid` → 400;
   - um UUID qualquer → 404 `request_not_found`.

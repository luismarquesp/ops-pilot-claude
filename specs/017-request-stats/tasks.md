# Tasks: Estatísticas de requisições

- [X] T001 [P] Testes de `isFreeModel`/`parseModelPrices`/`requestCost` em src/services/pricing.test.ts
- [X] T002 [P] Implementar src/services/pricing.ts
- [X] T003 Contrato `listSince` em src/store/request-store.contract-tests.ts
- [X] T004 `listSince` em src/store/request-store.ts, src/store/mock-request-store.ts e src/store/sqlite-request-store.ts (+ índice)
- [X] T005 [US1] [US2] Testes de `windowMs`/`percentile`/`computeStats`/`getStats` em src/services/stats-service.test.ts
- [X] T006 [US1] [US2] Implementar src/services/stats-service.ts
- [X] T007 [US1] Testes do router em src/http/stats-routes.test.ts
- [X] T008 [US1] Implementar src/http/stats-routes.ts
- [X] T009 Montar `/stats` em src/http/server.ts (`AppDeps.modelPrices`) + teste em src/http/server.test.ts
- [X] T010 Ler `MODEL_PRICES` em src/index.ts; documentar em .env.example e AGENTS.md
- [X] T011 `npm run typecheck` e `npm test` verdes; validação manual contra a API

## Resultado da validação (2026-11-18)

- `npm run typecheck` limpo; `npm test` 424 testes, 424 pass, 0 fail.
- API real (banco temporário): `since=abc` → 400; após um 200 e um 404,
  `GET /stats` → total 2, errors 1, `openrouter/free` com custo 0, p50 9 / p95 6500 ms.

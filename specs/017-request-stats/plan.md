# Implementation Plan: Estatísticas de requisições

**Branch**: `017-request-stats` | **Date**: 2026-11-18 | **Spec**: [spec.md](./spec.md)

## Summary

- **Model**: `RequestStore.listSince(from)` devolve linhas enxutas (`RequestStatRow`:
  `startedAt`, `status`, `outcome`, `route`, `modelUsed`, `promptTokens`,
  `durationMs`) com `startedAt >= from`, em ordem. `SqliteRequestStore` usa as colunas
  planas do specs/016 (sem `metrics_json`) e ganha índice `requests_started_at`.
- **Service** (puro): `src/services/pricing.ts` (`isFreeModel`, `parseModelPrices`,
  `requestCost`) e `src/services/stats-service.ts` (`sinceSchema`, `windowMs`,
  `percentile`, `computeStats`, `getStats`).
- **Controller**: `src/http/stats-routes.ts` (`createStatsRouter(requests, { prices, now })`),
  zod no `since`, 400 `{ issues }`. Montado em `/stats` só com `AppDeps.requests`.
- **Wiring**: `src/index.ts` lê `MODEL_PRICES` via `parseModelPrices`
  (inválido → aviso com o nome da variável) → `AppDeps.modelPrices`.

## Constitution Check

MVC ✓ · zod na borda ✓ · funções puras ✓ · teste antes do código ✓ · sem dependência nova ✓.

## Decisions

- Agregar em memória (pura) e não em SQL: testável sem banco, mesma regra para mock e
  SQLite; volume de uma janela de 30d de plantão é pequeno.
- Nearest-rank: determinístico, sempre devolve um valor observado.
- Chave `null` para rota/modelo ausente, em vez de string mágica.

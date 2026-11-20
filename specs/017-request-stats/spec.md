# Feature Specification: Estatísticas de requisições

**Feature Branch**: `017-request-stats`
**Created**: 2026-11-18
**Status**: Implemented
**Input**: "GET /stats?since=24h sobre requests: total, erros, custo (:free=0), p50/p95, por rota e modelo"

## User Scenarios & Testing

### User Story 1 - Visão geral da janela (P1)

O plantonista consulta como o OpsPilot se comportou nas últimas N horas: quantos
turnos, quantos falharam, quanto custou e quão rápido respondeu.

**Acceptance Scenarios**:

1. **Given** requisições gravadas (specs/016) nas últimas 24h, **When** `GET /stats`,
   **Then** recebe `total`, `errors`, `errorRate`, `cost` e `latencyMs { p50, p95 }`
   só das requisições com `startedAt` dentro da janela.
2. **Given** `since=2h`, **When** `GET /stats?since=2h`, **Then** requisições mais
   antigas que 2h ficam fora.
3. **Given** nenhuma requisição na janela, **Then** `total: 0`, `errorRate: 0`,
   percentis `null`, custo `0`.
4. **Given** `since` inválido (`abc`, `0h`, `31d`), **Then** 400 com `issues`.

### User Story 2 - Quebra por rota e por modelo (P1)

**Acceptance Scenarios**:

1. **Then** `byRoute` e `byModel` trazem, por chave, o mesmo bloco de métricas
   (`total`, `errors`, `errorRate`, `cost`, `latencyMs`), ordenados por `total`
   decrescente (empate → chave); turnos sem rota/modelo (erros) ficam na chave `null`.

### User Story 3 - Custo estimado (P2)

1. **Given** um modelo cujo id termina em `:free` (ou o roteador `openrouter/free`),
   **Then** custo 0.
2. **Given** um modelo com preço em `MODEL_PRICES` (USD por 1M tokens de prompt),
   **Then** custo = `promptTokens × preço / 1e6`.
3. **Given** um modelo pago sem preço, ou sem `promptTokens`, **Then** o custo não
   entra na soma e a requisição conta em `cost.unpriced`.

### Edge Cases

- Erros (404/503/504/500) não têm modelo nem tokens: entram em `total`/`errors`, custo 0.
- Percentis usam `durationMs` (tempo de parede do turno, specs/016), erros inclusive.
- `MODEL_PRICES` com entrada inválida → entrada ignorada + aviso só com o nome da variável.

## Requirements

- **FR-001**: `GET /stats` aceita `since` opcional `<n>m|h|d` (n ≥ 1, máx. 30d); padrão `24h`.
- **FR-002**: Janela = `[now - since, now]` por `startedAt`.
- **FR-003**: Resposta: `{ since, from, to, total, errors, errorRate, cost: { usd, unpriced }, latencyMs: { p50, p95 }, byRoute, byModel }`.
- **FR-004**: `errors` = `outcome = "error"`; `errorRate` = errors/total (0 sem total), 4 casas.
- **FR-005**: Percentil por posto mais próximo (nearest-rank); `null` sem amostras.
- **FR-006**: Custo conforme User Story 3; `usd` com 6 casas.
- **FR-007**: Agregação é função pura; só montado quando há `RequestStore`.
- **FR-008**: Sem conteúdo (perguntas, respostas, ids de usuário) na resposta.

## Success Criteria

- **SC-001**: Os números de `/stats` batem com a contagem manual sobre `GET /requests/:id`.
- **SC-002**: Uma janela vazia nunca devolve erro nem `NaN`.

## Assumptions

- Só há `promptTokens` persistido (specs/011): o custo é **estimado** só sobre
  entrada e atribuído inteiro ao `modelUsed` (roteador/resumidor incluídos).
- `openrouter/free` é tratado como gratuito, como os ids `:free`.

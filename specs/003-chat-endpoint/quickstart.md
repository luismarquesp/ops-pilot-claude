# Quickstart: Endpoint HTTP de Chat sobre o Núcleo de Raciocínio

Guia para validar a feature end-to-end depois da implementação
(`/speckit.implement`). Pré-requisitos: os mesmos de
[../001-reasoning-core/quickstart.md](../001-reasoning-core/quickstart.md)
(`OPENROUTER_API_KEY`/`OPEN_ROUTER_MODEL` carregados via `--env-file-if-exists=.env`).
Não duplica schemas — ver [contracts/](./contracts/) e [data-model.md](./data-model.md).

## 1. Subir o servidor

```sh
npm run dev
```

**Resultado esperado**: o processo fica no ar escutando `PORT` (padrão 3000), usando
o store JSON (`src/models/seed-data.json`) para montar as tools e o registro de
estratégias.

## 2. Requisição de sucesso (estratégia padrão)

```sh
curl -s -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Como está o plantão?"}'
```

**Resultado esperado** (User Story 1): `200`, corpo com `answer`, `trace` (rastro
completo) e `metrics.llmCalls`/`metrics.latencyMs`.

## 3. Escolher estratégia e ativar reflexão

```sh
curl -s -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Como está o plantão?","strategy":"plan-and-execute","reflect":true}'
```

**Resultado esperado** (User Story 2): `200`, `trace` mostrando o comportamento do
Plan-and-Execute mais pelo menos um evento de crítica (reflexão aplicada).

## 4. Corpo inválido

```sh
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" -d '{}'
```

**Resultado esperado** (User Story 3): `400`, corpo com `issues` do Zod apontando
`message` ausente.

## 5. Estratégia desconhecida

```sh
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"oi","strategy":"nao-existe"}'
```

**Resultado esperado**: `422`, distinto do `400` do passo anterior.

## 6. Validar os testes de integração determinísticos (sem rede)

```sh
npm test
```

**Resultado esperado** (FR-010): `src/http/server.test.ts` sobe o app real numa
porta efêmera com uma estratégia falsa injetada no registro, cobrindo sucesso,
corpo inválido (400), estratégia desconhecida (422) e timeout (504 — usando um
`timeoutMs` pequeno injetado no teste, não os 180s reais). Passa sem exigir
`OPENROUTER_API_KEY` nem qualquer acesso de rede.

## 7. Checagens de qualidade do projeto

```sh
npm run typecheck
npm test
```

Ambos DEVEM estar verdes antes de considerar a feature pronta (constitution,
Princípio II).

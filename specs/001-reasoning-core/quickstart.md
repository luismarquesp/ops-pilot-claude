# Quickstart: Núcleo de Raciocínio do OpsPilot

Guia para validar a feature end-to-end depois da implementação (`/speckit.implement`).
Não duplica schemas/contratos — ver [contracts/](./contracts/) e
[data-model.md](./data-model.md).

## Pré-requisitos

1. Dependências instaladas: `npm install` (já feito no setup inicial do projeto).
2. Variáveis de ambiente definidas (sem usar `.env` — ver constitution, Princípio VI):
   - `OPENROUTER_API_KEY`
   - `OPEN_ROUTER_MODEL`
3. Um MySQL acessível para o ambiente de desenvolvimento, com as credenciais que
   `src/models/sequelize.ts` espera (detalhe de configuração definido em `tasks.md`).

## 1. Popular os dados (seed)

```sh
npx tsx src/models/seed.ts
```

**Resultado esperado**: o banco passa a conter exatamente 5 `Service` e 6 `Incident`
(3 `firing`, 3 `resolved`) — FR-009. Rodar novamente não deve duplicar os registros
(seed idempotente).

## 2. Rodar uma única estratégia

```sh
npm run arena -- --strategies react
```

**Resultado esperado** (User Story 1): a saída mostra o `trace` completo (pensamentos,
ações com tool + args, observações) e termina com uma `answer` coerente com os 3
incidentes `firing` semeados, mais as `metrics` (`llmCalls`, `latencyMs`).

## 3. Comparar as duas estratégias

```sh
npm run arena -- --strategies react,plan-and-execute --max-iterations 8
```

**Resultado esperado** (User Story 2): a saída mostra, em sequência, o resultado
completo (trace + metrics + answer) de `react` e depois de `plan-and-execute`, ambas
sobre a mesma pergunta e respeitando o teto de 8 iterações/passos.

## 4. Validar os testes determinísticos (sem rede)

```sh
npm test
```

**Resultado esperado** (User Story 3, FR-017, SC-005): os testes de
`src/models/*.test.ts` (comportamento do store/seed) e `src/agents/trace.test.ts`
(formatação do rastro) passam sem exigir `OPENROUTER_API_KEY` nem qualquer acesso de
rede.

## 5. Checagens de qualidade do projeto

```sh
npm run typecheck
npm test
```

Ambos DEVEM estar verdes antes de considerar a feature pronta (constitution, Princípio
II).

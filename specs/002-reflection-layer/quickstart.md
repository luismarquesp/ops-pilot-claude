# Quickstart: Camada de Reflexão sobre Estratégias de Raciocínio

Guia para validar a feature end-to-end depois da implementação
(`/speckit.implement`). Pré-requisitos: os mesmos de
[../001-reasoning-core/quickstart.md](../001-reasoning-core/quickstart.md)
(`OPENROUTER_API_KEY`/`OPEN_ROUTER_MODEL` carregados via `--env-file-if-exists=.env`,
e o store de incidentes — JSON ou MySQL, conforme o que estiver em uso no momento).
Não duplica schemas — ver [contracts/reflection.md](./contracts/reflection.md) e
[data-model.md](./data-model.md).

## 1. Rodar a versão com reflexão de uma estratégia isoladamente

```sh
npm run arena -- --strategies reflect:react
```

**Resultado esperado** (User Story 1): a saída mostra o rastro completo, incluindo pelo
menos um evento de crítica (`[Crítica] ...`) antes da resposta final — mesmo quando a
primeira resposta já é aprovada de imediato (nesse caso, apenas uma rodada de crítica
aparece, sem regeneração).

## 2. Comparar a mesma estratégia com e sem reflexão

```sh
npm run arena -- --strategies react,reflect:react
```

**Resultado esperado** (User Story 2): a saída mostra os dois resultados lado a lado
(rastro + métricas + resposta); `reflect:react` reporta `llmCalls` maior ou igual ao de
`react` para o mesmo input (o custo extra da(s) rodada(s) de crítica fica visível na
comparação).

## 3. Confirmar o teto de rodadas com o comparador

```sh
npm run arena -- --strategies reflect:plan-and-execute --max-iterations 8
```

**Resultado esperado**: independentemente de quantas vezes o crítico reprovar a
resposta, o rastro mostra no máximo 2 eventos de crítica (padrão de `maxReflection`) —
nunca mais.

## 4. Validar os testes determinísticos do loop de reflexão (sem rede)

```sh
npm test
```

**Resultado esperado** (User Story 3, FR-005/FR-006): os testes de
`src/agents/reflection.test.ts` cobrem, usando uma estratégia de base e um crítico
falsos (sem LLM real):
- aprovação na primeira tentativa → nenhuma regeneração;
- reprovação seguida de aprovação → uma regeneração, resposta final é a aprovada;
- reprovação constante → exatamente `maxReflection` avaliações e `maxReflection + 1`
  gerações, resposta final é a última gerada;
- `maxReflection = 0` → nenhuma avaliação, resposta idêntica à da estratégia de base.

Continuam passando sem exigir `OPENROUTER_API_KEY` nem qualquer acesso de rede.

## 5. Checagens de qualidade do projeto

```sh
npm run typecheck
npm test
```

Ambos DEVEM estar verdes antes de considerar a feature pronta (constitution, Princípio
II).

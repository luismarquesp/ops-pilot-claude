# Data Model: Resiliência de Modelo

Nada é persistido. Todos os tipos vivem em memória durante o turno.

## ModelChain

| Campo | Tipo | Regra |
|-------|------|-------|
| `primary` | `string` | `OPEN_ROUTER_MODEL` (vazio = comportamento atual) |
| `fallbacks` | `string[]` | de `OPENROUTER_MODEL_FALLBACK`: split por `,`, `trim`, sem vazios, sem repetidos (fica o primeiro) e sem o `primary` |

## ModelAttempt (por chamada)

`{ model: string; ok: boolean; error?: string /* só o nome */ }`, na ordem em
que aconteceram. Cada modelo, principal ou reserva, pode aparecer até `attempts`
vezes (padrão 2).

## ModelCallOutcome (resultado de `summarizeAttempts`)

| Campo | Regra |
|-------|-------|
| `modelUsed` | `model` da tentativa com `ok: true`; `null` se nenhuma |
| `switches` | `{ from, to, reason }` para cada passagem de um modelo para o **seguinte diferente**; `reason` = `error` da última tentativa do `from` |
| `modelsTried` | modelos distintos na ordem da primeira tentativa |

Exemplos:

```text
[a✖, a✔]               → modelUsed a, switches []
[a✖, a✖, b✔]           → modelUsed b, switches [a→b]
[a✖×2, b✖×2, c✔]       → modelUsed c, switches [a→b, b→c]
[a✖×2, b✖×2]           → modelUsed null → ModelUnavailableError([a, b])
```

## FallbackEvent (rastro)

`{ type: "fallback"; from: string; to: string; reason: string; node: NodeName }`

- Nasce de cada `switch` das chamadas feitas dentro de um nó do grafo e
  aparece no início dos eventos daquele nó.
- O nó `resposta` mantém só a primeira ocorrência de cada par `from → to`.

## ModelUnavailableError

`{ name: "ModelUnavailableError"; modelsTried: string[] }`. Vira 503 no
Controller.

## ChatMetrics (acréscimo)

`modelUsed: string | null`: o modelo da última chamada do nó de estratégia.
É `null` se a estratégia não chamou o modelo.

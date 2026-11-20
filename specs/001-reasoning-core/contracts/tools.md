# Contract: Tools (fronteira LLM ↔ domínio)

Definidas em `src/agents/tools.ts` (FR-006, FR-007). Cada tool valida entrada e saída
com Zod antes de chamar `src/services/incidents.service.ts`, e traduz qualquer erro de
domínio lançado pelo service em um `TraceEvent` do tipo `observation` (Principle IV da
constitution) em vez de deixar a exceção se propagar.

## `list_alerts`

> Nome e schema ajustados durante `/speckit.implement` em relação à primeira versão
> deste contrato: plural (`list_alerts`, consistente com `list_alerts`/`open_incident`/
> `resolve_incident` como grupo) e um terceiro valor de status (`all`) com default
> `firing`, para que perguntas genéricas ("como está o plantão?") já respondam só com
> o que está ativo, sem exigir que o modelo sempre informe o filtro.

**Input schema**:

```ts
z.object({
  status: z.enum(["firing", "resolved", "all"]).default("firing"),
});
```

**Output**: lista de incidentes (ver `data-model.md` — `Incident`). `status: "all"` é
traduzido, na chamada ao store (`IncidentsStore.listAlerts`), para "sem filtro"
(equivalente a chamar com `status` indefinido) — a coluna `status` no banco continua
tendo somente os dois valores `firing`/`resolved` (ver data-model.md). Lista vazia (não
erro) quando não há correspondência (edge case da spec).

## `open_incident`

**Input schema**:

```ts
z.object({
  title: z.string().min(1),
  service: z.string().min(1),      // nome do Service; deve existir
  severity: z.enum(["low", "medium", "high", "critical"]),
});
```

**Output**: o `Incident` criado, com `status: "firing"`.

**Erros de domínio possíveis**: `ServiceNotFoundError` quando `service` não corresponde
a nenhum `Service` semeado — traduzido para uma `observation` de erro, não uma exceção
não tratada.

## `resolve_incident`

**Input schema**:

```ts
z.object({
  id: z.number().int().positive(),
});
```

**Output**: o `Incident` atualizado, com `status: "resolved"`.

**Erros de domínio possíveis**: `IncidentNotFoundError` quando `id` não corresponde a
nenhum `Incident` existente — traduzido para uma `observation` de erro (edge case da
spec), execução da estratégia continua normalmente.

**Idempotência**: resolver um incidente já `resolved` retorna sucesso sem alterar o
registro (ver `data-model.md`).

# Data Model: MCP Server (stdio) para OpsPilot

Esta feature não introduz nenhuma entidade de domínio nova. Ela reexpõe, por um
segundo transporte, entidades e regras já modeladas em `src/store/ops-store.ts`
e já validadas pelos schemas zod hoje definidos em `src/agents/tools.ts` (a
serem extraídos para `src/agents/ops-actions.ts`, ver [research.md](./research.md#2-reaproveitar-o-mesmo-schema-zod-nas-duas-tools-langchain--mcp)).

## Entidades reutilizadas (sem alteração de forma)

### Alert

Definida em `src/store/ops-store.ts`. Campos: `id`, `title`, `service`,
`severity` (`Severity`), `status` (`AlertStatus`: `firing` | `resolved`).
Retornada, sem transformação, pelo `listAlertsAction`.

### Incident

Definida em `src/store/ops-store.ts`. Campos: `id`, `title`, `service`,
`severity` (`Severity`), `status` (`IncidentStatus`: `open` | `resolved`),
`resolvedAt` (`string | null`), `summary` (`string | null`). Retornada, sem
transformação, por `openIncidentAction` e `resolveIncidentAction`.

### Severity / AlertStatus / IncidentStatus

Enums já definidos em `src/store/ops-store.ts` (`SEVERITIES`, `ALERT_STATUSES`,
`INCIDENT_STATUSES`) — reutilizados como estão nos schemas de entrada.

## Schemas de entrada (zod) — extraídos para `src/agents/ops-actions.ts`

Estes três `z.object({...})` são movidos, palavra por palavra, do que hoje é
inline em `src/agents/tools.ts`. Nenhuma regra de validação muda — só o local
onde o schema é definido, para que os dois transportes importem a mesma
constante.

### `listAlertsInputSchema`

| Campo | Tipo | Regra |
|---|---|---|
| `status` | enum `"firing" \| "resolved" \| "all"` | opcional, default `"firing"` |

### `openIncidentInputSchema`

| Campo | Tipo | Regra |
|---|---|---|
| `title` | string | `min(1)` |
| `service` | string | `min(1)` |
| `severity` | enum `Severity` (`low`\|`medium`\|`high`\|`critical`) | obrigatório |

### `resolveIncidentInputSchema`

| Campo | Tipo | Regra |
|---|---|---|
| `id` | number | inteiro, positivo |

## Funções de ação (novas, em `src/agents/ops-actions.ts`)

Não são entidades de dados, mas fazem parte do "modelo" desta feature no
sentido de que são o contrato compartilhado entre os dois transportes:

- `listAlertsAction(store: OpsStore, input: { status?: "firing"|"resolved"|"all" }): Promise<Alert[]>`
- `openIncidentAction(store: OpsStore, input: { title: string; service: string; severity: Severity }): Promise<Incident>` — propaga `ServiceNotFoundError` se o serviço não existir.
- `resolveIncidentAction(store: OpsStore, input: { id: number }): Promise<Incident>` — propaga `IncidentNotFoundError` se o id não existir.

Nenhuma nova classe de erro é criada — `ServiceNotFoundError` e
`IncidentNotFoundError`, já definidas em `src/services/errors.ts`, continuam
sendo as únicas fontes de erro de domínio (Constitution, Princípio IV).

## Transições de estado

Sem alteração: `Alert` e `Incident` mantêm exatamente as mesmas transições já
garantidas pelo `OpsStore` (`open_incident` cria um incidente em `open`;
`resolve_incident` move um incidente de `open` para `resolved`, preenchendo
`resolvedAt`). O transporte MCP não introduz nenhuma transição nova nem
nenhuma regra de negócio adicional.

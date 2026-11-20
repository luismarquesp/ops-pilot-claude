# Contract: Tools LangChain (`src/agents/tools.ts`)

5 tools sobre `OpsStore` (`createOpsTools(store: OpsStore): StructuredToolInterface[]`).
Cada descrição abaixo é revisada contra as "6 regras" de research.md §7: o que faz,
quando usar (e como se distingue das outras), todo campo com `.describe()`, campo
fechado como `z.enum`, default explícito, texto curto e não ambíguo.

## `list_alerts` (existente — descrição revisada)

- **Quando usar**: pergunta sobre o que o monitoramento está sinalizando agora
  ("o que está disparando", "como estão os serviços", "tem algum alerta").
- **Quando NÃO usar**: para saber quais incidentes o time já abriu — isso é
  `list_incidents`.
- **Schema**:
  - `status: z.enum(["firing", "resolved", "all"]).default("firing").describe(...)`

## `list_incidents` (nova)

- **Quando usar**: pergunta sobre o andamento do trabalho do time — incidentes já
  abertos/rastreados ("o que está em aberto", "quais incidentes seguimos
  tratando", "me dá o histórico de incidentes resolvidos").
- **Quando NÃO usar**: para saber o que o monitoramento está emitindo cru — isso
  é `list_alerts`; para abrir um incidente novo — isso é `open_incident`.
- **Schema**:
  - `status: z.enum(["open", "resolved", "all"]).default("open").describe(...)`
- **Comportamento**: `status` ausente ou `"open"` → só incidentes abertos;
  `"resolved"` → só resolvidos; `"all"` → os dois. Resolução do default `"open"`
  acontece na tool antes de chamar `store.listIncidents(...)` (ver
  `contracts/ops-store.md`).

## `open_incident` (existente — descrição revisada, comportamento muda)

- **Quando usar**: o operador decide formalmente tratar um problema em um serviço
  monitorado (cria um registro novo em `incidents`, distinto de um `Alert` que já
  existe sozinho vindo do monitoramento).
- **Quando NÃO usar**: para só consultar o que já está acontecendo — isso é
  `list_alerts`/`list_incidents`.
- **Schema**: `title`, `service`, `severity` — cada campo com `.describe()`;
  `severity: z.enum(SEVERITIES)`.
- **Mudança de comportamento**: o incidente criado nasce com `status: "open"`
  (antes: `"firing"`) — ver research.md §4.

## `resolve_incident` (existente — descrição revisada)

- **Quando usar**: marcar como resolvido um incidente que o time abriu
  (`open_incident`), dado seu `id`.
- **Quando NÃO usar**: não resolve `Alert` — alerts não têm uma tool de escrita
  nesta feature.
- **Schema**: `id: z.number().int().positive().describe(...)`.

## `consultar_runbook` (nova)

- **Quando usar**: o operador pede orientação de como agir durante um incidente
  de um serviço específico ("como eu trato isso", "qual o procedimento para
  pagamentos", "runbook do checkout").
- **Schema**: `service: z.string().min(1).describe(...)`.
- **Comportamento**: serviço sem runbook cadastrado (ou inexistente) → a tool
  captura `RunbookNotFoundError` e retorna uma mensagem de erro textual (mesmo
  padrão das outras tools — erro de domínio nunca escapa como exceção não
  tratada, Constitution Princípio IV), nunca lança.

## Padrão de erro nas tools (mantido)

Toda tool que pode receber um domínio inexistente (`open_incident`,
`resolve_incident`, `consultar_runbook`) segue o padrão já usado hoje:

```ts
try {
  const result = await store.algumaOperacao(...);
  return JSON.stringify(result);
} catch (error) {
  if (error instanceof AlgumErroDeDominio) {
    return `Erro: ${error.message}`;
  }
  throw error; // erro inesperado NÃO é engolido
}
```

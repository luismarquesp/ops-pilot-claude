# Contract: `OpsStore`

Interface única implementada por `SqliteOpsStore` (`src/store/sqlite-ops-store.ts`)
e `MockOpsStore` (`src/store/mock-ops-store.ts`). Ambas devem passar exatamente os
mesmos testes de contrato (mesmos casos, rodando contra cada implementação) — é
isso que garante que trocar uma pela outra por composição nunca muda o
comportamento observável pelas tools.

```ts
export interface OpsStore {
  listAlerts(status?: AlertStatus): Promise<Alert[]>;
  listIncidents(status?: IncidentStatus): Promise<Incident[]>;
  openIncident(input: OpenIncidentInput): Promise<Incident>;
  resolveIncident(id: number): Promise<Incident>;
  getRunbook(service: string): Promise<Runbook>;
}

export interface OpenIncidentInput {
  title: string;
  service: string;
  severity: Severity;
}
```

## `listAlerts(status?)`

- Sem argumento → retorna todos os alerts (`firing` e `resolved`).
- Com `status` → retorna só os alerts naquele status.
- Sem alerts correspondentes → `[]` (nunca lança).
- Ordenado por `id` ascendente (mesma convenção já usada hoje).

## `listIncidents(status?)`

- Sem argumento → equivalente a `status: "open"` (default da spec, FR-006) — a
  tool que chama a store já resolve esse default antes de invocar (ver
  `contracts/tools.md`); a própria store aceita `undefined` como "sem filtro,
  retorna tudo" para não duplicar a regra de default em dois lugares — **quem
  decide o default `open` é a tool**, não a store.
- Com `status: "open"` → só incidentes com `status='open'`.
- Com `status: "resolved"` → só incidentes com `status='resolved'`.
- Sem incidentes correspondentes → `[]`.
- Ordenado por `id` ascendente.

## `openIncident(input)`

- Serviço inexistente (`input.service` não bate com nenhum `services.name`) →
  lança `ServiceNotFoundError`.
- Serviço existente → insere em `incidents` com `status='open'`, `resolved_at=NULL`,
  `summary=NULL`; retorna o `Incident` criado (com `id` gerado).
- `severity` fora do enum nunca chega aqui — barrado antes, pelo Zod da tool
  (defesa em profundidade: o `CHECK` do banco também rejeitaria).

## `resolveIncident(id)`

- `id` sem incidente correspondente → lança `IncidentNotFoundError`.
- Incidente `open` → grava `status='resolved'`, `resolved_at=<timestamp ISO 8601
  atual>`; retorna o `Incident` atualizado.
- Incidente já `resolved` (idempotência) → retorna o `Incident` como está, **sem**
  sobrescrever `resolved_at` (a primeira resolução é a que vale).

## `getRunbook(service)`

- `service` sem `Service` correspondente, OU `Service` existente mas sem
  `Runbook` cadastrado → lança `RunbookNotFoundError` (um único tipo de erro para
  os dois casos — ver research.md §4/spec.md User Story 3, edge case).
- `Runbook` encontrado → retorna `{ service, content }`.

## Erros de domínio (src/services/errors.ts)

| Classe | Quando |
|---|---|
| `ServiceNotFoundError` | `openIncident` com serviço desconhecido |
| `IncidentNotFoundError` | `resolveIncident` com id desconhecido |
| `RunbookNotFoundError` (novo) | `getRunbook` sem runbook cadastrado para o serviço |

Nenhum desses erros é formatado dentro da store — cada tool em
`src/agents/tools.ts` os captura e traduz para a mensagem que volta ao LLM
(Constitution Princípio IV).

## Casos de teste de contrato obrigatórios (rodam contra `SqliteOpsStore(":memory:")` e `MockOpsStore`)

1. Seed inicial: `listAlerts()` retorna 6 (3 firing, 3 resolved); `listIncidents("all"
   equivalente, i.e. sem filtro combinando os dois status)` retorna 0.
2. `openIncident` com serviço válido → `Incident` com `status: "open"`,
   `resolvedAt: null`.
3. `openIncident` com serviço inválido → rejeita com `ServiceNotFoundError`.
4. `listIncidents("open")` / `listIncidents("resolved")` → cada um retorna só o
   subconjunto certo, depois de abrir 2 e resolver 1.
5. `resolveIncident` de um incidente aberto → `status: "resolved"`, `resolvedAt`
   não nulo.
6. `resolveIncident` chamado 2x no mesmo id → `resolvedAt` igual nas duas
   respostas (idempotente).
7. `resolveIncident` com id inexistente → rejeita com `IncidentNotFoundError`.
8. `getRunbook("checkout"|"payments"|"auth")` → retorna conteúdo não vazio.
9. `getRunbook("servico-sem-runbook")` → rejeita com `RunbookNotFoundError`.
10. Rodar o construtor da store 2x sobre o mesmo arquivo/instância → `services`
    continua com 5 linhas, `alerts` com 6 (seed não duplicado).
11. Tentar inserir um valor fora do enum em qualquer campo fechado (via acesso
    direto à store, contornando a tool) → o `CHECK` do SQLite rejeita a escrita.

# Data Model: Persistência Real de Operações (SQLite)

## Enums de domínio (fechados, com `CHECK` no banco e `z.enum` na tool)

| Enum | Valores | Usado em |
|---|---|---|
| `Severity` | `low` \| `medium` \| `high` \| `critical` | `alerts.severity`, `incidents.severity` |
| `ServiceTier` | `tier1` \| `tier2` \| `tier3` | `services.tier` |
| `AlertStatus` | `firing` \| `resolved` | `alerts.status` |
| `IncidentStatus` | `open` \| `resolved` | `incidents.status` |

`tier1` = serviços cuja indisponibilidade impede a operação do Mercadinho
(checkout, payments, auth); `tier2` = degrada a experiência sem parar a operação
(search); `tier3` = acessório (notifications).

## Entidades

### Service

| Campo | Tipo | Regras |
|---|---|---|
| `id` | INTEGER PK autoincrement | |
| `name` | TEXT | `NOT NULL UNIQUE` |
| `tier` | TEXT | `NOT NULL`, `CHECK (tier IN ('tier1','tier2','tier3'))` |

### Alert (sinal de monitoramento)

| Campo | Tipo | Regras |
|---|---|---|
| `id` | INTEGER PK autoincrement | |
| `title` | TEXT | `NOT NULL` |
| `service_id` | INTEGER | `NOT NULL REFERENCES services(id)` |
| `severity` | TEXT | `NOT NULL`, `CHECK (severity IN (...Severity))` |
| `status` | TEXT | `NOT NULL`, `CHECK (status IN ('firing','resolved'))` |

Somente leitura pelas tools desta feature (`list_alerts`); populado só pelo seed —
nenhuma tool cria/resolve um `Alert` diretamente (esse é o papel do `Incident`).

### Incident (ação do operador)

| Campo | Tipo | Regras |
|---|---|---|
| `id` | INTEGER PK autoincrement | |
| `title` | TEXT | `NOT NULL` |
| `service_id` | INTEGER | `NOT NULL REFERENCES services(id)` |
| `severity` | TEXT | `NOT NULL`, `CHECK (severity IN (...Severity))` |
| `status` | TEXT | `NOT NULL DEFAULT 'open'`, `CHECK (status IN ('open','resolved'))` |
| `resolved_at` | TEXT (ISO 8601) | anulável; setado por `resolveIncident`, nunca sobrescrito numa segunda resolução |
| `summary` | TEXT | anulável; reservado — nenhuma tool desta feature o preenche |

Criado por `open_incident` (sempre `status='open'`); mutado só por
`resolve_incident`. Vazio no seed inicial — só passa a existir quando o operador
abre um.

### Runbook

| Campo | Tipo | Regras |
|---|---|---|
| `id` | INTEGER PK autoincrement | |
| `service_id` | INTEGER | `NOT NULL UNIQUE REFERENCES services(id)` (no máx. 1 runbook por serviço) |
| `content` | TEXT | `NOT NULL` |

## DDL (idempotente, executado no construtor de `SqliteOpsStore`)

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  tier TEXT NOT NULL CHECK (tier IN ('tier1','tier2','tier3'))
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  service_id INTEGER NOT NULL REFERENCES services(id),
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  status TEXT NOT NULL CHECK (status IN ('firing','resolved'))
);

CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  service_id INTEGER NOT NULL REFERENCES services(id),
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolved_at TEXT,
  summary TEXT
);

CREATE TABLE IF NOT EXISTS runbooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER NOT NULL UNIQUE REFERENCES services(id),
  content TEXT NOT NULL
);
```

## Seed "Mercadinho" (idempotente — só roda se `services` estiver vazia)

**Guarda de idempotência**: `SELECT COUNT(*) FROM services` no construtor; só
executa os `INSERT`s abaixo se o resultado for `0`. Uma única transação
(`db.exec("BEGIN"); ...; db.exec("COMMIT")`) para não deixar o banco pela metade
se algo falhar no meio do seed.

**Services** (5):

| name | tier |
|---|---|
| checkout | tier1 |
| payments | tier1 |
| auth | tier1 |
| search | tier2 |
| notifications | tier3 |

**Alerts** (6 — 3 `firing`, 3 `resolved`):

| title | service | severity | status |
|---|---|---|---|
| Fila de pagamento travada | checkout | high | firing |
| Latência alta no gateway | payments | critical | firing |
| Erro 500 no login | auth | high | firing |
| Indexação atrasada | search | medium | resolved |
| E-mails duplicados | notifications | low | resolved |
| Timeout no carrinho | checkout | medium | resolved |

**Incidents**: nenhum no seed — a tabela começa vazia; incidentes só existem
depois que `open_incident` é chamado (ver Incident acima).

**Runbooks** (3 — checkout, payments, auth):

| service | content (resumo) |
|---|---|
| checkout | Passos de mitigação para fila/carrinho travado: reiniciar o worker de fila, verificar profundidade da fila no painel, escalar para o time de pagamentos se a fila não esvaziar em 5min. |
| payments | Passos para latência/erro no gateway de pagamento: checar status page do provedor, ativar o gateway secundário de fallback, notificar o time financeiro se o fallback também falhar. |
| auth | Passos para erro de login: verificar saúde do serviço de sessão, checar taxa de erro por provedor de identidade, forçar rollback do último deploy se o erro começou após um deploy. |

(Conteúdo de `content` é ilustrativo — texto final livre na implementação, desde
que cubra os 3 serviços pedidos; ver spec.md, Assumptions.)

## Mapeamento linha ↔ domínio (DTOs retornados pelo `OpsStore`)

```ts
interface Alert {
  id: number;
  title: string;
  service: string;      // nome, não service_id — mesma convenção do Alert atual
  severity: Severity;
  status: AlertStatus;
}

interface Incident {
  id: number;
  title: string;
  service: string;
  severity: Severity;
  status: IncidentStatus;
  resolvedAt: string | null;
  summary: string | null;
}

interface Runbook {
  service: string;
  content: string;
}
```

`service_id` nunca vaza para fora da store — todo DTO expõe `service` (nome),
igual ao `Alert` atual, para não obrigar quem chama a tool a conhecer IDs
internos de serviço.

## State transitions

- `Alert`: populado só pelo seed; sem transição de estado nesta feature (nenhuma
  tool resolve/edita um alert).
- `Incident`: `open` (criado por `openIncident`) → `resolved` (por
  `resolveIncident`, que também grava `resolvedAt`). `resolved` → `resolved` é
  uma transição permitida e idempotente (não altera `resolvedAt` de novo).
- `Service`/`Runbook`: imutáveis nesta feature (só populados pelo seed; sem tool
  de escrita).

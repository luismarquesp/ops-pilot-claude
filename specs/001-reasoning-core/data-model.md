# Data Model: Núcleo de Raciocínio do OpsPilot

Entidades derivadas de `spec.md` (seção Key Entities) e das decisões de
`research.md`. Persistidas via Sequelize (MySQL em produção, dialeto em memória nos
testes — ver research.md §3).

## Service

Representa um serviço de produção monitorado.

| Campo | Tipo | Regras |
|-------|------|--------|
| `id` | integer, PK, auto-increment | gerado pelo banco |
| `name` | string, obrigatório, único | usado como referência em `Incident.service` |

**Seed primário (FR-009)**: exatamente 5 registros (ex.: `checkout`, `payments`,
`auth`, `search`, `notifications` — nomes exatos são detalhe de implementação do
`seed.ts`, não normativos).

## Incident

Representa um alerta/incidente sobre um `Service` (ver spec.md — Assumptions: "Alerta"
e "Incidente" são a mesma entidade de domínio neste núcleo).

| Campo | Tipo | Regras |
|-------|------|--------|
| `id` | integer, PK, auto-increment | usado por `resolve_incident(id)` |
| `title` | string, obrigatório | título curto do incidente |
| `serviceId` | integer, FK → `Service.id`, obrigatório | serviço afetado |
| `severity` | enum `low \| medium \| high \| critical`, obrigatório | ver research.md §5 |
| `status` | enum `firing \| resolved`, obrigatório, default `firing` na criação | ver transições abaixo |

**Validação (FR-007, via Zod na fronteira em `agents/tools.ts`, refletida aqui como
regra de domínio)**:
- `title` não pode ser vazio.
- `serviceId` deve referenciar um `Service` existente.
- `severity` deve ser um dos quatro valores do enum.
- `id` passado para `resolve_incident` deve referenciar um `Incident` existente; caso
  contrário, a operação falha com um erro de domínio (`IncidentNotFoundError`), nunca
  com uma exceção não tratada (edge case da spec).

**Transições de estado**:

```text
(criação via open_incident) ──► firing ──► resolved (via resolve_incident)
```

- Não há transição de volta de `resolved` para `firing` nesta feature (fora de escopo).
- `resolve_incident` sobre um incidente já `resolved` é idempotente: retorna sucesso
  sem alterar o registro (evita que a estratégia falhe ao tentar resolver duas vezes).

**Seed primário (FR-009)**: exatamente 6 registros, sendo 3 com `status = firing` e 3
com `status = resolved`, distribuídos entre os 5 serviços semeados.

## ReasoningStrategy (contrato, não persistido)

Ver [contracts/reasoning-strategy.md](./contracts/reasoning-strategy.md) para a forma
completa do contrato `name` + `run(input)`.

## Trace / TraceEvent (valor, não persistido)

Estrutura em memória, produzida por uma execução e formatada para exibição pela
`arena`. Ver [contracts/reasoning-strategy.md](./contracts/reasoning-strategy.md).

| Tipo de evento | Campos específicos |
|----------------|---------------------|
| `thought` | `content: string` |
| `action` | `tool: string`, `args: unknown` (validado pelo schema Zod da tool correspondente) |
| `observation` | `content: string` (inclui erros de domínio traduzidos como texto legível) |
| `plan` | `steps: string[]` (somente Plan-and-Execute) |
| `critique` | `content: string` (avaliação do replanner sobre o progresso) |
| `answer` | `content: string` (evento final de toda execução) |

## Metrics (valor, não persistido)

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `llmCalls` | integer ≥ 0 | número de chamadas ao modelo de linguagem (research.md §4) |
| `latencyMs` | integer ≥ 0 | duração total da execução, em milissegundos |

# Data Model: Endpoint HTTP de Chat sobre o Núcleo de Raciocínio

Sem persistência nova (ver plan.md, Constitution Check). As "entidades" aqui são
formas de requisição/resposta HTTP e o registro de estratégias, todos em memória.

## ChatRequest (corpo de `POST /chat`)

| Campo | Tipo | Regras |
|-------|------|--------|
| `message` | string, obrigatório | não pode ser vazio (FR-002; edge case da spec: string vazia é corpo inválido) |
| `strategy` | string, opcional | quando ausente, usa a estratégia padrão (`react` — FR-003); quando presente, DEVE corresponder a um nome do [Registro de Estratégias](#registro-de-estratégias-strategyregistry), senão a requisição falha com estratégia desconhecida (FR-006) |
| `reflect` | boolean, opcional | quando `true`, `withReflection` (specs/002) é aplicado sobre a estratégia já resolvida (FR-009); default `false` |

Campos além desses três são ignorados (Assumptions da spec).

## ChatResponse — sucesso (200)

Mesma forma de `StrategyResult` (specs/001, `contracts/reasoning-strategy.md`) —
nenhum campo novo:

```ts
{
  answer: string;
  trace: TraceEvent[];
  metrics: { llmCalls: number; latencyMs: number };
}
```

## ChatResponse — erro

| Status | Quando | Corpo |
|--------|--------|-------|
| 400 | `ChatRequest` falha a validação Zod (FR-005) | `{ issues: ZodIssue[] }` — os `issues` do próprio Zod, sem reformatação |
| 422 | `strategy` informado não existe no registro (FR-006) | `{ error: "unknown_strategy"; strategy: string; available: string[] }` |
| 504 | execução não termina em 180s (FR-007) | `{ error: "timeout"; timeoutMs: number }` |
| 500 | erro inesperado durante a execução (research.md §4, fora do pedido literal mas necessário) | `{ error: "internal_error" }` |

## Registro de Estratégias (StrategyRegistry)

Um `Map<string, ReasoningStrategy>` (FR-008), construído por
`createStrategyRegistry(tools)`:

| Chave | Estratégia |
|-------|------------|
| `react` (padrão) | `createReactStrategy(tools)` (specs/001) |
| `plan-and-execute` | `createPlanAndExecuteStrategy(tools)` (specs/001) |

A reflexão (`reflect: true`) não tem entrada própria no registro — é aplicada em
runtime sobre a estratégia já resolvida (FR-009), reaproveitando
`withReflection` (specs/002) tal como já existe, sem nenhuma mudança nele.

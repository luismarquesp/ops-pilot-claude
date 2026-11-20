# Contract: fábrica de modelo resiliente

## `src/agents/model.ts`

```ts
export interface ModelChain { primary: string; fallbacks: string[] }

/** Pura: OPEN_ROUTER_MODEL + OPENROUTER_MODEL_FALLBACK → cadeia validada (FR-004). */
export function parseModelChain(env: Readonly<Record<string, string | undefined>>): ModelChain;

/** Tentativas por modelo (principal e cada reserva). */
export const MODEL_ATTEMPTS = 2;

/** ChatOpenAI cru de um modelo: OpenRouter, temperatura 0, maxRetries 0, callbacks de uso (specs/011). */
export function createChatModel(id: string): ChatOpenAI;

/**
 * Modelo resiliente: build(primário) com withRetry, e withFallbacks(build(reserva)...).
 * Sucesso → recordModelCall({ modelUsed, switches }); total → ModelUnavailableError.
 */
export function createModel<O = AIMessageChunk>(
  build?: (model: ChatOpenAI) => Runnable<BaseLanguageModelInput, O>,
  chain?: ModelChain,               // default: parseModelChain(process.env)
): Runnable<BaseLanguageModelInput, O>;
```

## `src/agents/resilience.ts` (núcleo testável sem rede)

```ts
export interface ModelAttempt { model: string; ok: boolean; error?: string }
export interface ModelSwitch { from: string; to: string; reason: string }
export interface ModelCallOutcome { modelUsed: string | null; switches: ModelSwitch[]; modelsTried: string[] }

export function summarizeAttempts(attempts: readonly ModelAttempt[]): ModelCallOutcome; // pura

export function withResilience<I, O>(
  entries: ReadonlyArray<{ id: string; runnable: Runnable<I, O> }>,   // [primário, ...reservas]
  opts?: { attempts?: number },                                      // default MODEL_ATTEMPTS
): Runnable<I, O>;

export function logModelFallback(change: ModelSwitch): void; // só ids + nome do erro
```

Regras de `withResilience`:

- cada modelo (primário e reservas) roda dentro de
  `withRetry({ stopAfterAttempt: attempts })`; as reservas entram via
  `withFallbacks`, na ordem;
- cada `runnable` passa por `track(id, …)`, que registra uma `ModelAttempt`
  no escopo da chamada;
- em sucesso: `recordModelCall(outcome)` (fora de `trackModelCalls` não faz
  nada) e `logModelFallback` para cada troca;
- em falha total: lança `ModelUnavailableError(outcome.modelsTried)`.

## `src/agents/model-calls.ts`

```ts
export type ModelCall = Pick<ModelCallOutcome, "modelUsed" | "switches">;
export function trackModelCalls<T>(fn: () => Promise<T>): Promise<{ value: T; calls: ModelCall[] }>;
export function recordModelCall(call: ModelCall): void;
export function modelCallsSince(mark: number): ModelCall[];   // [] fora de escopo
export function modelCallCount(): number;                      // 0 fora de escopo
```

## Pontos de chamada (migração)

| Arquivo | Antes | Depois |
|---------|-------|--------|
| `react.ts` | `createReactAgent({ llm: createModel(), tools })` | `createReactAgent({ llm: () => createModel((m) => m.bindTools(tools)), tools })` |
| `plan-and-execute.ts` (planner/replanner) | `createModel().withStructuredOutput(s)` | `createModel((m) => m.withStructuredOutput(s))` |
| `plan-and-execute.ts` (executor) | `createModel().bindTools(tools)` | `createModel((m) => m.bindTools(tools))` |
| `reflection.ts`, `router.ts`, `learning.ts` | `createModel().withStructuredOutput(s)` | `createModel((m) => m.withStructuredOutput(s))` |
| `summarizer.ts` | `createModel().invoke(...)` | `createModel().invoke(...)` (inalterado) |

## Grafo (`src/graph/production-graph.ts`)

- Cada nó: `mark = modelCallCount()` antes; depois,
  `fallbackEvents(modelCallsSince(mark))` (pura) com `tagTrace(..., <nó>)`, no
  início dos eventos do nó.
- Nó de estratégia: `modelUsed = modelCallsSince(mark).at(-1)?.modelUsed ?? null`.
- Nó `resposta`: `trace = dedupeFallbacks(state.trace)` (pura) e
  `ProductionOutput.modelUsed`.
- `GraphTraceEvent` ganha o membro `FallbackEvent = { type: "fallback"; from; to; reason }`.

# Contract: aprendizado (`src/memory/learning.ts`, `src/memory/secrets.ts`)

```ts
// secrets.ts — puro
export function containsSecret(text: string): boolean;

// learning.ts
export const MAX_FACT_LENGTH = 500;

export interface LearningVerdict { hasLearning: boolean; fact?: string }
export type LearningExtractor = (message: string) => Promise<LearningVerdict>;
export type LearningOutcome = "skipped_secret" | "nothing" | "rejected" | "learned" | "duplicate" | "failed";
export interface LearnInput { userId: string; message: string }

export interface LearnDeps {
	memory: MemoryStore;
	extractor: LearningExtractor;
	log: (error: unknown) => void;
}

/** Puro: o fato que pode ir para a memória, ou `undefined`. */
export function toLearnableFact(verdict: LearningVerdict): string | undefined;

/** Nunca rejeita. Ver as transições em data-model.md. */
export function learnFromMessage(input: LearnInput, deps: LearnDeps): Promise<LearningOutcome>;

/** Extrator real: createModel().withStructuredOutput(schema), prompt LEARNING_PROMPT (research §2). */
export const defaultLearningExtractor: LearningExtractor;

/** console.warn só com o nome do erro (research §6). */
export function logLearningFailure(error: unknown): void;
```

## Integração com o turno (`src/services/chat-service.ts`)

```ts
export interface ChatDeps {
	// ...existentes
	/** Disparado sem await após um turno bem-sucedido com userId (specs/009). */
	learn?: (input: LearnInput) => Promise<unknown>;
}
```

| Condição | `learn` é chamado? |
|----------|--------------------|
| sucesso + `userId` + `learn` | sim, uma vez, **depois** de gravar a conversa, **sem await** |
| sem `userId` | não |
| estratégia lança erro / timeout / conversa inexistente | não |

A resposta de `runChat` é idêntica com ou sem `learn`, e nenhuma métrica nova é criada.

## Controller (`src/http/server.ts`)

`AppDeps` ganha `learn?: (input: LearnInput) => Promise<unknown>`, repassado ao
`runChat`. O contrato HTTP do `/chat` **não muda**.

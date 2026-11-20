# Contract: Summarizer

```ts
type Summarizer = (input: {
	previous?: string;                     // resumo anterior, se houver
	messages: readonly HistoryMessage[];   // pendentes, mais antiga primeiro
}) => Promise<string>;
```

- Devolve o resumo **mesclado** (anterior + mensagens), em português, meta
  ~150 tokens, organizado em **Decisões**, **Fatos** e **Pendências**.
- Nunca recebe a conversa inteira — só `previous` + pendentes.
- Pode rejeitar; quem chama (`loadConversationContext`) trata a falha
  (research.md §7). Texto vazio é tratado como falha.

Implementações:

- `defaultSummarizer` (`src/agents/summarizer.ts`): `createModel()` +
  `summarizerMessages(input)` (função pura que monta `[system, user]`).
- `createFakeSummarizer()` (`src/agents/fake-summarizer.ts`): determinístico,
  sem rede; expõe as chamadas recebidas para os testes.

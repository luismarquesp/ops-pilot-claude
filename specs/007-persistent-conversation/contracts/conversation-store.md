# Contract: ConversationStore

Interface em `src/store/conversation-store.ts`. Implementações:
`SqliteConversationStore` (`src/store/sqlite-conversation-store.ts`, real) e
`createMockConversationStore()` (`src/store/mock-conversation-store.ts`, fake em memória
para testes). Ambas passam pela mesma suíte
`src/store/conversation-store.contract-tests.ts`.

## Interface

```ts
interface ConversationStore {
  /** Cria uma conversa vazia com id UUID gerado pelo store. */
  create(): Promise<Conversation>;

  /**
   * Acrescenta uma mensagem ao fim da conversa. Lança
   * ConversationNotFoundError se o id não existir.
   */
  append(conversationId: string, role: MessageRole, content: string): Promise<ConversationMessage>;

  /**
   * As `limit` mensagens mais recentes, em ordem cronológica (mais antiga
   * primeiro). Conversa existente sem mensagens → []. Lança
   * ConversationNotFoundError se o id não existir.
   */
  lastMessages(conversationId: string, limit: number): Promise<ConversationMessage[]>;
}
```

## Regras do contrato (cobertas pela suíte de contrato)

1. `create()` devolve ids distintos a cada chamada; a conversa nova tem `lastMessages` = `[]`.
2. `append` seguido de `lastMessages` devolve as mensagens na ordem de gravação,
   com `role` e `content` preservados.
3. `lastMessages(id, n)` com mais de `n` mensagens devolve exatamente as `n` últimas,
   mais antiga primeiro.
4. `append` e `lastMessages` com id desconhecido lançam `ConversationNotFoundError`
   (com `conversationId` preenchido).
5. Mensagens de uma conversa nunca aparecem em `lastMessages` de outra.

## Regras específicas do SQLite

- DDL idempotente no construtor; reabrir o mesmo arquivo preserva conversas e
  mensagens (não apaga, não duplica).
- Toda query com prepared statement; nenhum SQL concatenado com dados.
- `close()` libera o handle (usado pelos testes).

## Revisão na implementação

`append` passou a gravar **uma mensagem por chamada** (`role`, `content`), como no
esboço de referência do `/speckit-implement`, em vez de um array atômico. O par do
turno é gravado por duas chamadas seguidas, ambas só depois do sucesso da
estratégia (FR-006 preservado).

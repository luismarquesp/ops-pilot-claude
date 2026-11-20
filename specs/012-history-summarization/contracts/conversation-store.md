# Contract: ConversationStore (revisão para sumarização)

Emenda a [specs/007-persistent-conversation/contracts/conversation-store.md](../../007-persistent-conversation/contracts/conversation-store.md).
`create`, `append` e `lastMessages` não mudam. Implementações:
`SqliteConversationStore` e `createMockConversationStore`, ambas cobertas por
`runConversationStoreContractTests`.

## `messagesSince(conversationId, afterSeq): Promise<StoredMessage[]>`

- Mensagens com `seq > afterSeq`, em ordem cronológica, com `seq` crescente.
- `afterSeq = 0` → todas as mensagens.
- Id desconhecido → rejeita com `ConversationNotFoundError`.

## `getSummary(conversationId): Promise<ConversationSummary | undefined>`

- Resumo vigente ou `undefined` se a conversa nunca foi resumida.
- Id desconhecido → rejeita com `ConversationNotFoundError`.

## `saveSummary(conversationId, summary: NewConversationSummary): Promise<boolean>`

- Grava se não houver resumo ou se `summary.coveredUntil` for **maior** que o
  atual; devolve `true`. Caso contrário não altera nada e devolve `false`.
- `summary.summary` vazio (após trim) ou contadores ≤ 0 → erro de programação
  (rejeita); quem chama já filtra (research.md §7).
- Id desconhecido → rejeita com `ConversationNotFoundError`.
- Resumos de uma conversa nunca aparecem em outra.

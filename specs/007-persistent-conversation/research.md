# Research: Conversa Persistente no Chat

Não havia `NEEDS CLARIFICATION` no Technical Context — a stack é a existente. As
decisões abaixo resolvem as escolhas de design que a spec deixou em aberto.

## §1 — Como o histórico entra no prompt ("via composição")

- **Decision**: decorador puro `withHistory(strategy, history)` em
  `src/agents/history.ts`, no mesmo molde de `withReflection`. Ele reescreve
  `StrategyInput.question` prefixando um bloco de histórico formatado por uma função
  pura `formatQuestionWithHistory(history, question)`. Com histórico vazio, a
  pergunta passa **inalterada**.
- **Rationale**: FR-008 exige que nenhuma estratégia saiba que a conversa existe.
  `react` e `plan-and-execute` já recebem só `question: string`; reescrever a string
  mantém o contrato `ReasoningStrategy` (specs/001) intacto, e `arena`/`bench` não
  mudam. Com histórico vazio o comportamento é idêntico ao atual (SC-005).
- **Alternatives considered**:
  - Adicionar `history?: ChatMessage[]` a `StrategyInput` e injetar como mensagens
    reais do LangChain em cada estratégia — mais "nativo", mas obriga mudar as duas
    estratégias (e o planner/executor/replanner do Plan-and-Execute), violando
    FR-008.
  - Guardar o histórico dentro do estado do LangGraph (checkpointer) — acopla a
    persistência ao LangGraph e não funciona igual para as duas estratégias.

## §2 — Ordem de composição com a reflexão

- **Decision**: `withHistory(reflect ? withReflection(base) : base, history)` — o
  histórico é a camada **mais externa**.
- **Rationale**: `withReflection` reconstrói `metrics` como `{ llmCalls, latencyMs }`;
  se o histórico ficasse por dentro, `historyMessages` seria descartado. Por fora, o
  crítico recebe a pergunta já contextualizada — necessário para julgar
  acompanhamentos como "abre um incidente para o segundo".
- **Alternatives considered**: `withReflection(withHistory(base))` — perderia a
  métrica e o crítico julgaria a pergunta sem contexto.

## §3 — Formato do histórico no prompt

- **Decision**: texto em PT-BR, mais antigo primeiro:

  ```text
  Histórico recente desta conversa (mais antigo primeiro):
  Plantonista: <conteúdo>
  OpsPilot: <conteúdo>
  ...

  Pergunta atual: <pergunta>
  ```

- **Rationale**: legível para qualquer modelo, determinístico (testável por
  igualdade de string), e o marcador "Pergunta atual" deixa claro o que responder.
- **Alternatives considered**: JSON serializado — mais ruidoso para o LLM, sem ganho.

## §4 — Teto de 12 mensagens

- **Decision**: constante `HISTORY_LIMIT = 12` em `src/agents/history.ts`, passada a
  `ConversationStore.lastMessages(id, HISTORY_LIMIT)`. O store devolve as N mais
  recentes **em ordem cronológica**. Conta mensagens individuais e não inclui a
  mensagem do turno atual (que ainda não foi gravada).
- **Rationale**: o corte acontece no banco (`ORDER BY id DESC LIMIT ?` e inversão),
  sem carregar conversas longas inteiras. `historyMessages` = `history.length`.

## §5 — Quando criar a conversa e quando gravar

- **Decision**: fluxo do Controller:
  1. valida corpo (400) → 2. resolve estratégia (422) → 3. se veio
  `conversationId`, `lastMessages(id, 12)` — `ConversationNotFoundError` → 404;
  senão histórico `[]` → 4. executa com timeout (504) → 5. **só em sucesso**:
  `id = conversationId ?? create().id`, `append(id, "user", …)` e
  `append(id, "assistant", …)` → 200. Implementado no serviço `runChat`
  (`src/services/chat-service.ts`), que também é dono do `runWithTimeout` — assim
  um resultado tardio nunca chega aos `append`.
- **Rationale**: FR-006 (turno falho não altera nada) e edge case "timeout não grava
  nada". Criar a conversa só depois do sucesso evita conversas vazias órfãs. Como
  a gravação está no caminho de sucesso de `runWithTimeout`, um resultado que chega
  depois do 504 é descartado e nunca gravado.
- **Alternatives considered**: criar a conversa antes de rodar — deixaria conversas
  vazias quando o turno falha e exigiria limpeza.

## §6 — Identificador e detecção de conversa inexistente

- **Decision**: `conversationId` é UUID v4 gerado por `crypto.randomUUID()`
  (`node:crypto`, nativo). Zod: `z.uuid().optional()` — formato inválido → 400.
  `lastMessages` e `append` lançam `ConversationNotFoundError` (nova classe em
  `src/services/errors.ts`) para id desconhecido; o Controller traduz em
  `404 { error: "conversation_not_found", conversationId }`.
- **Rationale**: UUID não é sequencial nem adivinhável (conversas não têm dono —
  ver Assumptions da spec); erro de domínio como classe, traduzido na borda
  (Princípio IV). Não é preciso um método `exists` extra: a interface fica nas três
  operações pedidas (`create`/`append`/`lastMessages`).
- **Alternatives considered**: `INTEGER AUTOINCREMENT` — enumerável; 422 para id
  desconhecido — 404 descreve melhor "recurso não encontrado" e mantém 422 exclusivo
  de estratégia.

## §7 — Persistência no SQLite

- **Decision**: `SqliteConversationStore` em `src/store/sqlite-conversation-store.ts`,
  mesmo padrão do `SqliteOpsStore`: construtor recebe `path` (default
  `OPSPILOT_DB ?? "./data/opspilot.db"`), cria o diretório se não for `:memory:`,
  DDL idempotente (`CREATE TABLE/INDEX IF NOT EXISTS`), prepared statements em toda
  query, `close()` para os testes. `append` grava as mensagens em uma transação
  (`BEGIN`/`COMMIT`/`ROLLBACK`) — o par do turno entra inteiro ou não entra.
  Tabelas `conversations` e `messages` (ver data-model.md).
- **Rationale**: FR-010/FR-011 e constitution v1.1.0 (node:sqlite, DDL idempotente,
  sem migrations). Conexão própria sobre o mesmo arquivo é segura: `DatabaseSync` é
  síncrono em um único processo. Extrair a constante de caminho default
  (`DEFAULT_DB_PATH`) para ser compartilhada pelos dois stores evita divergência.
- **Alternatives considered**: estender `SqliteOpsStore`/`OpsStore` com métodos de
  conversa — mistura dois agregados numa interface e força o `MockOpsStore` e o MCP
  a conhecer conversas. Compartilhar uma única instância de `DatabaseSync` —
  possível, mas exige mudar o construtor do `SqliteOpsStore` sem necessidade.

## §8 — Estratégia de testes (":memory:" + fake)

- **Decision**:
  - `src/store/conversation-store.contract-tests.ts` — suíte de contrato
    reaproveitada (mesmo padrão de `ops-store.contract-tests.ts`) rodando contra
    `SqliteConversationStore(":memory:")` e contra `createMockConversationStore()`
    (fake em memória, `src/store/mock-conversation-store.ts`).
  - Teste extra do SQLite: reabrir o **mesmo arquivo** em diretório temporário para
    provar persistência entre instâncias (US2) e DDL idempotente.
  - `src/agents/history.test.ts` — funções puras (`formatQuestionWithHistory`) e
    `withHistory` com estratégia fake que registra a `question` recebida.
  - `src/http/server.test.ts` — integração com estratégia fake determinística +
    `createMockConversationStore()`: 200 com `conversationId`, 404, 400 para id malformado,
    504/422 não gravam, `historyMessages` 0 → 2 → … → 12.
- **Rationale**: FR-013 — sem rede, sem arquivo (exceto o teste de persistência
  explícito, que usa diretório temporário e limpa ao final).

## §9 — Concorrência na mesma conversa

- **Decision**: não tratada explicitamente. Dois turnos simultâneos na mesma
  conversa leem o mesmo histórico e gravam seus pares na ordem em que terminam; como
  cada par é gravado em transação, pares nunca se intercalam.
- **Rationale**: uso real é um operador por conversa; serializar turnos adicionaria
  locking sem demanda na spec.

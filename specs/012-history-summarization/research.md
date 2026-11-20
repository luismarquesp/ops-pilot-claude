# Research: Sumarização de Histórico (Pruning)

## §1 — Onde o resumo mora: no próprio `ConversationStore`

- **Decision**: a tabela `conversation_summaries` é criada pelo DDL do
  `SqliteConversationStore`, e a interface `ConversationStore` ganha três
  métodos: `messagesSince`, `getSummary`, `saveSummary`
  ([contracts/conversation-store.md](./contracts/conversation-store.md)).
  `createMockConversationStore` implementa os mesmos, e os testes de contrato
  compartilhados (`conversation-store.contract-tests.ts`) cobrem os dois.
- **Rationale**: o resumo tem FK para `conversations` e precisa do mesmo handle
  `DatabaseSync` — com `:memory:` nos testes, uma segunda conexão seria outro
  banco e a FK falharia. É o Model da conversa (constituição Princípio III).
- **Alternatives**: `SqliteSummaryStore` separado — exigiria compartilhar o
  handle entre classes ou abrir duas conexões; resumo dentro de
  `conversations` (coluna) — mistura ciclo de vida e torna a gravação
  monotônica (§6) menos direta.

## §2 — Marca de cobertura = `messages.id`

- **Decision**: o resumo guarda `coveredUntil` = `messages.id` da última
  mensagem absorvida. `messagesSince(conversationId, coveredUntil)` devolve as
  mensagens com `id > coveredUntil`, em ordem, com `seq` (o próprio id). Sem
  resumo, `coveredUntil = 0`. No mock, `seq` é a posição 1-based na conversa.
- **Rationale**: `messages.id` já é a ordem cronológica (specs/007); comparar
  inteiros é trivial e estável. O `seq` só precisa ser crescente dentro da
  conversa.
- **Alternatives**: `created_at` — empates em ms; contagem de mensagens —
  frágil se a definição de mensagem mudar.

## §3 — Regra do gatilho: função pura `planHistory`

- **Decision**: em `src/agents/history.ts`,
  `planHistory(unsummarized, { window: 8, batch: 8 })` →
  `{ toSummarize, recent }`:
  - `pending = unsummarized.length - window`;
  - `pending >= batch` → `toSummarize = unsummarized.slice(0, -window)` (todas
    as pendentes, mesmo que > 8 — conversa legada vira um resumo só) e
    `recent = unsummarized.slice(-window)`;
  - senão → `toSummarize = []` e `recent = unsummarized` (8 a 15 por extenso).
  Constantes exportadas: `RECENT_WINDOW = 8`, `SUMMARY_BATCH = 8`
  (substituem `HISTORY_LIMIT = 12`).
- **Rationale**: a decisão "resume ou não" fica isolada e testável em tabela,
  sem I/O (Princípio V). Como cada turno grava 2 mensagens, na prática o
  gatilho ocorre a cada 4 turnos.
- **Alternatives**: gatilho por tokens estimados — o usuário pediu
  explicitamente por contagem de mensagens.

## §4 — Resumidor: função injetável, texto livre

- **Decision**: `type Summarizer = (input: { previous?: string; messages:
  readonly HistoryMessage[] }) => Promise<string>` em
  `src/agents/summarizer.ts`. O real (`defaultSummarizer`) usa
  `createModel().invoke([system, user])` e devolve o `content` em texto, com
  prompt em português pedindo: mesclar o resumo anterior com as mensagens
  novas, ~150 tokens (~600 caracteres), três blocos curtos — **Decisões**,
  **Fatos**, **Pendências** — sem conversa fiada, nunca descartar decisão ou
  pendência ainda aberta do resumo anterior, marcar pendência resolvida como
  resolvida. Testes usam um resumidor falso determinístico
  (`createFakeSummarizer`, ex.: concatena `previous` + primeira palavra de cada
  mensagem e registra as chamadas).
- **Rationale**: mesmo padrão do `LearningExtractor` (specs/009): a lógica que
  decide e persiste é testada com fake; a qualidade do modelo real é avaliada
  manualmente. Texto livre (sem `withStructuredOutput`) porque o resultado é
  injetado como texto no prompt.
- **Alternatives**: saída estruturada `{ decisions[], facts[], pending[] }` —
  mais rígida e mais tokens de schema; poderia vir depois.

## §5 — Quando sumarizar: síncrono, dentro do turno, sob timeout e `trackUsage`

- **Decision**: novo Service `src/services/history-service.ts` com
  `loadConversationContext(conversationId, { conversations, summarizer, log })`
  → `{ summary?: string; recent: HistoryMessage[]; event?: SummarizeEvent }`.
  `runChat` passa a executar, dentro de `runWithTimeout(trackUsage(...))`:
  `loadConversationContext` → monta o prompt → `composed.run`. O evento, se
  houver, é **prefixado** ao `trace` devolvido.
- **Rationale**: a spec quer o resumo novo já valendo no turno que atinge o
  limiar e o evento na resposta desse turno; dentro de `trackUsage`, os tokens
  do resumidor entram no `promptTokens` (specs/011, Assumptions da spec);
  dentro do timeout, um resumidor travado não prende o request além do teto.
- **Alternatives**: em segundo plano após a resposta (como o `learn`) — menor
  latência, mas o evento não caberia na resposta e o turno seguinte poderia
  ver resumo desatualizado.

## §6 — Concorrência: gravação monotônica

- **Decision**: `saveSummary` faz upsert condicionado:
  `INSERT ... ON CONFLICT(conversation_id) DO UPDATE SET ... WHERE
  excluded.covered_until > conversation_summaries.covered_until`, e devolve
  `boolean` (gravou ou não). No mock, a mesma regra.
- **Rationale**: dois turnos simultâneos que leem o mesmo resumo e as mesmas
  pendentes geram resumos com o mesmo `coveredUntil`; o segundo é descartado
  (`=` não é `>`), logo nenhuma mensagem é absorvida duas vezes nem a cobertura
  retrocede (FR-009). O turno que perdeu ainda usa o seu resumo localmente, que
  é equivalente.
- **Alternatives**: transação com lock — `DatabaseSync` é síncrono num único
  processo, o upsert condicional já é atômico.

## §7 — Falha do resumidor

- **Decision**: erro ou texto vazio (após `trim`) → `loadConversationContext`
  loga só `error.name` (como `logLearningFailure`, specs/009), não grava, não
  emite evento, e devolve `summary` anterior + **todas** as `unsummarized` por
  extenso. `ConversationNotFoundError` continua propagando (vem do store, não
  do resumidor).
- **Rationale**: FR-007 / SC-004 — o turno nunca falha por causa do resumo; na
  próxima vez as pendentes continuam lá e o gatilho dispara de novo.

## §8 — Montagem do prompt: fatos → resumo → histórico → pergunta

- **Decision**: `formatQuestionWithHistory(history, question, summary?)` ganha
  o resumo opcional, emitido antes do histórico:
  `Resumo da conversa até aqui:\n<resumo>\n\n` + bloco de histórico atual.
  `withHistory(strategy, history, summary?)` repassa. A composição em `runChat`
  continua `withHistory(withMemory(strategy, facts), history, summary)`: o
  decorador de fora formata primeiro e o de dentro prefixa os fatos, então o
  texto final é `fatos + resumo + histórico + pergunta`.
  Função pura `formatSummaryBlock(summary?)` exportada para o detalhamento.
- **Correção de doc**: o JSDoc de `contextBreakdown` (specs/011) descreve a
  partição como `histórico + memória + pergunta`; a ordem real é
  `memória + histórico + pergunta` (os números não mudam — mesma soma).
  Ajustar o comentário junto.
- **Rationale**: nenhum decorador novo; a regra "fatos primeiro" (specs/008
  research §6) se mantém.

## §9 — Métricas e detalhamento

- **Decision**: `contextBreakdown(question, history, facts, summary?)` ganha a
  fatia `summary = estimateTokens(formatSummaryBlock(summary))` e `history`
  passa a estimar só o bloco de histórico (sem o resumo);
  `total = question + history + memory + summary`. `historyMessages` =
  `recent.length`.
- **Rationale**: FR-008 — resumo visível como fonte própria; SC-005 é
  observável pela fatia `summary`.

## §10 — Sem resumidor configurado

- **Decision**: `summarizer` é opcional em `ChatDeps`/`AppDeps`. Ausente →
  `loadConversationContext` nunca chama resumidor nem grava: usa o resumo
  guardado, se existir, mais só as `RECENT_WINDOW` mensagens mais recentes
  (pruning puro, sem evento). `index.ts` sempre injeta `defaultSummarizer`.
- **Rationale**: mantém os testes do Controller que não se importam com
  resumo simples e evita histórico ilimitado quando ninguém resume.

## §11 — Evento `summarize`

- **Decision**: `TraceEvent` ganha `{ type: "summarize"; content: string;
  messagesSummarized: number }` (`content` = texto do resumo novo). `trace.ts`
  ganha o rótulo `"Resumo"`; o formatador padrão (`[Rótulo] content`) já
  atende.
- **Rationale**: reaproveita `content` como os demais eventos; nenhum
  consumidor faz `switch` exaustivo além do `LABELS` tipado.

## §12 — Testes com fake

- `history.test.ts`: `planHistory` em tabela (0, 8, 15, 16, 17, 40
  mensagens); `formatQuestionWithHistory` com e sem resumo.
- `summarizer.test.ts`: `createFakeSummarizer` determinístico; prompt do real
  monta mensagens com `previous` e falas (sem rede, checando só os textos
  montados por uma função pura `summarizerMessages`).
- `history-service.test.ts`: limiar exato (15 → não chama, 16 → chama 1×);
  reutilização sem nova chamada; mescla recebe `previous`; persistência
  (`getSummary` após o turno; nova instância do store sobre o mesmo arquivo);
  falha e texto vazio → sem gravação e todas por extenso; conversa legada de
  40 mensagens → 1 chamada com 32 mensagens.
- Contract tests do store: `messagesSince`, `getSummary`, `saveSummary`
  monotônico, isolamento entre conversas, id desconhecido →
  `ConversationNotFoundError`.
- `chat-service.test.ts` / `server.test.ts`: evento `summarize` só no turno do
  gatilho e no início do trace; `contextBreakdown.summary`; ordem fatos →
  resumo → histórico → pergunta; SC-001 (20 turnos → chamadas nos turnos 9,
  13, 17 → no máximo uma a cada 4 turnos).

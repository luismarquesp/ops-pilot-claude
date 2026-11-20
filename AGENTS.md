# AGENTS.md

OpsPilot é o copiloto de plantão que gerencia alertas e incidentes de produção.
A API é um agente LangChain/LangGraph rodando sobre OpenRouter.

## Stack

- Node.js 22 LTS
- TypeScript ESM, `strict: true`
- zod na fronteira (HTTP/CLI) para validar entrada e saída
- `@huggingface/transformers` para embeddings locais (`Xenova/all-MiniLM-L6-v2`)
  da memória semântica — o modelo é baixado e cacheado no primeiro uso
- Testes: `node:test` via `tsx`
- Express como camada HTTP
- `node:sqlite` (`DatabaseSync`) como persistência — nativo do Node, sem
  dependência de terceiros. Arquivo em `OPSPILOT_DB` (default
  `./data/opspilot.db`); `:memory:` nos testes. `SqliteOpsStore`
  (`src/store/sqlite-ops-store.ts`) é o backend real; `MockOpsStore`
  (`src/store/mock-ops-store.ts`, em memória) é usado pelos testes e pelo
  `bench`. Ambos implementam a interface `OpsStore`
  (`src/store/ops-store.ts`).

## Comandos

Ver [package.json](./package.json) `scripts`:

- `npm run dev` — inicia a API
- `npm run arena` — roda o arena runner
- `npm run bench` — roda os benchmarks
- `npm run mcp` — inicia o servidor MCP `opspilot` (stdio, `src/mcp/server.ts`)
- `npm test` — roda os testes (`node:test`)
- `npm run typecheck` — checagem de tipos sem emitir arquivos
- `npm --prefix web run dev` — war room web (`web/`, specs/018); `test`/`typecheck`/`build` também

## Conversa persistente

- `POST /chat` aceita `conversationId` (UUID) opcional e sempre o devolve na
  resposta; sem id, uma conversa nova é criada. Id desconhecido → 404.
- `ConversationStore` (`src/store/conversation-store.ts`: `create`/`append`/`lastMessages`)
  — `SqliteConversationStore` (tabelas `conversations`/`messages`, mesmo arquivo
  `OPSPILOT_DB`) é o backend real; `createMockConversationStore` é o fake dos testes.
- O turno fica em `runChat` (`src/services/chat-service.ts`), que roda o grafo de
  produção (ver "Grafo de produção") dentro do timeout: o resumo da conversa
  (se houver) + as mensagens não resumidas (janela de 8, até 15 entre um resumo e
  outro — ver "Sumarização de histórico") entram no prompt via `buildContext` (ver
  "Orçamento de contexto"; formatadores em `src/agents/history.ts`), pergunta +
  resposta só são gravadas após sucesso, e `metrics.historyMessages` informa
  quantas mensagens entraram por extenso depois dos cortes.

## Memória semântica

- `POST /chat` aceita `userId` opcional (string, 1..128). Sem ele, nada muda.
- `MemoryStore` (`src/memory/memory-store.ts`: `remember`/`recall`/`forget`, sempre
  por `userId`) — `SqliteMemoryStore` grava na tabela `memories` (`id`, `user_id`,
  `fact`, `embedding` BLOB, `created_at`) do mesmo `OPSPILOT_DB`. `remember` não
  duplica (similaridade > 0.92), `recall` devolve top-3 por produto escalar com
  mínimo 0.3; funções puras em `src/memory/similarity.ts`.
- Embeddings: `createLocalEmbedder` (`src/memory/embeddings.ts`), `pooling: "mean"`
  + `normalize: true`, singleton preguiçoso (carrega só no primeiro uso).
  Testes usam `createFakeEmbedder`; o teste com o modelo real é pulado com
  `OPSPILOT_SKIP_MODEL_TESTS=1`.
- Com `userId`, `runChat` injeta o recall no prompt via `buildContext` (formatador
  em `src/memory/memory-prompt.ts`) e `metrics.memoryFacts` informa quantos fatos
  entraram depois dos cortes (listados sem id). O
  Controller recebe `strategiesFor(userId?)`, que acrescenta as tools de memória
  presas ao usuário.
- Refletor de aprendizado (specs/009): depois de gravar um turno bem-sucedido com
  `userId`, `runChat` dispara `learn` **sem await** — `learnFromMessage`
  (`src/memory/learning.ts`) lê só a mensagem do usuário com
  `withStructuredOutput({ hasLearning, fact })` e grava via `memory.remember`.
  Barreira dupla contra segredos com `containsSecret` (`src/memory/secrets.ts`):
  mensagem com segredo nem chega ao LLM, e fato proposto com segredo é descartado.
  Nunca rejeita; falhas são logadas só com o nome do erro. Qualidade do extrator
  real: `node --env-file-if-exists=.env --import tsx src/memory/learning-eval.ts`.
- API direta, sem LLM (specs/010; router `src/http/memory-routes.ts`, Service
  `src/services/memory-service.ts`; só montada quando há memória):
  `POST /memories` `{ userId, fact }` → 201 criado / 200 duplicado / 422
  `secret_detected` (mesma barreira `containsSecret`); `GET /memories?userId=` →
  `{ memories }` do mais recente ao mais antigo (`MemoryStore.list`);
  `DELETE /memories/:id?userId=` → 204, ou 404 `memory_not_found` igual para
  inexistente e alheio. `userIdSchema` (`src/http/schemas.ts`) e `factSchema`
  (`src/memory/memory-tools.ts`) são compartilhados com `/chat` e `remember_fact`.

## Medição de contexto

- specs/011. Funções puras em `src/context/tokens.ts`: `estimateTokens` (`ceil(chars/4)`),
  `usageFromLLMResult` (uso real do `LLMResult` do LangChain — `usage_metadata` da
  mensagem, senão `llmOutput.tokenUsage`) e `promptTokensOf` (soma, `null` sem uso).
- `src/context/usage-tracker.ts`: `trackUsage(fn)` abre um escopo por turno
  (`AsyncLocalStorage`); `createModel()` anexa um callback `handleLLMEnd` aguardado
  só quando há escopo, capturando o acumulador na criação. Modelos criados fora de
  `run()` não contam. Testes simulam chamadas com `recordUsage`.
- `runChat` roda a estratégia dentro de `trackUsage` e devolve em `metrics`:
  `promptTokens` (real, soma de todas as chamadas do turno, ou `null`) e
  `contextBreakdown` `{ question, history, memory, summary, total }` (estimado,
  `src/context/breakdown.ts`, sobre o texto que cada fonte acrescenta — sem
  instruções de sistema nem tools). O `learn` (specs/009) fica fora da contagem.
- `bash scripts/conversa-long.sh` (API rodando; `OPSPILOT_URL`, `TURNS`, `USER_ID`)
  imprime `promptTokens` por turno numa conversa longa; `n/d` quando nulo; coluna
  `resumo` com `*` nos turnos que geraram resumo.

## Sumarização de histórico

- specs/012. Tabela `conversation_summaries` (um resumo por conversa, `covered_until`
  = `messages.id` da última mensagem absorvida, `ON DELETE CASCADE`), criada pelo
  `SqliteConversationStore`; `ConversationStore` ganha `messagesSince`/`getSummary`/
  `saveSummary` (gravação monotônica: só substitui se `coveredUntil` avançar).
- Regra pura `planHistory` (`src/agents/history.ts`, `RECENT_WINDOW = 8`,
  `SUMMARY_BATCH = 8`): com 8+ mensagens não resumidas fora da janela, resume
  **todas** elas numa chamada, mescladas ao resumo anterior; senão nada é resumido
  e até 15 mensagens seguem por extenso. Nunca resume a cada request.
- `Summarizer` (`src/agents/summarizer.ts`: `SUMMARIZER_PROMPT`, `summarizerMessages`,
  `defaultSummarizer` sobre `createModel()`, ≤ 150 tokens em tópicos telegráficos);
  testes usam `createFakeSummarizer` (`src/agents/fake-summarizer.ts`).
- `loadConversationContext` (`src/services/history-service.ts`) roda dentro do
  timeout e do `trackUsage` do `runChat` (o resumidor conta em `promptTokens`, não em
  `llmCalls`). Falha ou texto vazio do resumidor não derruba o turno: loga só o nome
  do erro, não grava e mantém tudo por extenso. Sem `summarizer` nas deps → resumo
  guardado + 8 mais recentes.
- Prompt: fatos → `Resumo da conversa até aqui:` → histórico → pergunta. O turno que
  grava um resumo novo abre o `trace` com `{ type: "summarize", content,
  messagesSummarized }`.

## Orçamento de contexto

- specs/013. `buildContext` (`src/context/context-builder.ts`, função pura) monta o
  prompt do turno para **todas** as estratégias: seções (`fitToBudget` por seção) →
  fatos → resumo → histórico → pergunta; `runChat` chama
  `strategy.run({ question: built.prompt })`. Abaixo dos tetos o prompt é idêntico
  ao de antes.
- Tetos em tokens estimados (`ceil(chars/4)`) do bloco inteiro, cabeçalho incluído:
  resumo 200 (corta linhas do fim; sem linha que caiba, corte seco), janela 1200
  (corta as mensagens mais antigas, inteiras), memória 300 (corta o menor `score`;
  empate → o último). Pergunta e instruções de sistema nunca são cortadas; seções
  não emprestam sobra; o resumo persistido e o gatilho do specs/012 não mudam.
- `CONTEXT_BUDGET_SUMMARY`/`CONTEXT_BUDGET_WINDOW`/`CONTEXT_BUDGET_MEMORY` lidos
  em `src/index.ts` por `parseContextBudget` (zod, inteiro ≥ 0): vazio → padrão,
  inválido → padrão + aviso só com o nome da variável. Chega ao `runChat` por
  `AppDeps.contextBudget` → `ChatDeps.budget`.
- `metrics.contextTrimmed` `{ historyMessages, memoryFacts, summaryTruncated }`;
  `contextBreakdown` passa a medir o conteúdo mantido. `conversa-long.sh` ganha a
  coluna `cortes`.

## Grafo de produção

- specs/014. `createProductionGraph` (`src/graph/production-graph.ts`, `StateGraph`
  montado por turno): `contexto` → `roteador` → `react` | `plan-and-execute` |
  `reflection` → `resposta`. `contexto` = `loadConversationContext` + `buildContext`
  (prompt igual ao de antes); `resposta` só consolida, não emite eventos. Nós não
  podem ter o nome de um canal do estado.
- Roteador (`src/agents/router.ts`): `ROUTE_TABLE` é a fonte única das rotas — gera a
  tabela do prompt (`routerSystemPrompt`) e o enum de `withStructuredOutput({ route,
  reason })`; a saída é revalidada por `parseRouteDecision`. Falha, saída inválida ou
  rota indisponível → `react` com `source: "fallback"` (log só com o nome do erro);
  sem `router` nas deps → fallback sem chamada. Conta em `llmCalls`/`promptTokens`.
  Testes usam `createFakeRouter` (`src/agents/fake-router.ts`).
- `routeStrategies` (`src/agents/routes.ts`): `reflection` = `react` base + reflexão;
  `reflect: true` embrulha `react`/`plan-and-execute`, nunca a `reflection` de novo.
- `POST /chat` `strategy` é opcional: ausente → o roteador decide; presente →
  override (sem chamar o roteador, `source: "override"`); fora das rotas → 422
  `unknown_strategy` com `available`.
- Rastro: exatamente um evento `{ type: "route", route, reason, source }` por turno
  (depois do `summarize`, antes da estratégia) e `node` em todo evento (`contexto`,
  `roteador` ou o nome da rota) — `GraphTraceEvent`/`tagTrace`. As estratégias não
  conhecem o grafo; `arena` e `bench` continuam chamando-as direto.
- Qualidade do roteador real (meta ≥ 80%):
  `node --env-file-if-exists=.env --import tsx src/agents/router-eval.ts`.
- `conversa-long.sh` ganha a coluna `rota`.

## Resiliência de modelo

- specs/015. `createModel(build?, chain?)` (`src/agents/model.ts`) devolve um modelo
  resiliente: `build` compõe cada modelo da cadeia (`(m) => m.withStructuredOutput(s)`,
  `(m) => m.bindTools(tools)`) antes da resiliência. `parseModelChain` (pura): principal
  `OPEN_ROUTER_MODEL` + reservas `OPENROUTER_MODEL_FALLBACK` (vírgula; trim, sem vazios,
  repetidos ou o principal). `ChatOpenAI` com `maxRetries: 0` — quem reinsiste é o
  `withRetry({ stopAfterAttempt: 2 })` de cada modelo; reservas via `withFallbacks`.
- Núcleo em `src/agents/resilience.ts` (`withResilience`, `summarizeAttempts`,
  `logModelFallback` só com ids + nome do erro), testável sem rede. Falha total →
  `ModelUnavailableError` (`src/services/errors.ts`) → `/chat` responde 503
  `{ error: "model_unavailable", modelsTried }` sem gravar nem disparar o `learn`.
  Roteador, crítico, resumidor e aprendizado continuam tolerantes (sem 503).
- ReAct usa `llm` dinâmico (`() => createModel((m) => m.bindTools(tools))`): o modo
  estático do `createReactAgent` exige `bindTools`, que o modelo resiliente não tem.
- Por turno (`src/agents/model-calls.ts`, `trackModelCalls` no `runChat`): cada nó do grafo
  vira as trocas de modelo em eventos `{ type: "fallback", from, to, reason }` com `node`,
  no início dos seus eventos; `resposta` deduplica por par `from → to`.
  `metrics.modelUsed` = modelo da última chamada da estratégia (`null` sem chamada).
  Tentativas e reservas também contam no `promptTokens`.

## Rastro persistido e logs

- specs/016. Middleware `requestContext` (`src/obs/request-context.ts`), montado em
  `/chat` **antes** do `express.json()`: gera o `requestId` (UUID, o `X-Request-Id` do
  cliente é ignorado), escreve o cabeçalho `X-Request-Id` e todo corpo do `/chat` —
  erros e o 500 da rede de segurança inclusive — ganha `requestId` (`withRequestId`).
- `RequestStore` (`src/store/request-store.ts`: `save`/`get`) — `SqliteRequestStore`
  cria `requests` (colunas planas `outcome`, `model_used`, `prompt_tokens`,
  `latency_ms` + `metrics_json` completo) e `trace_events` (`seq`, `type`, `node`,
  `payload` = evento inteiro, `ON DELETE CASCADE`) no mesmo `OPSPILOT_DB`; `save` é uma
  transação. `createMockRequestStore({ failOnSave })` é o fake dos testes.
- O Controller grava via `recordRequest` (`src/services/request-service.ts`, montagem
  pura em `buildRequestRecord`/`routeOf`) **antes** de responder: 200 com rastro;
  404/503/504/500 sem métricas nem rastro; 400/422 não são gravados. Falha ao gravar
  não muda a resposta — só loga `request.persist.failed` com o nome do erro.
- `GET /requests/:id` (`src/http/request-routes.ts`, só montado com `AppDeps.requests`)
  → `{ request, trace }`, `trace` igual ao do `/chat`; não-UUID → 400; inexistente →
  404 `request_not_found`.
- Logger (`src/obs/logger.ts`, `createLogger({ sink, clock })`, `silentLogger` padrão
  do `createApp`): 1 linha JSON por acontecimento, campos só escalares/listas de
  strings. Eventos `chat.request.start`/`chat.trace.event`/`chat.request.end`,
  `model.unavailable`, `request.persist.failed`, `http.unexpected_error`; campos de
  rastro por lista permitida (`src/obs/log-fields.ts`) — nunca conteúdo, `args`,
  `reason` do roteador nem mensagem/stack de erro.
- `conversa-long.sh` ganha a coluna `req`.

## Estatísticas

- specs/017. `GET /stats?since=24h` (`src/http/stats-routes.ts`, montado junto com o
  `/requests`): `since` = `<n>m|h|d`, n ≥ 1, até 30d (zod `sinceSchema`; inválido → 400
  `{ issues }`); janela `[now - since, now]` por `startedAt`.
- Resposta `{ since, from, to, total, errors, errorRate, cost: { usd, unpriced },
  latencyMs: { p50, p95 }, byRoute, byModel }`; os grupos trazem o mesmo bloco, ordem
  `total` desc → chave, `null` (turnos de erro) por último. Percentis por posto mais
  próximo sobre `durationMs`, erros inclusive.
- Agregação pura em `src/services/stats-service.ts` (`computeStats`, `percentile`,
  `windowMs`) sobre `RequestStore.listSince(from)` (só colunas planas; índice
  `requests_started_at`).
- Custo estimado só sobre `promptTokens`, atribuído ao `modelUsed`
  (`src/services/pricing.ts`): `:free` e `openrouter/free` → 0; preço de `MODEL_PRICES`
  (`id=usdPor1M,...`, lido em `src/index.ts` por `parseModelPrices`, inválido → aviso só
  com o nome da variável) → `tokens × preço / 1e6`; sem preço ou sem tokens → conta em
  `cost.unpriced`, fora da soma.

## Aprovação de ações sensíveis

- specs/018. `open_incident`/`resolve_incident` (`SENSITIVE_TOOLS`, `src/agents/approvals.ts`, funções
  puras) passam pelo portão `withApprovalGate` (`src/agents/approval-gate.ts`), aplicado em
  `createStrategyRegistry`. Só dentro de `trackApprovals` (`AsyncLocalStorage`, aberto pelo `runTurn`
  quando há `ApprovalStore`) a tool não executa: registra a pendência e devolve
  `APPROVAL_PENDING_OBSERVATION`. Fora do escopo (arena, bench, MCP, `/chat` sem `approvals`) executa direto.
- `runTurn` (`src/services/chat-service.ts`) → `ChatResult | PendingApprovalResult`; `runChat` segue igual
  (sem aprovação). Na pausa: cria a conversa se preciso, grava a `Approval` (TTL 15 min), não grava
  mensagens nem dispara o `learn`; o grafo corta o rastro no evento `approval`.
- `ApprovalStore` (`src/store/approval-store.ts`) — `SqliteApprovalStore` cria `approvals` no mesmo
  `OPSPILOT_DB`; expiração preguiçosa e decisão por `UPDATE` condicional (só uma vence);
  `createMockApprovalStore` é o fake. Erros `ApprovalNotFoundError`/`ApprovalAlreadyDecidedError`/
  `ApprovalExpiredError` → 404/409/410.
- Retomada por replay (`src/services/approval-service.ts`): `decideApproval` decide e, se aprovou, executa
  **uma vez** via `ops-actions`; `resumeTurn` roda o turno de novo na rota guardada (`source: "resume"`)
  com o livro do turno — o portão responde do livro e `ledgerPromptSection` entra no `buildContext`
  (`decisions`, nunca cortada). Outra ação sensível pausa de novo (202 encadeado, mesmo `turnId`).
- HTTP: `POST /chat` → 202 `{ conversationId, status: "approval_required", approval, trace, metrics }`;
  `POST /chat/approvals/:id` `{ decision: "approve"|"deny" }` → 200/202/400/404/409/410;
  `GET /chat/approvals?conversationId=` → pendentes (recuperar o cartão ao recarregar). Rotas em
  `src/http/approval-routes.ts`, sob o `requestContext`; só montadas com `AppDeps.approvals` + `ops`.
- Rastro: `{ type: "approval", approvalId, tool, args, summary }` e `{ type: "decision", approvalId,
  decision, result? }` (`node: "contexto"`); logs só `approvalId` + `tool`/`decision`. O 202 é gravado em
  `requests` com `status 202`, `outcome "ok"`.

## CORS e /health

- specs/018. `src/http/cors.ts` (`corsHeaders`/`parseCorsOrigins` puras + `corsMiddleware`), montado antes
  de tudo: só as origens de `CORS_ORIGINS` (lista exata, vírgula; inválidas ignoradas com aviso só com o
  nome da variável), expõe `X-Request-Id`, preflight 204; nunca `*` nem credentials. Vazio → nenhuma.
- `GET /health` → `{ status: "ok" }`, sem `requestId` (usado pelo "Testar conexão" da war room).

## War room web

- specs/018. Pacote isolado em `web/` (Vite + React 18 + TS `strict`, `base: "/opspilot/"`), regras de
  design em `.github/instructions/design.instructions.md` (`applyTo: "web/**"`). Comandos:
  `npm --prefix web run dev|build|preview|test|typecheck` — o `npm test`/`typecheck` da raiz não cobrem a web.
- Toda resposta da API passa por zod (`web/src/api/schemas.ts`, rastro como união discriminada + ramo
  genérico para tipos novos); cliente em `web/src/api/client.ts` (nunca lança; `testConnection` distingue
  inacessível de CORS); estado no reducer puro `web/src/state/chat.ts`.
- Testes com Vitest + Testing Library + axe (desvio do `node:test` justificado no plan). Contraste AA dos
  tokens nos dois temas em `web/src/styles/contrast.test.ts`. Fixtures de contrato geradas pela API:
  `OPSPILOT_WRITE_FIXTURES=1 npx tsx --test src/http/fixtures.export.test.ts`.
- No navegador só `opspilot.apiUrl`, `opspilot.theme` e `opspilot.conversationId` (nunca conteúdo).
- Fixtures com relógio fixo (`expiresAt` 12:15Z): testes que renderizam o cartão usam `freshFixture`
  (`web/src/test/http.ts`), que traz `createdAt`/`expiresAt` para agora.
- specs/019. Publicação no GitHub Pages por `.github/workflows/pages.yml` (push em `main` tocando `web/**`
  ou o workflow, e manual): `build` só com `contents: read` + `pages: read` (npm ci → typecheck → test →
  build → `upload-pages-artifact`), `deploy` só com `pages: write` + `id-token: write` (`deploy-pages`);
  `concurrency: pages` sem cancelar. Base via `OPSPILOT_WEB_BASE` (`resolveBuildConfig`,
  `web/src/build-config.ts`, pura/zod, padrão `/opspilot/`; o workflow passa o `base_path` do Pages);
  endereço da API pela variável de repositório `OPSPILOT_API_URL`; o build emite `404.html` = `index.html`.
  Contrato verificado por `web/src/deploy.test.ts`.

## Tools do agente

Sobre o `OpsStore` (ver `src/agents/tools.ts`):

- `list_alerts` — alertas de monitoramento (`firing`/`resolved`/`all`, default `firing`)
- `list_incidents` — incidentes abertos pelo time (`open`/`resolved`/`all`, default `open`)
- `open_incident` — abre um incidente novo para um serviço
- `resolve_incident` — marca um incidente como resolvido
  (no `/chat`, `open_incident` e `resolve_incident` pedem aprovação antes — ver "Aprovação de ações sensíveis")
- `consultar_runbook` — procedimento de remediação cadastrado para um serviço

Só quando o `/chat` recebe `userId` (sobre o `MemoryStore`, `src/memory/memory-tools.ts`;
o `userId` fica na closure, nunca é argumento da tool):

- `remember_fact` — guarda um fato duradouro sobre o plantonista
- `forget_preference` — esquece o fato do usuário mais parecido com uma descrição em
  linguagem natural (similaridade ≥ 0.3) e devolve o texto removido

`list_alerts`, `open_incident` e `resolve_incident` também são expostas via MCP
(`npm run mcp`, stdio, servidor `opspilot` em `src/mcp/server.ts`), reaproveitando
os mesmos schemas zod e o mesmo `OpsStore` através de `src/agents/ops-actions.ts`
— nenhuma validação ou lógica de negócio duplicada entre os dois transportes.

## Convenções

- Camadas padrão MVC (Model, Service, Controller) — `OpsStore`/`SqliteOpsStore`/`MockOpsStore` são o Model
- Toda entrada externa é validada com zod
- Erros de domínio são classes, traduzidas na borda
- Lógica nova nasce com teste
- `npm run typecheck` e `npm test` sempre verdes antes de qualquer commit
- Nunca commitar e nunca ler `.env`
- Sempre utilize funções puras

## Fluxo

- Seguir o fluxo do Spec Kit: `/speckit.specify` → `/speckit.plan` → `/speckit.task` → `/speckit.implement`.
- Specs devem ser versionadas.
- Permissões do agente (allow/deny) estão configuradas em [.claude/settings.json](./.claude/settings.json).

# Research: Rastro persistido + logs estruturados

Sem `NEEDS CLARIFICATION` no Technical Context. As decisões abaixo saem da
leitura de `src/http/server.ts`, `src/services/chat-service.ts`,
`src/graph/production-graph.ts` e `src/store/sqlite-conversation-store.ts`.

## §1 Onde nasce o `requestId`: middleware antes do `express.json()`

- **Decision**: `app.use("/chat", requestContext({ logger, newId, clock }))`,
  registrado antes de `app.use(express.json())`. Ele:
  - gera o id;
  - grava em `res.locals.requestId`;
  - faz `res.setHeader("X-Request-Id", id)`;
  - loga `chat.request.start`;
  - registra `res.on("finish")` para logar `chat.request.end`.

  `withRequestId(body, id)` (pura) acrescenta `requestId` a cada corpo do
  `/chat`. A rede de segurança usa `requestIdOf(res)` para incluir o id no 500
  quando ele existe.
- **Rationale**: JSON malformado é rejeitado pelo `express.json()` antes de
  qualquer handler, e mesmo assim precisa receber id e log (Edge Cases). O
  cabeçalho fica escrito antes de qualquer `res.json`, então FR-002 vale para
  todo caminho, inclusive o 500.
- **Alternatives considered**:
  - Gerar o id dentro do handler: perde o JSON malformado.
  - Honrar o `X-Request-Id` do cliente: fora de escopo (FR-003), com risco de
    colisão e de injeção em log.

## §2 Quando gravar: antes do `res.json`, síncrono, com falha engolida

- **Decision**: o Controller chama
  `recordRequest({ requests, logger }, input)` depois de `runChat` (sucesso)
  ou no `catch` dos erros de turno, e só depois responde. `recordRequest`
  embrulha `requests.save` em `try/catch`; na falha, loga
  `request.persist.failed { requestId, errorName }` e segue (FR-007). O 500
  inesperado também é gravado, com `errorCode: "internal_error"`, antes do
  `throw` para a rede de segurança.
- **Rationale**: com `DatabaseSync`, a gravação é síncrona e leva
  microssegundos. Gravar antes da resposta garante que um `GET /requests/:id`
  feito logo após o `/chat` encontre o registro (SC-002). Gravar em
  `finish` abriria uma corrida.
- **Alternatives considered**:
  - Gravar em `res.on("finish")`: corrida com o GET.
  - Gravar dentro do `runChat`: misturaria observabilidade no Service do
    turno e não veria os erros de borda (404, 503, 504).

## §3 O que gravar: 400/422 não; erro de turno sem rastro

- **Decision**: só turnos que passaram da validação e do check de estratégia
  viram registro. Turnos com erro (404, 503, 504 e 500) ficam com
  `metrics = null` e rastro vazio: o `runChat` não devolve rastro parcial na
  falha.
- **Rationale**: segue a spec (Edge Cases e US2 §2). Expor rastro parcial
  exigiria mudar o grafo, o que está fora de escopo.

## §4 Transação e esquema

- **Decision**:
  - `SqliteRequestStore.save(record, trace)` faz
    `BEGIN` → `INSERT requests` → `INSERT trace_events` (um por evento, com
    `seq` = índice) → `COMMIT`, com `ROLLBACK` no `catch` e relançando
    (FR-006);
  - `payload` guarda `JSON.stringify(event)` do evento inteiro (com `node`);
  - `type` e `node` também viram colunas, para consulta;
  - `metrics` vai como JSON (`metrics_json`), porque o formato de
    `ChatMetrics` evolui a cada spec e uma coluna por métrica ficaria
    desatualizada.
- **Rationale**: `node:sqlite` não tem helper de transação. `BEGIN`/`COMMIT`
  explícitos são o padrão documentado. Guardar o evento inteiro faz o `GET`
  devolver exatamente o mesmo rastro (FR-009) sem mapear tipo a tipo.
- **Alternatives considered**:
  - Uma coluna JSON com o rastro inteiro em `requests`: contraria o pedido
    (`trace_events`) e impede consultar por `type` ou `node`.

## §5 Formato do `GET /requests/:id`

- **Decision**: a resposta é
  `{ request: { id, startedAt, durationMs, status, errorCode, conversationId, userId, route, routeSource, metrics }, trace: GraphTraceEvent[] }`,
  com `trace` em ordem crescente de `seq`. A posição é o índice do array, e
  cada evento é o payload original (com `node`).
- **Rationale**: igualdade direta com o `trace` do `/chat`
  (`deepEqual`, SC-002), sem campos extras para remover.

## §6 Logger: destino injetável e campos só escalares

- **Decision**: `createLogger({ sink = (line) => process.stdout.write(line + "\n"), clock = () => new Date() })`
  devolve `{ info, warn, error }(event, fields)`.
  - `formatLogLine({ time, level, event, ...fields })` é pura
    (`JSON.stringify`) e nunca lança. `JSON.stringify` não emite quebra de
    linha crua, então cada chamada vira exatamente uma linha.
  - O tipo `LogFields = Record<string, string | number | boolean | null | readonly string[] | undefined>`
    impede passar objetos (conteúdo) em tempo de compilação. Campos
    `undefined` são omitidos.
  - `silentLogger` é o padrão do `createApp` quando `AppDeps.logger` não vem,
    para os testes antigos não poluírem a saída. O `index.ts` injeta
    `createLogger()`.
- **Rationale**: atende a FR-011, FR-013 e FR-015 sem dependência nova
  (pino etc.).

## §7 Campos permitidos por evento do rastro

- **Decision**: `traceEventLogFields(event, seq, requestId)` copia só:
  - `type`, `node` e `seq`;
  - `tool` (em `action`);
  - `route` e `source` (em `route`);
  - `from`, `to` e `reason` (em `fallback`: `reason` já é só o nome do erro,
    specs/015);
  - `messagesSummarized` (em `summarize`);
  - `steps`, só a contagem (em `plan`).

  Nunca entram `content`, `args`, o `reason` do roteador (texto do LLM) nem a
  lista de passos.
- **Rationale**: lista permitida em vez de lista negada. Um tipo de evento
  novo no futuro sai só com `type`, `node` e `seq`, sem vazar conteúdo
  (FR-013, SC-004).

## §8 Logs de texto livre que mudam

- **Decision**:
  - o `console.warn("[model] indisponível: ...")` vira
    `logger.warn("model.unavailable", { requestId, modelsTried })`;
  - o `console.error(err)` da rede de segurança vira
    `logger.error("http.unexpected_error", { requestId, errorName })`. O stack
    e a mensagem deixam de ir para o log (FR-013).

  Os logs de `index.ts`, `resilience.ts`, `router.ts`, `summarizer.ts` e
  `learning.ts` ficam como estão. Já carregam só nomes de erro e estão fora
  do caminho HTTP, como diz a spec.
- **Trade-off**: perder o stack do 500 dificulta depurar defeitos de
  programação. Mitigação: o registro persistido marca `internal_error`, e o
  defeito se reproduz localmente. Logar o stack pode ser uma spec futura, com
  um nível `debug` opcional.

# Research: Grafo Unificado de Produção com Roteador

Sem `NEEDS CLARIFICATION` no Technical Context; as decisões abaixo fixam os
pontos em aberto da spec e os riscos de integração.

## §1 Grafo LangGraph construído por turno

- **Decision**: `src/graph/production-graph.ts` exporta
  `createProductionGraph(deps)`, que monta um `StateGraph` com os nós
  `contexto` → `roteador` → (`react` | `plan-and-execute` | `reflection`) →
  `resposta` e o compila. `runChat` cria o grafo a cada turno.
- **Rationale**: as estratégias já são por turno (`strategiesFor(userId)` prende
  as tools de memória ao usuário; `reflect` muda o embrulho). Compilar um grafo
  de 6 nós é desprezível frente a uma chamada ao modelo, e o
  `plan-and-execute` já usa `StateGraph` do mesmo pacote.
- **Alternatives considered**: grafo compilado uma vez com as estratégias via
  `config.configurable` (mais indireção e tipagem fraca, sem ganho mensurável);
  um `switch` simples em `runChat` sem LangGraph (não atende ao pedido de nós
  explícitos nem deixa o fluxo legível como grafo).

## §2 Nomes de nós x canais de estado

- **Decision**: os nós se chamam exatamente `contexto`, `roteador`, `react`,
  `plan-and-execute`, `reflection` e `resposta`, que é o mesmo valor do campo
  `node` dos eventos. Os canais do estado usam outros nomes (`input`,
  `prepared`, `decision`, `result`, `trace`, `llmCalls`, `final`).
- **Rationale**: o LangGraph recusa nó com o mesmo nome de um canal do estado
  (por exemplo, nó `resposta` e canal `resposta`). Manter nome de nó = valor de
  `node` evita uma tabela de tradução.
- **Alternatives considered**: prefixar os nós (`node_context`), que obrigaria a
  traduzir para o `node` do rastro.

## §3 Roteador com saída estruturada e dublê

- **Decision**: `Router = (input: { prompt: string; routes: readonly RouteSpec[] })
  => Promise<unknown>` (a saída é sempre revalidada, §5). Em `src/agents/router.ts`:
  - `ROUTE_TABLE`: as três `RouteSpec` (`name`, `when`), fonte única;
  - `routerSystemPrompt(routes)` (pura): instruções + tabela Markdown
    `| rota | quando usar |` gerada das `routes`;
  - `routeDecisionSchema(routes)` (pura): `z.object({ route: z.enum(names),
    reason: z.string().min(1) })`;
  - `defaultRouter`: `createModel().withStructuredOutput(routeDecisionSchema(routes))`;
  - `logRouteFailure(error)`: loga só `error.name`.
  Os testes injetam `createFakeRouter` (`src/agents/fake-router.ts`).
- **Rationale**: mesmo padrão do crítico (specs/002), do extrator (specs/009) e
  do resumidor (specs/012). Tabela e enum vêm da mesma lista, o que atende ao
  FR-004.
- **Alternatives considered**: classificar por palavra-chave sem LLM (frágil e
  não atende ao pedido); texto livre com parse manual (atrito com FR-003).

## §4 O que o roteador lê

- **Decision**: o roteador recebe `built.prompt` (o prompt já montado pelo
  `buildContext`: fatos, resumo, histórico e pergunta), não só a mensagem crua.
- **Rationale**: perguntas de continuação ("agora faz isso para cada um") só
  podem ser roteadas com o histórico. O orçamento do specs/013 já limita o
  tamanho.
- **Alternatives considered**: só a mensagem (mais barata, mas erra
  continuações).

## §5 Validação da decisão e fallback

- **Decision**: o nó `roteador` revalida a saída com `routeDecisionSchema(available)`
  (função pura `parseRouteDecision`). Exceção, saída inválida ou rota fora das
  disponíveis levam a `{ route: "react", reason: "Roteador indisponível
  (<NomeDoErro>); seguindo com react.", source: "fallback" }` e a
  `logRouteFailure`. Sem `router` nas deps, o resultado também é `fallback`
  com `reason: "Roteador não configurado; seguindo com react."`, sem log.
- **Rationale**: o FR-009 pede que o turno nunca caia; o `withStructuredOutput`
  de alguns modelos do OpenRouter pode devolver objeto incompleto. A mensagem
  do erro pode ecoar o conteúdo do usuário, então só o nome é logado.
- **Alternatives considered**: propagar o erro com 502 (viola FR-009).

## §6 Override e reflexão

- **Decision**: a função pura `routeStrategies(registry, { reflect,
  reflectionOptions })` (`src/agents/routes.ts`) devolve
  `Partial<Record<Route, ReasoningStrategy>>`:
  - `react` e `plan-and-execute` vêm do registry (quando presentes);
  - `reflection = withReflection(registry.react)` quando há `react`;
  - com `reflect: true`, `react` e `plan-and-execute` passam por `withReflection`.
    `reflection` nunca é embrulhada de novo (FR-012).
  As rotas disponíveis são as chaves desse mapa, na ordem de `ROUTE_TABLE`. O
  Controller valida `strategy` contra elas (422 `unknown_strategy` com
  `available`) e passa `override` ao `runChat`. Com override, o nó `roteador`
  não chama o modelo e registra `source: "override"` com
  `reason: "Estratégia definida na requisição."`.
- **Rationale**: preserva o contrato atual de `strategy`/`reflect` (SC-005), e o
  `reflectionOptions` injetável dos testes continua chegando ao
  `withReflection`.
- **Alternatives considered**: tirar `reflect` do contrato (quebra clientes).

## §7 `node` no rastro

- **Decision**: `TraceEvent` (das estratégias) não muda. É criado um tipo novo
  `GraphTraceEvent = (TraceEvent | RouteEvent) & { node: NodeName }`, em que
  `RouteEvent = { type: "route"; route; reason; source }`. A função pura
  `tagTrace(trace, node)` marca os eventos que cada nó produz. `ChatResult.trace`
  passa a ser `readonly GraphTraceEvent[]`. `formatTrace` ganha o rótulo
  `Rota` e aceita os dois tipos.
- **Rationale**: as estratégias continuam sem saber do grafo (o arena e o
  bench seguem iguais), e o campo `node` vira obrigatório só onde o grafo
  existe.
- **Alternatives considered**: `node?` opcional em `TraceEvent` (não garante o
  FR-010 pelo tipo).

## §8 Métricas, timeout e uso de tokens

- **Decision**: o grafo roda inteiro dentro do `runWithTimeout(trackUsage(...))`
  já existente. O canal `llmCalls` soma o do roteador (1 quando o modelo do
  roteador foi chamado, mesmo se falhou depois; 0 em override ou sem router)
  e o da estratégia. `promptTokens` já captura o roteador porque o modelo é
  criado dentro do escopo. Recall de memória, persistência e `learn` ficam em
  `runChat`, fora do grafo, como hoje.
- **Rationale**: o `AsyncLocalStorage` se propaga pelas promises dos nós. O
  `plan-and-execute` já roda um `StateGraph` dentro de `trackUsage` e tem o uso
  contado (specs/011). Gravar só após sucesso continua no Service (FR-013).
- **Alternatives considered**: persistência dentro do nó `resposta` (ficaria sob
  o timeout e misturaria Model com orquestração).

## §9 Erros de domínio atravessando o grafo

- **Decision**: o nó `contexto` chama `loadConversationContext`, que pode
  lançar `ConversationNotFoundError`. Um teste garante que `runChat` rejeita
  com a mesma classe (instanceof). Se o LangGraph embrulhar a exceção, o
  `runChat` desembrulha pela `cause`.
- **Rationale**: o Controller traduz por classe (Princípio IV); o 404 não pode
  virar 500.

## §10 Avaliação do roteador real (SC-004)

- **Decision**: `src/agents/router-eval.ts`, fora do `npm test`
  (`node --env-file-if-exists=.env --import tsx src/agents/router-eval.ts`),
  com perguntas de referência por rota, meta ≥ 80% de acerto e exit 1 se não
  bater. Usa a mesma pausa configurável do `learning-eval`.
- **Rationale**: mesmo padrão do specs/009; o teste automatizado usa dublê.

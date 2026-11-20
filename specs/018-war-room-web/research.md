# Research: War room web

Este documento cobre só as decisões que o spec deixou em aberto.

## §1 Como pausar o turno antes de uma ação sensível

**Decision**: o turno é pausado por um portão nas tools sensíveis e retomado
por replay com um livro de decisões. Não usamos `interrupt()` com
checkpointer do LangGraph.

**Pausa**:

- `withApprovalGate(tool)` embrulha `open_incident` e `resolve_incident` na
  montagem do registry.
- Dentro do escopo de turno, `trackApprovals`, um `AsyncLocalStorage` no
  mesmo padrão do `trackUsage`/`trackModelCalls`, o portão não executa a
  ação. Ele registra a chamada (`tool` + `args`) como pendente no escopo e
  devolve ao agente a observação fixa `APPROVAL_PENDING_OBSERVATION`: "ação
  aguardando aprovação do plantonista; não execute outras ações sensíveis,
  encerre o turno".
- Ao fim do grafo, o `runChat` olha o escopo. Se há pendência, a resposta do
  LLM é descartada e o turno vira `PendingApproval`, com o rastro até o
  evento de pausa. O Controller responde 202.

**Retomada**:

- `POST /chat/approvals/:id` grava a decisão de forma atômica.
- Se aprovada, a ação é executada uma vez, via `ops-actions`, e o resultado
  é guardado na aprovação.
- Depois o turno roda de novo com:
  - a mesma pergunta, conversa, usuário, rota (override) e `reflect`;
  - o **livro**: todas as decisões já tomadas naquele turno.
- O portão consulta o livro pela chave canônica `callKey(tool, args)`:
  - **aprovada**: devolve o resultado guardado, sem executar de novo;
  - **negada ou expirada**: devolve "negado pelo plantonista; não executado".
- O livro também entra no prompt (seção `Decisões do plantonista neste
  turno:` do `buildContext`), para o LLM concluir sem tentar de novo.
- Se o agente propuser outra ação sensível ainda não decidida, o turno pausa
  de novo e o encadeamento segue (edge case "mais de uma ação").

**Rationale**:

- O `ToolNode` do `createReactAgent` engole exceções de tool
  (`handleToolErrors = true`), menos `GraphInterrupt`. Lançar um erro próprio
  viraria observação, e o turno seguiria como se nada tivesse acontecido.
- `interrupt()` exige checkpointer persistente. O de SQLite do LangGraph
  depende de `better-sqlite3`, que a constitution proíbe. Ele também teria de
  atravessar três estratégias com grafos próprios, inclusive os subgrafos do
  `plan-and-execute` e do `reflection`.
- O replay mantém as estratégias intactas: elas continuam não conhecendo o
  grafo nem a aprovação, e `arena`/`bench`/MCP não mudam.
- "Executa exatamente uma vez" vem do banco, não do LLM:
  `UPDATE ... WHERE status='pending'` com `changes = 1`, e o resultado fica
  guardado.

**Trade-offs aceitos**:

- O replay refaz as chamadas ao modelo do turno. Isso custa tokens, e o LLM
  pode responder com outras palavras. O efeito em produção não muda, porque a
  ação aprovada nunca roda duas vezes.
- O resultado guardado é devolvido como observação mesmo que o LLM varie a
  frase. Se ele chamar a mesma tool com outros `args`, a chamada é tratada
  como ação nova e pausa de novo, o que é seguro.

**Alternatives considered**:

- Checkpointer em memória com `interrupt()`: não sobrevive a reinício
  (FR-013c).
- Checkpointer próprio sobre `node:sqlite` (`BaseCheckpointSaver`): grande, e
  acopla as estratégias ao grafo de produção.
- Abortar a estratégia com `AbortSignal` no momento da pausa: as estratégias
  não recebem `signal` hoje. Fica como otimização futura: a observação fixa
  já faz o agente encerrar, e os eventos depois da pausa são cortados do
  rastro.
- Aprovar só no MCP ou por flag de env: não atende a war room.

## §2 Escopo do portão

**Decision**:

- `SENSITIVE_TOOLS = ["open_incident", "resolve_incident"]`, uma lista
  única, pura, em `src/agents/approvals.ts`.
- O portão só age quando há escopo `trackApprovals`. Só o `runChat` abre
  esse escopo.
- Sem escopo, a tool executa direto, como hoje. Isso vale para `arena`,
  `bench` e testes de estratégia. O MCP usa `ops-actions` direto, sem tool.

**Rationale**: cumpre FR-013f ("outros canais não mudam") sem um flag novo.

## §3 Estados, expiração e concorrência

**Decision**:

- `approvals.status ∈ pending | approved | denied | expired`.
- A expiração é **preguiçosa**:
  - `expires_at = created_at + 15 min`;
  - a decisão, a listagem e a leitura marcam `expired` quando `now >=
    expires_at`;
  - não há timer.
- A decisão é atômica:
  `UPDATE approvals SET status=?, decided_at=? WHERE id=? AND status='pending' AND expires_at > ?`.
  - `changes = 0` + linha `pending` vencida → marca `expired` →
    `ApprovalExpiredError` (410);
  - `changes = 0` + linha já decidida → `ApprovalAlreadyDecidedError` (409).
- A execução da ação aprovada acontece **depois** do `UPDATE` vencedor e o
  resultado é gravado em `result_json`. Se a ação falhar com um erro de
  domínio, por exemplo um incidente que não existe mais, o erro vira o
  resultado ("Erro: …"), como a tool já faz hoje.
- Expirada não retoma o turno sozinha. O cartão mostra "expirada", e o
  usuário pergunta de novo.

**Rationale**:

- Sem timers, nada roda em segundo plano.
- O `UPDATE` condicional garante uma única execução mesmo com duas abas
  decidindo ao mesmo tempo. O `DatabaseSync` é síncrono, então não há
  intercalação dentro de um processo.

## §4 Conversa, persistência e registro de requisição

**Decision**:

- Um turno que pausa sem `conversationId` **cria a conversa já na pausa**,
  vazia. O 202 sempre devolve `conversationId`, para a war room recuperar o
  cartão depois de recarregar.
- Pergunta e resposta só entram na conversa no turno final, aprovado ou
  negado (FR-013g).
- O `learn` só dispara no final, nunca na pausa.
- A requisição pausada é registrada (specs/016) com `status: 202`,
  `outcome: "ok"`, as métricas da pausa e o rastro até a pausa.
- A requisição de decisão é outra requisição, com `requestId` próprio, e é
  registrada como 200 ou 202. Assim o `/stats` conta as duas.

**Rationale**:

- O CHECK `outcome IN ('ok','error')` do specs/016 não muda. Alterar um CHECK
  no SQLite exige recriar a tabela.
- 202 é sucesso do ponto de vista operacional.

**Alternatives considered**:

- Novo `outcome: "pending"`: exigiria migração da tabela.

## §5 Rastro

**Decision**: dois eventos novos no `TraceEvent`:

- `{ type: "approval", approvalId, tool, args, summary }` — a pausa, emitido
  pelo nó da estratégia logo depois do `action` correspondente;
- `{ type: "decision", approvalId, decision: "approved" | "denied" | "expired", result? }`
  — a decisão, no início do rastro do turno retomado, `node: "contexto"`.

O `route` do turno retomado sai com a nova `RouteSource` `"resume"` (rota
guardada da pausa, sem chamar o roteador).

O `traceEventLogFields` (specs/016) ganha estes campos:

- `approval` → `tool`, `approvalId`. Nunca `args` nem `summary`, porque o
  título do incidente é texto livre.
- `decision` → `approvalId`, `decision`.

O `formatTrace` ganha rótulos para os dois eventos.

## §6 CORS

**Decision**: middleware próprio, `src/http/cors.ts`, sem o pacote `cors`. A
regra fica numa função pura, `corsHeaders(origin, allowed)`, e o
`parseCorsOrigins(env)` (zod) lê `CORS_ORIGINS`: origens `http(s)://host[:port]`
separadas por vírgula.

**Rationale**: são ~30 linhas testáveis, sem dependência, e a lista de origens
é exata.

**Rules**:

- Origem na lista:
  - `Access-Control-Allow-Origin: <origem>`;
  - `Vary: Origin`;
  - `Access-Control-Expose-Headers: X-Request-Id`.
- Preflight (`OPTIONS`) de origem na lista: 204, com:
  - `Allow-Methods: GET, POST, DELETE, OPTIONS`;
  - `Allow-Headers: Content-Type`;
  - `Max-Age: 600`.
- Origem fora da lista, ou lista vazia: nenhum cabeçalho CORS. O navegador
  bloqueia.
- Sem `Allow-Credentials` e nunca `*`.
- O middleware é montado antes de todas as rotas.
- Entrada inválida em `CORS_ORIGINS` é ignorada, com aviso só com o nome da
  variável (mesmo padrão do `parseContextBudget`).

## §7 "Testar conexão" e a distinção de CORS

**Decision**: novo `GET /health` → `{ status: "ok" }`, sem dependências. O
teste roda em duas etapas:

1. `fetch(url/health)`: ok → **conectado**.
2. Se falhar com `TypeError`, roda `fetch(url/health, { mode: "no-cors" })`:
   - resolve (resposta opaca) → o servidor respondeu, mas a origem não está
     liberada → **origem não autorizada**;
   - rejeita → **API inacessível**.

**Rationale**: o navegador não expõe o motivo de falha de CORS. A segunda
tentativa sem CORS é o jeito padrão de distinguir os dois casos.

## §8 Stack da web

**Decision**:

- `web/` com `package.json` próprio, isolado da API: o `npm test` e o
  `tsconfig` da raiz não mudam.
- Vite + React + TypeScript `strict`.
- `zod` nas respostas da API (FR-009).
- `react-markdown`, que não renderiza HTML cru por padrão (edge case
  Markdown).
- Testes com **Vitest** + Testing Library + jsdom + `vitest-axe` (SC-005).
- `vite.config.ts` com `base: "/opspilot/"` (FR-017).

**Rationale**:

- O Vitest reaproveita as transformações do Vite (`import.meta.env`, CSS,
  JSX), iguais às do build.
- O `node:test` + `tsx` falha em imports de CSS e em `import.meta.env`. Ver
  Complexity Tracking no plan.

**Alternatives considered**:

- `node:test` + `tsx` + `global-jsdom`: diverge do build e quebra com CSS.
- Next.js: SSR desnecessário para uma ferramenta interna servida como arquivo
  estático sob um subcaminho.

## §9 Endereço da API, armazenamento e cancelamento

**Decision**:

- **Endereço padrão** (`defaultApiUrl`, pura):
  - `import.meta.env.VITE_OPSPILOT_API_URL` quando definido no build;
  - senão, em dev, `http://localhost:3000`;
  - senão, `window.location.origin`.
- **`localStorage`** guarda só três chaves, com `try/catch` em toda leitura e
  escrita (FR-021):
  - `opspilot.apiUrl`;
  - `opspilot.theme` (`light | dark | system`);
  - `opspilot.conversationId`.
- **Cancelar** (FR-003): `AbortController` no `fetch`. A UI volta ao estado
  pronto, com o aviso "o copiloto pode ter concluído; a resposta não será
  exibida".
- **Recarregar a página**:
  - o `conversationId` é mantido;
  - a war room chama `GET /chat/approvals?conversationId=` para recuperar a
    aprovação pendente;
  - as mensagens anteriores **não** são reexibidas e aparece o aviso
    "Conversa retomada". A API não tem endpoint de leitura de mensagens, e
    criá-lo fica fora do escopo.

## §10 Tipagem do rastro na web

**Decision**:

- `web/src/api/schemas.ts` declara uma união discriminada zod por `type`,
  espelhando o `GraphTraceEvent`, mais um ramo genérico `{ type: string,
  node?: string }` para tipos desconhecidos (FR-007).
- O componente `TraceStep` faz `switch` exaustivo sobre os tipos conhecidos.
- Ícone e rótulo de cada tipo saem de uma tabela pura, `TRACE_STEP_META`.

**Rationale**:

- Um tipo novo na API não quebra a war room.
- Um tipo conhecido sem renderização vira erro de compilação.
- Os tipos não são compartilhados por import entre `web/` e `src/`, porque
  os pacotes são separados. O teste de contrato do §11 garante a paridade.

## §11 Paridade de contrato API ↔ web

**Decision**:

- As fixtures de resposta (`web/src/test/fixtures/*.json`) são geradas por
  um teste da API que serializa respostas reais do `createApp` com fakes.
- O teste da web valida essas fixtures com os schemas zod da web.
- Se a API mudar o formato, a fixture regenerada quebra o teste da web.

**Rationale**: os dois lados ficam presos ao mesmo contrato sem acoplar os
pacotes.

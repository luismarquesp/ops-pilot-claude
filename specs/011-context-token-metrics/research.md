# Research: Medição de Contexto (Tokens)

## §1 — Estimativa: `ceil(chars / 4)`

- **Decision**: `estimateTokens(text) = Math.ceil(text.length / 4)`; `""` → 0.
  Comprimento em unidades de código UTF-16 (`String.length`), sem normalização.
- **Rationale**: é a heurística pedida, barata, determinística e pura. O
  arredondamento para cima garante que qualquer texto não vazio conte ≥ 1.
- **Alternatives**: tokenizador real (`tiktoken`/`js-tiktoken`) — nova
  dependência e acoplado a um modelo específico, enquanto o OpsPilot troca de
  modelo pelo OpenRouter; contar code points (`[...text].length`) — diferença
  irrelevante para uma estimativa grosseira.

## §2 — Onde o LangChain expõe o uso real

- **Decision**: ler o uso no callback `handleLLMEnd(output: LLMResult)`, por
  chamada, nesta ordem de preferência (a primeira que existir, nunca somando
  duas da mesma chamada):
  1. `output.generations[0][0].message.usage_metadata` →
     `{ input_tokens, output_tokens, total_tokens }` (formato padronizado do
     `@langchain/core`, preenchido pelo `ChatOpenAI` com ou sem streaming);
  2. `output.llmOutput.tokenUsage` → `{ promptTokens, completionTokens,
     totalTokens }` (formato legado do `ChatOpenAI`).
  Nada disso presente → chamada sem uso (`undefined`).
- **Rationale**: o callback é o único ponto que vê **toda** chamada ao modelo,
  inclusive as feitas via `withStructuredOutput` (plano/replano do
  plan-and-execute, crítico da reflexão), cujo retorno já é o objeto parseado e
  não a `AIMessage` com `usage_metadata`.
- **Alternatives**: somar `usage_metadata` das `AIMessage` do rastro — só
  funciona no ReAct; `withStructuredOutput(..., { includeRaw: true })` em cada
  ponto — espalha a instrumentação por todas as estratégias e mudaria seus
  tipos de retorno.

## §3 — Escopo por turno sem tocar nas estratégias: `AsyncLocalStorage`

- **Decision**: `src/context/usage-tracker.ts` mantém um `AsyncLocalStorage`
  com o acumulador do turno. `trackUsage(fn)` roda `fn` dentro de um escopo novo
  e devolve `{ value, usage }`. `createModel()` (`src/agents/model.ts`) consulta
  o escopo **no momento em que é chamado** e, se houver um, anexa
  `callbacks: [handler]`, com o handler fechando sobre aquele acumulador.
  Fora de escopo (arena, bench, MCP, refletor de aprendizado) → sem callback,
  comportamento idêntico ao de hoje.
- **Rationale**: todas as estratégias criam o modelo dentro de `run()` (ReAct,
  plan-and-execute, crítico da reflexão), logo dentro do escopo do turno.
  Capturar o acumulador na criação, e não no disparo do callback, torna a
  contagem imune à fila de callbacks em segundo plano do LangChain e isola
  turnos concorrentes (cada `trackUsage` tem seu próprio acumulador).
  O refletor (specs/009) é disparado por `runChat` **depois** de o escopo
  fechar, então não contamina o turno (edge case da spec).
- **Alternatives**: passar `config.callbacks` por `StrategyInput` — exige
  mudar o contrato `ReasoningStrategy` (specs/001) e todos os decoradores;
  fábrica de modelo injetada por turno — idem, e mais intrusivo.

## §4 — Garantir que o uso esteja completo quando o turno termina

- **Decision**: o handler é uma subclasse de `BaseCallbackHandler` construída com `_awaitHandler: true`
  (`fromMethods` não aceita essa opção), para o LangChain aguardar o
  `handleLLMEnd` antes de devolver a chamada.
- **Rationale**: por padrão os callbacks rodam em segundo plano
  (`LANGCHAIN_CALLBACKS_BACKGROUND`); a última chamada poderia ser somada
  depois de `runChat` ler o acumulador. O handler só soma números — custo nulo.
- **Alternatives**: `awaitAllCallbacks()` global antes de ler — espera
  callbacks de outros turnos também, e esconde a dependência.

## §5 — `promptTokens` quando o uso falta

- **Decision**: o acumulador guarda as chamadas que informaram uso;
  `promptTokens = soma(input)` se houve ≥ 1, senão `null`. Exceção dentro do
  handler é engolida (o turno não cai — FR-008).
- **Rationale**: `0` mentiria ("não gastou nada"); `null` diz "não sei". Como
  `metrics` é serializado como JSON, `null` (e não `undefined`) mantém o campo
  sempre presente (SC-001).

## §6 — `contextBreakdown`: partição exata do prompt montado

- **Decision**: função pura `contextBreakdown(question, history, facts)`
  (`src/context/breakdown.ts`) que reaproveita os formatadores existentes com
  pergunta vazia para obter o texto que cada camada **acrescenta**:
  - `history = estimateTokens(formatQuestionWithHistory(history, ""))` (0 se vazio)
  - `memory = estimateTokens(formatQuestionWithMemory(facts, ""))` (0 se vazio)
  - `question = estimateTokens(question)`
  - `total = history + memory + question`
  Como `withHistory(withMemory(...))` produz exatamente
  `prefixoHistórico + prefixoMemória + pergunta`, as três fatias particionam o
  prompt sem sobreposição; o texto de moldura ("Pergunta atual: ", cabeçalhos)
  pertence à fonte que o introduz.
- **Rationale**: nenhuma duplicação de formato — se o texto de histórico ou
  memória mudar, a estimativa acompanha. `total` como soma (e não estimativa do
  texto inteiro) é o que a spec define (FR-005) e evita discrepância de
  arredondamento.
- **Alternatives**: estimar o prompt inteiro e subtrair — arredondamentos
  tornam as fatias inconsistentes.

## §7 — `conversa-long.sh`

- **Decision**: `scripts/conversa-long.sh`, `#!/usr/bin/env bash`,
  `set -euo pipefail`. Variáveis: `OPSPILOT_URL` (default
  `http://localhost:3000`), `TURNS` (default 15), `USER_ID` opcional. Mensagens
  de uma lista fixa de perguntas de plantão, ciclando. Cada turno: `curl -sS
  -w '\n%{http_code}'` para `POST /chat`; status ≠ 200 → mensagem em stderr e
  `exit 1`; `curl` falhando (API fora) → `exit 1` pelo `set -e` com mensagem.
  JSON lido com `node -e` (já é pré-requisito do projeto), extraindo
  `conversationId`, `metrics.promptTokens` (`null` → `n/d`),
  `metrics.historyMessages` e `metrics.contextBreakdown.total`. Saída: uma
  tabela `turno | promptTokens | histórico | estimado`.
- **Rationale**: sem `jq` (nem sempre instalado no Git Bash do Windows); o
  script é observação manual, fora de `npm test` (exige modelo real).
- **Alternatives**: script em TypeScript — o usuário pediu explicitamente
  `.sh`.

## §8 — Testes sem rede

- **Decision**:
  - `tokens.test.ts`: `estimateTokens` (vazio, 1–4, 5, acentos) e
    `usageFromLLMResult` (formato padronizado, legado, ambos → só o primeiro,
    nenhum, objeto malformado).
  - `breakdown.test.ts`: sem fontes; com histórico e fatos — fatias batem com
    `estimateTokens` dos prefixos e `total` = soma.
  - `usage-tracker.test.ts`: `trackUsage` isola dois escopos concorrentes;
    `recordUsage` fora de escopo é no-op; handler aplicado a `LLMResult` falso
    soma no escopo certo; `null` sem uso.
  - `chat-service.test.ts`: estratégia falsa que chama `recordUsage` N vezes →
    `promptTokens` = soma; sem chamadas → `null`; `contextBreakdown` presente
    com histórico/memória; `learn` disparado não altera a contagem.
  - `server.test.ts`: resposta 200 do `/chat` traz os dois campos novos.

## Riscos

- O provedor do OpenRouter pode não devolver uso em streaming para alguns
  modelos → `promptTokens: null`, documentado; o script mostra `n/d`.
- Se uma estratégia futura criar o modelo **fora** de `run()` (ex.: no
  construtor), suas chamadas não seriam contadas — registrado no comentário de
  `createModel`.

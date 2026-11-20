# Research: Orçamento de Contexto por Seção (ContextBuilder)

Sem `NEEDS CLARIFICATION` abertos no Technical Context. As decisões abaixo
fecham os pontos de projeto que a spec deixou ao plano.

## §1 Onde o prompt passa a ser montado

- **Decision**: `src/context/context-builder.ts` exporta `buildContext(input,
  budget)`, função pura que devolve o prompt final (string) + o que foi mantido
  + o relatório de cortes + o `contextBreakdown`. `runChat` chama
  `strategy.run({ question: built.prompt })` diretamente; os decoradores
  `withHistory`/`withMemory` deixam de existir (os formatadores puros
  `formatQuestionWithMemory`, `formatQuestionWithHistory`, `formatSummaryBlock`
  continuam e são reaproveitados pelo builder).
- **Rationale**: o único ponto onde fatos/resumo/histórico entram no prompt é
  `runChat` (único consumidor de `withHistory(withMemory(...))`). Como a
  composição só reescreve `input.question`, montar a string uma vez e
  entregá-la à estratégia é equivalente para **todas** as estratégias
  (ReAct, plan-and-execute, com ou sem reflexão — a reflexão reusa
  `input.question` no retry, então o contexto orçado também vale no retry).
  Um ponto só elimina a duplicação entre os decoradores e o `contextBreakdown`,
  que hoje recalcula as fatias por fora (FR-001, FR-009).
- **Alternatives considered**: (a) manter os decoradores e cortar antes deles —
  dois lugares conhecendo a ordem das seções, risco de divergência entre prompt
  e breakdown; (b) decorador `withContext(strategy, built)` — indireção sem
  ganho, já que o builder já produz a string final.

## §2 Unidade e medida do teto

- **Decision**: teto em tokens estimados por `estimateTokens` (`ceil(chars/4)`,
  specs/011), aplicado ao **bloco inteiro** que a seção acrescenta, medido com
  o mesmo formatador usado no prompt e no breakdown:
  memória = `formatQuestionWithMemory(facts, "")`, resumo =
  `formatSummaryBlock(summary)`, janela = `formatQuestionWithHistory(history, "")`.
- **Rationale**: o breakdown reportado e o teto passam a falar exatamente a
  mesma língua — SC-001 é verificável lendo `contextBreakdown` da resposta.
  `ceil(chars/4) ≤ B` ⇔ `chars ≤ 4·B`, o que dá um corte de resumo exato.
- **Alternatives considered**: tokenizador real — dependência nova e por
  modelo, fora do escopo (spec, Assumptions); medir só o conteúdo sem
  cabeçalho — divergiria do breakdown.

## §3 Regra de corte da janela

- **Decision**: remover a mensagem mais antiga enquanto o bloco estimado
  passar do teto; mensagens nunca são cortadas pela metade; a janela pode
  terminar vazia (bloco some, FR-008). Implementação por varredura do fim para
  o início: a maior sufixo da lista que cabe.
- **Rationale**: FR-005 e edge case "mensagem mais recente sozinha excede".
  Ordem preservada por construção (`slice`). ≤ 15 mensagens (specs/012) → custo
  trivial mesmo recalculando o bloco.
- **Alternatives considered**: truncar texto de mensagens — quebra a
  integridade de turnos e confunde o modelo; manter sempre a última — viola o
  teto (SC-001).

## §4 Regra de corte da memória

- **Decision**: o builder recebe fatos com `score` (`RecalledMemory` já tem).
  Enquanto o bloco passar do teto, remove o fato de **menor** `score`; empate →
  remove o que aparece por último na ordem recebida. Os restantes mantêm a
  ordem recebida (que já é por relevância, `recall` ordena desc).
- **Rationale**: FR-006 + desempate determinístico da spec. Cortar por `score`
  e não por posição mantém a regra correta mesmo se a ordem de entrada mudar —
  o teste usa fatos fora de ordem para provar isso.
- **Alternatives considered**: cortar sempre o último — equivalente hoje, mas
  acopla a regra à ordenação do store.

## §5 Regra de corte do resumo

- **Decision**: se `formatSummaryBlock(summary)` passar do teto, o texto do
  resumo é encurtado para o maior prefixo que faz o bloco caber
  (`4·B − overhead do cabeçalho/separador` caracteres); se esse prefixo contém
  uma quebra de linha, corta na última quebra (termina em tópico inteiro);
  senão, corte seco em caractere. `trimEnd()` no resultado; prefixo vazio →
  resumo some (`summaryTruncated: true`). Sem marcador de reticências (não
  conta contra o teto e não confunde o modelo com texto inventado).
- **Rationale**: FR-007 ("mantém o início, preferindo fim de linha"). O resumo
  do specs/012 é escrito em tópicos telegráficos com quebras de linha, então o
  corte em linha é o caso comum. O resumo persistido não muda.
- **Alternatives considered**: descartar o resumo inteiro — perde decisões
  importantes por poucos caracteres; cortar o início — a mescla do specs/012
  não garante que o final seja o mais importante.

## §6 Configuração por ambiente

- **Decision**: `parseContextBudget(env)` puro em `context-builder.ts`, com
  um schema `zod` (`z.coerce.number().int().min(0)`) por chave:
  `CONTEXT_BUDGET_SUMMARY` (200), `CONTEXT_BUDGET_WINDOW` (1200),
  `CONTEXT_BUDGET_MEMORY` (300). Ausente ou string vazia → padrão, sem aviso;
  inválido → padrão + nome da chave em `invalid[]`. `src/index.ts` chama com
  `process.env`, loga `invalid` (só o nome da variável) e passa o orçamento
  por `createApp` → `runChat` (`ChatDeps.budget`, default
  `DEFAULT_CONTEXT_BUDGET`).
- **Rationale**: env é entrada externa → zod (Princípio I); função pura
  testável sem mexer em `process.env` (Princípio V); `node:process` nativo,
  sem `dotenv` (Princípio VI). Leitura uma vez, na subida (FR-004). Testes e
  `bench`/`arena` não dependem do ambiente.
- **Alternatives considered**: ler `process.env` dentro do builder — impuro e
  frágil em teste; falhar a subida com valor inválido — a spec pede fallback.

## §7 Observabilidade

- **Decision**: `ChatMetrics` ganha `contextTrimmed: { historyMessages:
  number; memoryFacts: number; summaryTruncated: boolean }` (quantos foram
  removidos). `historyMessages`, `memoryFacts` e `contextBreakdown` passam a
  ser calculados sobre o conteúdo mantido.
- **Rationale**: FR-011 / US3 — distinguir "o agente esqueceu" de "o orçamento
  cortou". Contagem, não conteúdo: nada novo vaza na resposta.
- **Alternatives considered**: evento no `trace` — o rastro é do raciocínio;
  cortes são propriedade do contexto, como o breakdown.

## §8 Interação com a sumarização (specs/012)

- **Decision**: o builder roda **depois** de `loadConversationContext`, sobre
  `context.recent`/`context.summary`; `planHistory` e o gatilho de resumo não
  mudam. Mensagens cortadas pelo orçamento continuam no banco e serão
  absorvidas pela próxima sumarização.
- **Rationale**: separação de responsabilidades — specs/012 decide o que é
  histórico, specs/013 decide quanto dele cabe no prompt deste turno.
- **Alternatives considered**: usar tokens no gatilho do resumo — mudaria o
  contrato do specs/012 e o SC-001 dele.

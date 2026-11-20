# Research: Núcleo de Raciocínio do OpsPilot

A `constitution.md` já fixa a stack (Node 22, TS ESM strict, Zod, LangChain/LangGraph
via OpenRouter, Sequelize/MySQL, `node:test` via `tsx`), então não há incógnitas de
"qual tecnologia usar" — o Technical Context do `plan.md` não deixou nenhum
`NEEDS CLARIFICATION`. As decisões abaixo cobrem *como* usar essa stack para satisfazer
os requisitos da spec, e resolvem as ambiguidades que ficaram registradas como
Assumptions em `spec.md`.

## 1. Captura de rastro na estratégia ReAct

**Decision**: usar o agente ReAct pré-construído do LangGraph
(`createReactAgent`/equivalente) com `streamEvents`/`stream` no modo que expõe os passos
intermediários (mensagens de `AIMessage` com `tool_calls`, `ToolMessage` de retorno), e
mapear cada mensagem emitida para um evento tipado do rastro (`thought` a partir do
conteúdo textual do `AIMessage`, `action` a partir de cada `tool_call`, `observation` a
partir do `ToolMessage` correspondente, `answer` a partir da mensagem final sem
`tool_calls`).

**Rationale**: o agente pré-construído já implementa o loop de raciocínio
(pensar → chamar tool → observar → repetir); reimplementar esse loop violaria a
recomendação da própria spec de usar o agente pré-construído e aumentaria a superfície
de bugs. Streaming/observação de mensagens é a forma documentada de obter os passos
intermediários sem acoplar o núcleo de raciocínio a detalhes internos do grafo.

**Alternatives considered**: (a) implementar o loop ReAct manualmente com um grafo
próprio — rejeitado por duplicar o que o LangGraph já oferece pronto e testado; (b) usar
apenas a resposta final sem capturar passos intermediários — rejeitado por violar FR-002
(rastro com eventos tipados) e FR-003 (ação deve registrar tool + args).

## 2. Grafo Plan-and-Execute com teto de passos

**Decision**: modelar como um grafo LangGraph com três nós — `planner` (saída
estruturada: lista ordenada de passos, via saída estruturada do chat model),
`executor` (consome o próximo passo pendente e chama as tools necessárias) e
`replanner` (recebe o histórico executado e decide: continuar com uma lista de passos
atualizada, ou concluir com uma resposta final). O teto de 8 passos (FR-012) é reforçado
por um contador de passos executados mantido no estado do grafo e checado *antes* de
cada transição para `executor`: se o contador atingir 8, o grafo é forçado a terminar
independentemente do que o `replanner` decidir.

**Rationale**: manter o teto como uma checagem estrutural do grafo (e não apenas uma
instrução no prompt do replanner) garante FR-012 mesmo se o modelo "alucinar" mais
passos — o requisito é sobre comportamento observável do sistema, não sobre o que o
prompt pede.

**Alternatives considered**: confiar apenas em uma instrução de prompt para o
replanner respeitar o limite — rejeitado por não ser garantido (LLMs não seguem
instruções de forma determinística); o teto precisa ser aplicado em código.

## 3. Persistência determinística e testável sem rede

**Decision**: isolar todo acesso a dados atrás de `src/services/incidents.service.ts`,
que depende apenas de uma interface de repositório (implementada por
`src/models/*` usando Sequelize/MySQL em runtime normal). Os testes determinísticos de
FR-017 (store e formatação de rastro) rodam contra uma instância Sequelize configurada
com o dialeto `sqlite` **em memória** (mesma API do Sequelize, sem processo de rede,
sem MySQL real), populada pela mesma rotina de seed usada em desenvolvimento — a
implementação de produção continua sendo MySQL via `mysql2`, conforme a constitution.

**Rationale**: isso resolve a tensão entre "store in-memory pré-populado" (linguagem do
pedido original) e "banco MySQL via Sequelize" (stack fixada pela constitution): ambos
são verdadeiros em contextos diferentes — MySQL é a persistência real, e um dialeto em
memória do próprio Sequelize é o que torna os testes determinísticos e livres de rede
(FR-017/SC-005) sem introduzir uma segunda implementação de repositório para manter em
sincronia.

**Alternatives considered**: (a) mockar manualmente as chamadas Sequelize com
stubs/fakes — rejeitado por exigir manter dois "modelos mentais" de como os dados se
comportam (o fake e o real) e por não validar queries reais; (b) exigir um MySQL real
disponível em CI para os testes — rejeitado por violar FR-017 (testes sem rede) e por
tornar o teste dependente de infraestrutura externa.

## 4. Contagem de chamadas ao LLM e latência

**Decision**: usar um `CallbackHandler` do `@langchain/core` (hooks `handleLLMStart` /
`handleLLMEnd`) anexado a cada execução de estratégia para incrementar o contador de
chamadas e acumular a duração; a métrica de latência total da execução é medida em torno
de toda a chamada a `run(input)` (`Date.now()` antes/depois), não apenas da soma das
chamadas ao modelo.

**Rationale**: usar o mecanismo de callbacks do LangChain evita instrumentar
manualmente cada ponto de chamada ao modelo (que existe em pelo menos três lugares:
ReAct, planner e replanner do Plan-and-Execute) e reduz o risco de esquecer de contar
uma chamada.

**Alternatives considered**: contar manualmente incrementando uma variável a cada
`invoke()` do modelo — rejeitado por ser fácil de esquecer em um novo ponto de chamada
(ex.: ao adicionar o replanner) e por não ser reforçado pelo tipo do sistema.

## 5. Valores por padrão não especificados no pedido original

**Decision**:
- Severidade de incidente: enum fixo `low | medium | high | critical`.
- Limite padrão de iterações/passos quando `--max-iterations` não é informado: 8 (o
  mesmo teto rígido do Plan-and-Execute, aplicado também como default do ReAct, para
  manter as duas estratégias comparáveis na arena por padrão).
- Contagem de chamadas ao LLM inclui chamadas de planejamento e replanejamento, não
  apenas chamadas que produzem uma resposta final.

**Rationale**: valores simples, documentados, e alinhados ao teto já exigido
explicitamente para o Plan-and-Execute (FR-012), o que evita que a arena compare
estratégias com limites de execução diferentes por acidente quando nenhum valor é
passado explicitamente via `--max-iterations`.

**Alternatives considered**: nenhum default (exigir sempre `--max-iterations`
explícito) — rejeitado por tornar `npm run arena` sem flags inutilizável, contrariando
o SC-001 ("um único comando").

---

**Output**: todas as incógnitas técnicas relevantes para o design foram resolvidas
acima; nenhum `NEEDS CLARIFICATION` permanece no Technical Context de `plan.md`.

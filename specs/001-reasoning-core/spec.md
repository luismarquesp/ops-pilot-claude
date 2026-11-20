# Feature Specification: Núcleo de Raciocínio do OpsPilot

**Feature Branch**: `001-reasoning-core`

**Created**: 2026-09-08

**Status**: Draft

**Input**: User description: "Núcleo de racioncínio do OpsPilot: Interface comum ReasoningStrategy: name + run(input) -> (answer, trace, metrics). trace = eventos tipados (thought | action | observation| plan | critique | answer); action carrega (tool, args). metrics = (ICall, latencyMs). Fábrica única em src/agents/model.ts lendo OPENROUTER_API_KEY e OPEN_ROUTER_MODEL (baseUrl do OpenRouter), temperatura 0. Ferraments mock em src/agentes/tools.ts sobre um store in-memory pré-populado (o seed primário: 5 serviços, 6 alertas variados - 3 firing, 3 resolved - crie um script para rodar o seed e execute ele no final desse prompt): list_alert(status, open_incident(title, service, serveriry), resolve_incident(id). Schemas zod, banco mysql, utilizando sequelize. Estratégia ReAct em src/agents/react.ts usando o agente ReAct pré-construído do LangGraph com essas tools, capturando o trace completo. Estratégia Plan-and-Execute em src/agents/plan-and-execute.ts como grafo: planner (saída estruturada: lista de passos), executor (um passo por vez com as tools), replanner (revisa o restante após cada passo; encerra quando não resta nada). Máximo 8 passos. Toda estratégia respeita limite de iterações e conta chamadas LLM. Arena mínima em src/arena.ts: roda 1+ estratégias sobre o mesmo input e imprime traces e métricas (flags --strategies e --max-iterations). Testes: store e formatação de trace (determinísticos, sem rede)"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Investigar e resolver um incidente com uma estratégia de raciocínio (Priority: P1)

Como pessoa responsável por avaliar o OpsPilot, quero pedir para uma estratégia de
raciocínio investigar os alertas ativos e agir sobre eles (abrindo ou resolvendo
incidentes), e quero ver exatamente como ela chegou à resposta final, para confiar que o
copiloto toma decisões corretas e rastreáveis antes de expô-lo a um plantão real.

**Why this priority**: sem uma estratégia funcional que investiga, age e produz um
rastro auditável, não existe copiloto — é o valor mínimo do produto.

**Independent Test**: pode ser testado sozinho executando a estratégia ReAct contra o
cenário de dados semeado (seed) e verificando que a resposta final é coerente com os
alertas existentes e que o rastro mostra cada passo de raciocínio, ação e observação.

**Acceptance Scenarios**:

1. **Given** o armazenamento de alertas semeado com 3 alertas em "firing" e 3 em
   "resolved", **When** a estratégia é executada com uma pergunta sobre incidentes em
   aberto, **Then** a resposta final reflete corretamente os alertas em "firing" e o
   rastro registra cada consulta e ação realizada, na ordem em que ocorreram.
2. **Given** uma execução concluída, **When** o rastro é inspecionado, **Then** cada
   evento de ação registra qual ferramenta foi chamada e com quais argumentos.

---

### User Story 2 - Comparar duas estratégias de raciocínio sobre o mesmo caso (Priority: P2)

Como pessoa avaliando o OpsPilot, quero rodar mais de uma estratégia de raciocínio
(reação passo a passo e planejar-e-executar) sobre o mesmo cenário e ver os rastros e
métricas lado a lado, para decidir qual estratégia é mais adequada para o caso de uso do
plantão.

**Why this priority**: a escolha da estratégia de raciocínio é uma decisão central do
produto; sem uma forma de comparar, essa decisão fica sem evidência.

**Independent Test**: pode ser testado sozinho rodando o comparador com duas ou mais
estratégias selecionadas sobre o mesmo input e conferindo que a saída mostra, para cada
estratégia, seu rastro completo e suas métricas de execução.

**Acceptance Scenarios**:

1. **Given** duas estratégias registradas, **When** o comparador é executado
   selecionando ambas para o mesmo input, **Then** a saída apresenta, para cada
   estratégia, seu rastro e suas métricas (quantidade de chamadas ao modelo e latência).
2. **Given** um limite de iterações informado pela pessoa usuária, **When** o comparador
   é executado, **Then** todas as estratégias selecionadas respeitam esse limite durante
   a execução.

---

### User Story 3 - Confiar no comportamento das ferramentas sem depender de produção real (Priority: P3)

Como pessoa desenvolvendo ou avaliando o OpsPilot, quero que as ações de consultar,
abrir e resolver incidentes operem sobre um conjunto de dados previsível e
reproduzível, para poder demonstrar e testar o copiloto repetidamente sem depender de um
ambiente de produção real.

**Why this priority**: previsibilidade dos dados é o que torna possível testar e
demonstrar as duas estratégias de forma justa e repetível; sem isso, User Story 1 e 2
não podem ser validadas de forma confiável.

**Independent Test**: pode ser testado sozinho executando o script de preparação de
dados (seed) e verificando, sem envolver nenhuma estratégia de raciocínio, que o
armazenamento resultante contém exatamente os serviços e alertas esperados.

**Acceptance Scenarios**:

1. **Given** um armazenamento vazio, **When** o script de preparação de dados é
   executado, **Then** o armazenamento passa a conter 5 serviços e 6 alertas, sendo
   exatamente 3 em status "firing" e 3 em status "resolved".
2. **Given** o armazenamento já semeado, **When** a ação de listar alertas é chamada com
   um filtro de status, **Then** somente os alertas daquele status são retornados.
3. **Given** um identificador de incidente válido, **When** a ação de resolver
   incidente é chamada com esse identificador, **Then** o status do incidente
   correspondente passa a ser "resolved".

---

### Edge Cases

- O que acontece quando uma estratégia atinge o limite máximo de iterações/passos sem
  ter produzido uma resposta final? O sistema deve interromper a execução, sem travar
  ou continuar indefinidamente, e o rastro deve deixar evidente que o limite foi
  atingido.
- O que acontece quando uma ação é chamada com argumentos inválidos (ex.: severidade
  desconhecida, status inexistente) ou um identificador de incidente que não existe
  (ex.: resolver um incidente inexistente)? A chamada deve falhar de forma explícita e
  essa falha deve aparecer como uma observação no rastro, sem interromper
  abruptamente o processo nem ser silenciosamente ignorada.
- O que acontece quando a estratégia Planejar-e-Executar, após uma rodada de
  replanejamento, ainda propõe passos restantes mas o limite de 8 passos já foi
  atingido? A execução deve parar no limite, mesmo que o replanejamento indique que
  ainda há trabalho a fazer.
- O que acontece quando a listagem de alertas é filtrada por um status sem nenhuma
  correspondência? O resultado deve ser uma lista vazia, não um erro.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema DEVE expor um contrato único de estratégia de raciocínio,
  implementado por toda estratégia disponível, que recebe uma entrada e produz uma
  resposta final, um rastro completo do raciocínio e métricas de execução.
- **FR-002**: O rastro produzido por qualquer estratégia DEVE ser composto por eventos
  tipados — pensamento, ação, observação, plano, crítica e resposta final — registrados
  na ordem em que ocorreram.
- **FR-003**: Todo evento de ação registrado no rastro DEVE indicar qual ferramenta foi
  chamada e com quais argumentos.
- **FR-004**: As métricas de uma execução DEVEM incluir, no mínimo, o número de chamadas
  feitas ao modelo de linguagem e a latência total da execução.
- **FR-005**: O sistema DEVE fornecer uma forma única e compartilhada de obter o modelo
  de linguagem configurado (usando a chave de API e o identificador de modelo
  configurados no ambiente), com temperatura zero, garantindo que toda estratégia use a
  mesma configuração de modelo.
- **FR-006**: O sistema DEVE fornecer três ações que as estratégias de raciocínio podem
  invocar: listar alertas (com filtro opcional por status), abrir um novo incidente
  (com título, serviço e severidade) e resolver um incidente existente (por
  identificador).
- **FR-007**: Toda entrada e saída dessas ações DEVE ser validada contra um schema
  explícito; uma chamada com dados inválidos DEVE ser rejeitada com um erro claro, em
  vez de aceita silenciosamente ou de causar comportamento indefinido.
- **FR-008**: Os dados de serviços e alertas usados pelas ações DEVEM ser mantidos em um
  armazenamento persistente que possa ser semeado e consultado de forma independente de
  qualquer execução de estratégia.
- **FR-009**: O sistema DEVE fornecer um script de preparação de dados (seed)
  reproduzível, executável sob demanda, que popula o armazenamento com exatamente 5
  serviços e 6 alertas, sendo 3 em status "firing" e 3 em status "resolved".
- **FR-010**: O sistema DEVE fornecer uma estratégia de raciocínio do tipo "reagir a
  cada observação" (ReAct), que intercala pensamento e chamadas às ações disponíveis até
  chegar a uma resposta final, capturando o rastro completo desse processo.
- **FR-011**: O sistema DEVE fornecer uma estratégia de raciocínio do tipo
  "planejar-e-executar", composta por: um planejador que produz uma lista ordenada de
  passos antes de agir; um executor que realiza um passo por vez usando as ações
  disponíveis; e um replanejador que reavalia os passos restantes após cada passo
  executado e decide se a execução deve continuar ou encerrar.
- **FR-012**: A estratégia planejar-e-executar DEVE encerrar automaticamente quando o
  replanejador concluir que não restam passos, e NÃO DEVE executar mais que 8 passos em
  uma única execução, independentemente do que o replanejador proponha.
- **FR-013**: Toda estratégia de raciocínio DEVE respeitar um limite máximo configurável
  de iterações/passos e DEVE interromper a execução ao atingir esse limite, mesmo que
  nenhuma resposta final tenha sido produzida.
- **FR-014**: Toda estratégia de raciocínio DEVE contar e reportar quantas chamadas ao
  modelo de linguagem realizou durante a execução.
- **FR-015**: O sistema DEVE fornecer um comparador ("arena") capaz de executar uma ou
  mais estratégias de raciocínio selecionadas sobre a mesma entrada e imprimir, para
  cada estratégia executada, seu rastro completo e suas métricas.
- **FR-016**: O comparador DEVE permitir que quem o executa escolha quais estratégias
  rodar e substitua o limite máximo de iterações/passos usado na execução.
- **FR-017**: O comportamento do armazenamento (semear, consultar e alterar
  serviços/alertas/incidentes) e a formatação do rastro DEVEM ter testes automatizados
  determinísticos, executáveis sem qualquer acesso à rede (sem chamar o modelo de
  linguagem ou qualquer serviço externo).

### Key Entities

- **Serviço**: um serviço de produção monitorado ao qual alertas/incidentes pertencem;
  identificado por nome.
- **Alerta/Incidente**: um evento representando um problema de produção; possui
  identificador, título, serviço associado, severidade e status (por exemplo, "firing"
  ou "resolved").
- **Estratégia de Raciocínio**: uma abordagem de raciocínio identificada por nome que,
  dada uma entrada, produz uma resposta final, um rastro e métricas de execução.
- **Rastro (Trace)**: a sequência ordenada de eventos tipados que documenta como uma
  estratégia chegou à sua resposta final.
- **Métricas**: o registro quantitativo de uma execução — número de chamadas ao modelo
  de linguagem e latência.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Uma pessoa consegue executar qualquer estratégia de raciocínio disponível
  contra o cenário semeado e obter, em um único comando, uma resposta final e um rastro
  completo e legível do raciocínio.
- **SC-002**: O comparador consegue exibir, em uma única execução, os resultados (rastro
  e métricas) de pelo menos duas estratégias diferentes sobre o mesmo cenário.
- **SC-003**: Em 100% das execuções, nenhuma estratégia de raciocínio ultrapassa o
  limite máximo de iterações/passos configurado para aquela execução.
- **SC-004**: Em 100% das execuções, a estratégia planejar-e-executar não realiza mais
  de 8 passos.
- **SC-005**: 100% dos testes do armazenamento e da formatação do rastro passam de
  forma consistente sem exigir acesso à rede ou a um modelo de linguagem real.
- **SC-006**: Uma chamada de ação inválida (por exemplo, resolver um incidente
  inexistente) nunca interrompe abruptamente uma execução — ela sempre aparece como uma
  observação de erro no rastro, e a execução termina normalmente dentro do seu limite de
  iterações/passos.

## Assumptions

- "Alerta" e "Incidente" são tratados como a mesma entidade de domínio neste núcleo de
  raciocínio (um alerta em aberto é um incidente em andamento); a ação de listar opera
  sobre alertas e as ações de abrir/resolver operam sobre incidentes do mesmo conjunto
  de dados.
- Severidade de um incidente aceita um conjunto fixo e pequeno de valores conhecidos
  (por exemplo: baixa, média, alta, crítica); o valor exato é uma decisão de
  planejamento, não de escopo.
- O armazenamento de serviços/alertas é persistente (não apenas em memória de processo),
  conforme exigido pela stack já definida para o projeto; "pré-populado" descreve o
  resultado do script de preparação de dados (seed), não a tecnologia de armazenamento.
- Os testes determinísticos do armazenamento e da formatação do rastro rodam contra uma
  instância de teste isolada (não uma instância de produção) e não dependem de acesso à
  rede; a forma exata de isolar essa instância é uma decisão de planejamento.
- O comparador ("arena") é uma ferramenta de uso interno da equipe que constrói o
  OpsPilot (não uma funcionalidade exposta a quem está de plantão), usada para validar e
  escolher a estratégia de raciocínio antes de colocá-la em produção.
- Cada estratégia tem um limite padrão de iterações/passos razoável quando nenhum limite
  é informado explicitamente; o valor exato do padrão é uma decisão de planejamento.
- "Chamada ao modelo de linguagem" conta qualquer invocação ao modelo configurado
  (incluindo, no caso da estratégia planejar-e-executar, chamadas de planejamento e de
  replanejamento), não apenas chamadas que produzem uma resposta final.

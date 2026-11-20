# Feature Specification: Camada de Reflexão sobre Estratégias de Raciocínio

**Feature Branch**: `002-reflection-layer`

**Created**: 2026-09-13

**Status**: Draft

**Input**: User description: "Camada Reflection: withReflection (strategy, opts) decora qualquer ReasoningStrategy: executa a base, um crítico (mesmo modelo, saída estruturada { approved, feedback }) avalia a resposta contra as observações do trace; se reprovar, regenera com o feedback no contexto; para approved ou maxReflection (default:2). Evento \"critique\" no trace; métricas somam as chamadas extras. Arena: reflect:react e reflect:plan-and-execute."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Resposta revisada antes de chegar ao plantonista (Priority: P1)

Como pessoa avaliando o OpsPilot, quero que a resposta final de qualquer estratégia de
raciocínio seja automaticamente conferida contra o que foi de fato observado (via
ferramentas) durante a execução, e corrigida quando não bater, para que respostas
inventadas ou não sustentadas pelos dados reais não cheguem ao plantonista como se
fossem confiáveis.

**Why this priority**: é o valor central desta feature — sem essa checagem automática,
a "reflexão" não existe; é o que torna a resposta mais confiável do que a de uma
estratégia crua.

**Independent Test**: pode ser testado sozinho pedindo a versão "com reflexão" de uma
estratégia existente sobre o cenário semeado, e verificando que a resposta final é
consistente com os dados retornados pelas ferramentas durante a execução (e que, se a
primeira resposta gerada não fosse consistente, uma segunda tentativa com o feedback do
crítico teria sido produzida).

**Acceptance Scenarios**:

1. **Given** uma estratégia de raciocínio já existente e um input, **When** ela é
   executada em sua versão com reflexão, **Then** o crítico avalia a resposta final
   contra as observações do rastro daquela execução antes da resposta ser considerada
   definitiva.
2. **Given** o crítico reprova a primeira resposta gerada, **When** a estratégia
   regenera uma nova resposta, **Then** o feedback do crítico é incorporado ao contexto
   dessa nova tentativa, e o crítico avalia a nova resposta em seguida.
3. **Given** o crítico aprova uma resposta, **When** a avaliação termina, **Then** a
   execução encerra imediatamente com aquela resposta, sem rodadas adicionais.

---

### User Story 2 - Comparar uma estratégia com e sem reflexão na arena (Priority: P2)

Como pessoa avaliando o OpsPilot, quero rodar a versão com reflexão de uma estratégia
lado a lado com sua versão crua no comparador, para decidir se o ganho de confiabilidade
compensa o custo adicional em chamadas ao modelo de linguagem.

**Why this priority**: a reflexão tem um custo (chamadas extras); sem uma forma de
comparar lado a lado, não há evidência para decidir se vale a pena usá-la em produção.

**Independent Test**: pode ser testado sozinho selecionando, no comparador, a versão
crua e a versão com reflexão da mesma estratégia sobre o mesmo input, e conferindo que a
saída mostra o rastro e as métricas de cada uma separadamente.

**Acceptance Scenarios**:

1. **Given** as duas estratégias de raciocínio já existentes, **When** o comparador é
   executado selecionando a versão com reflexão de uma delas, **Then** ela aparece como
   uma opção selecionável distinta da versão crua da mesma estratégia.
2. **Given** uma execução com reflexão que precisou de mais de uma rodada, **When** as
   métricas são exibidas, **Then** o número de chamadas ao modelo reportado inclui as
   chamadas de todas as rodadas (execuções da estratégia base e avaliações do crítico),
   não apenas da última tentativa.

---

### User Story 3 - A revisão nunca roda descontroladamente (Priority: P3)

Como pessoa operando o OpsPilot, quero que o ciclo de crítica e nova tentativa tenha um
limite rígido de rodadas, para que uma discordância persistente entre o gerador e o
crítico nunca aumente o custo ou o tempo de resposta de forma descontrolada.

**Why this priority**: sem um limite, a User Story 1 poderia, no pior caso, nunca
terminar ou custar de forma imprevisível — o limite é o que torna a reflexão segura de
usar.

**Independent Test**: pode ser testado sozinho configurando um crítico que nunca aprova
e verificando que a execução ainda assim termina, no máximo, após o número configurado
de rodadas, retornando a última resposta gerada.

**Acceptance Scenarios**:

1. **Given** um crítico que reprova todas as tentativas, **When** o número máximo de
   rodadas de reflexão é atingido, **Then** a execução encerra e retorna a última
   resposta gerada, mesmo sem aprovação.
2. **Given** nenhum limite explícito informado, **When** a estratégia com reflexão é
   executada, **Then** o limite padrão de 2 rodadas é aplicado.

---

### Edge Cases

- O que acontece quando a execução de base não produz nenhuma observação no rastro (por
  exemplo, respondeu sem chamar nenhuma ferramenta)? O crítico ainda deve avaliar a
  resposta (com base no que houver disponível), sem exigir que existam observações.
- O que acontece se o limite máximo de rodadas for configurado como zero? Nenhuma
  rodada de crítica/regeneração ocorre — o comportamento é idêntico ao da estratégia
  sem reflexão.
- O que acontece se a própria avaliação do crítico falhar de forma inesperada? A
  execução não pode travar nem lançar um erro não tratado — deve se comportar como uma
  rodada reprovada (ou encerrar com a última resposta válida conhecida) e deixar isso
  visível no rastro.
- O que acontece quando o crítico aprova já na primeira tentativa? Nenhuma regeneração
  ocorre; o custo extra é apenas o de uma avaliação do crítico.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema DEVE permitir envolver qualquer estratégia de raciocínio
  existente com uma camada de reflexão, sem alterar o comportamento dessa estratégia
  quando usada sem a reflexão.
- **FR-002**: Uma execução com reflexão DEVE, após cada execução da estratégia de base,
  ter sua resposta avaliada por um crítico contra as observações registradas no rastro
  daquela execução.
- **FR-003**: A avaliação do crítico DEVE ser um veredito estruturado contendo uma
  decisão de aprovação e, quando não aprovada, uma justificativa (feedback) explicando o
  motivo.
- **FR-004**: Quando o crítico não aprova a resposta, o sistema DEVE gerar uma nova
  resposta reexecutando a estratégia de base com o feedback do crítico incorporado ao
  contexto, e então avaliar essa nova resposta novamente.
- **FR-005**: O ciclo de crítica e nova tentativa DEVE parar por um de dois motivos: o
  crítico aprova a resposta, ou um número máximo configurável de rodadas de reflexão é
  atingido (padrão: 2).
- **FR-006**: Quando o limite máximo de rodadas é atingido sem aprovação, o sistema
  DEVE retornar a resposta mais recentemente gerada como resultado final, em vez de
  falhar ou retornar um erro.
- **FR-007**: O rastro de uma execução com reflexão DEVE incluir um evento de crítica
  para cada rodada de avaliação realizada pelo crítico, além de todos os eventos já
  produzidos pelas execuções da estratégia de base.
- **FR-008**: As métricas de uma execução com reflexão (número de chamadas ao modelo de
  linguagem, latência) DEVEM contabilizar todas as execuções da estratégia de base e
  todas as avaliações do crítico realizadas durante aquela execução, não apenas a
  última tentativa.
- **FR-009**: O comparador (arena) DEVE permitir selecionar a versão com reflexão de
  cada estratégia de raciocínio existente como uma opção selecionável própria, distinta
  da versão sem reflexão da mesma estratégia.
- **FR-010**: Uma estratégia com reflexão DEVE continuar respeitando, em cada execução
  individual da estratégia de base dentro do ciclo de reflexão, os limites de
  iterações/passos já exigidos dessa estratégia.

### Key Entities

- **Veredito do Crítico**: o resultado de uma avaliação — uma decisão de aprovação e,
  quando reprovado, uma justificativa em texto.
- **Rodada de Reflexão**: um ciclo composto por uma execução da estratégia de base
  seguida de uma avaliação do crítico; uma execução com reflexão é composta por uma ou
  mais rodadas, até a aprovação ou o limite máximo.
- **Limite de Rodadas**: o número máximo de rodadas de reflexão permitidas em uma
  execução, configurável, com padrão de 2.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Uma pessoa consegue rodar a versão com reflexão de qualquer estratégia
  existente sobre o mesmo tipo de pergunta usado na estratégia sem reflexão, sem
  precisar mudar a forma como formula a pergunta.
- **SC-002**: Em 100% das execuções, uma estratégia com reflexão nunca realiza mais
  rodadas de reflexão do que o limite máximo configurado para aquela execução.
- **SC-003**: O comparador consegue exibir, na mesma execução, o rastro e as métricas
  da versão com reflexão e da versão sem reflexão da mesma estratégia sobre o mesmo
  input.
- **SC-004**: Quando o crítico aprova a resposta antes de atingir o limite de rodadas, a
  execução encerra imediatamente, sem rodadas adicionais desnecessárias.
- **SC-005**: Toda rodada de avaliação do crítico fica visível no rastro da execução,
  permitindo entender depois por que uma resposta foi aceita direto ou precisou ser
  corrigida.

## Assumptions

- O crítico usa a mesma configuração de modelo de linguagem já definida para o núcleo
  de raciocínio (não há, por enquanto, um modelo separado ou especializado para
  crítica).
- "Avaliar contra as observações do rastro" significa que o julgamento do crítico é
  baseado especificamente no que as ferramentas efetivamente retornaram durante aquela
  execução — não uma checagem de fatos livre contra conhecimento externo.
- O limite máximo de rodadas de reflexão tem padrão 2 quando não configurado
  explicitamente; configurar esse limite como zero é válido e desativa a reflexão na
  prática (comportamento idêntico ao da estratégia sem reflexão).
- A camada de reflexão se aplica a qualquer estratégia que siga o contrato comum já
  existente de estratégia de raciocínio, não é específica de uma estratégia em
  particular — `reflect:react` e `reflect:plan-and-execute` são as duas opções
  concretas pedidas agora para o comparador.
- Uma execução malsucedida da própria avaliação do crítico é tratada como uma rodada
  não aprovada (ou como encerramento com a última resposta válida), nunca como uma
  falha não tratada da execução como um todo.

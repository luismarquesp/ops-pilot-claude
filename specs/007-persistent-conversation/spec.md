# Feature Specification: Conversa Persistente no Chat

**Feature Branch**: `007-persistent-conversation`

**Created**: 2026-09-29

**Status**: Draft

**Input**: User description: "Conversa persistente: ConversationStore (append/lastMessages/create) + tabela messages como no SqliteOpsStore; /chat: conversationId opcional, devolvido na resposta; 12 últimas mensagens no prompt via composição; métrica historyMessages; testes: \":memory:\" + fake"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Continuar uma conversa com o OpsPilot (Priority: P1)

Durante um plantão, o operador faz uma pergunta ao OpsPilot ("quais alertas estão
disparando?") e, em seguida, uma pergunta de acompanhamento que só faz sentido com o
contexto anterior ("abre um incidente para o segundo"). Hoje cada pergunta é
tratada isoladamente e o OpsPilot "esquece" o que acabou de dizer. O operador quer
que o OpsPilot lembre das trocas recentes da mesma conversa e responda levando-as
em conta.

**Why this priority**: é o valor central da feature — sem memória entre turnos, o
copiloto obriga o operador a repetir todo o contexto a cada pergunta, o que é
lento e propenso a erro no meio de um incidente.

**Independent Test**: enviar uma primeira mensagem sem identificador de conversa,
guardar o identificador devolvido, enviar uma segunda mensagem com esse
identificador e verificar que o raciocínio da segunda recebeu a primeira troca
(pergunta e resposta) como histórico.

**Acceptance Scenarios**:

1. **Given** nenhuma conversa informada, **When** o operador envia uma mensagem,
   **Then** uma nova conversa é criada, a resposta é devolvida normalmente e inclui
   o identificador dessa nova conversa.
2. **Given** uma conversa existente com trocas anteriores, **When** o operador envia
   uma nova mensagem informando o identificador dessa conversa, **Then** o OpsPilot
   raciocina levando em conta as trocas anteriores e a resposta devolve o mesmo
   identificador de conversa.
3. **Given** uma conversa em que o OpsPilot respondeu com sucesso, **When** a
   próxima mensagem da conversa é enviada, **Then** tanto a pergunta quanto a
   resposta final do turno anterior fazem parte do histórico considerado.

---

### User Story 2 - A conversa sobrevive a um restart (Priority: P2)

O operador está no meio de uma investigação quando o serviço do OpsPilot é
reiniciado (deploy, queda e volta). Ele espera continuar a mesma conversa usando o
identificador que já tinha, sem perder o contexto construído até ali.

**Why this priority**: coerente com a persistência real de operações (specs/004) —
histórico que vive só na memória do processo some justamente nos momentos de
instabilidade, quando o plantonista mais precisa dele.

**Independent Test**: criar uma conversa com algumas trocas, reiniciar o processo
apontando para o mesmo armazenamento, enviar uma nova mensagem com o mesmo
identificador e verificar que o histórico anterior foi considerado.

**Acceptance Scenarios**:

1. **Given** uma conversa com trocas registradas em uma execução anterior do
   sistema, **When** o processo é reiniciado e uma nova mensagem é enviada com o
   identificador dessa conversa, **Then** as trocas anteriores continuam
   disponíveis como histórico.

---

### User Story 3 - Visibilidade de quanto histórico foi usado (Priority: P3)

Quem opera ou avalia o OpsPilot (plantonista, pessoa rodando benchmarks) quer saber,
em cada resposta, quantas mensagens anteriores da conversa foram levadas em conta no
raciocínio, para entender por que o OpsPilot respondeu daquele jeito e acompanhar o
custo que o histórico adiciona.

**Why this priority**: é observabilidade — útil para diagnosticar e medir, mas a
feature já entrega valor sem ela.

**Independent Test**: enviar mensagens em uma conversa e verificar que a métrica de
mensagens de histórico em cada resposta corresponde ao número de mensagens
anteriores efetivamente consideradas (0 no primeiro turno, crescendo até o teto).

**Acceptance Scenarios**:

1. **Given** uma conversa nova, **When** a primeira mensagem é respondida, **Then**
   as métricas da resposta indicam 0 mensagens de histórico.
2. **Given** uma conversa com 2 trocas completas (4 mensagens), **When** a próxima
   mensagem é respondida, **Then** as métricas indicam 4 mensagens de histórico.
3. **Given** uma conversa com mais de 12 mensagens anteriores, **When** a próxima
   mensagem é respondida, **Then** as métricas indicam 12 mensagens de histórico.

---

### Edge Cases

- **Identificador de conversa inexistente**: a requisição é rejeitada com um erro
  claro de "conversa não encontrada" — nenhuma conversa nova é criada
  silenciosamente e nenhuma estratégia de raciocínio é executada.
- **Identificador de conversa malformado** (tipo ou formato inválido): tratado como
  entrada inválida, com o mesmo formato de erro de validação já usado pelo chat.
- **Conversa longa (mais de 12 mensagens)**: apenas as 12 mensagens mais recentes
  são consideradas, na ordem cronológica original; as mais antigas continuam
  guardadas, mas não entram no raciocínio.
- **Turno que falha ou estoura o tempo limite**: nada do turno é registrado na
  conversa (nem a pergunta, nem uma resposta parcial) — o histórico só contém
  trocas completas, e o operador pode reenviar a pergunta.
- **Estratégia desconhecida com conversa informada**: o erro de estratégia
  desconhecida continua valendo, e a conversa não é alterada.
- **Estratégia ou reflexão diferentes entre turnos da mesma conversa**: permitido;
  o histórico é o mesmo independentemente da estratégia escolhida em cada turno.
- **Conversas diferentes em paralelo**: o histórico de uma conversa nunca aparece
  no raciocínio de outra.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O chat MUST aceitar, opcionalmente, um identificador de conversa junto
  com a mensagem; sem ele, o comportamento atual do chat continua válido.
- **FR-002**: Quando nenhum identificador de conversa é informado, o sistema MUST
  criar uma nova conversa para aquele turno.
- **FR-003**: Toda resposta de sucesso do chat MUST incluir o identificador da
  conversa a que o turno pertence (nova ou existente).
- **FR-004**: Quando um identificador de conversa informado não existe, o sistema
  MUST rejeitar a requisição com um erro específico de "conversa não encontrada",
  distinto dos erros de validação e de estratégia desconhecida, sem executar o
  raciocínio.
- **FR-005**: Ao concluir um turno com sucesso, o sistema MUST registrar na conversa,
  em ordem, a mensagem do operador e a resposta final do OpsPilot.
- **FR-006**: Turnos que falham, estouram o tempo limite ou são rejeitados MUST NOT
  alterar o histórico da conversa.
- **FR-007**: Ao responder um turno de uma conversa existente, o sistema MUST
  fornecer ao raciocínio as até 12 mensagens mais recentes da conversa (anteriores
  ao turno atual), em ordem cronológica, identificando quais foram do operador e
  quais foram do OpsPilot.
- **FR-008**: O histórico MUST ser aplicado a qualquer estratégia de raciocínio
  disponível (com ou sem reflexão), sem que cada estratégia precise saber que a
  conversa existe.
- **FR-009**: As métricas de cada resposta MUST incluir a quantidade de mensagens de
  histórico efetivamente fornecidas ao raciocínio naquele turno (de 0 a 12).
- **FR-010**: Conversas e suas mensagens MUST ser persistidas no mesmo armazenamento
  durável das operações, sobrevivendo a reinícios do processo.
- **FR-011**: O registro de conversas MUST ser criado automaticamente na primeira
  inicialização, sem passos manuais, e reinicializações MUST NOT apagar ou duplicar
  conversas existentes.
- **FR-012**: Somente a pergunta do operador e a resposta final do OpsPilot entram no
  histórico; o rastro interno do raciocínio (pensamentos, ações, observações) MUST
  NOT ser registrado como mensagem da conversa.
- **FR-013**: O comportamento de conversa MUST ser verificável por testes
  automatizados sem rede e sem arquivo em disco, usando um armazenamento
  temporário em memória e uma estratégia de raciocínio determinística.

### Key Entities

- **Conversa**: sequência de trocas entre o operador e o OpsPilot. Atributos:
  identificador único e momento de criação.
- **Mensagem**: uma fala dentro de uma conversa. Atributos: conversa a que pertence,
  papel (operador ou OpsPilot), conteúdo textual, momento de registro e posição na
  ordem cronológica da conversa.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Em 100% dos turnos de acompanhamento com identificador de conversa
  válido, o raciocínio recebe as trocas anteriores daquela conversa (até o teto de
  12 mensagens).
- **SC-002**: 100% das conversas criadas antes de um reinício continuam utilizáveis
  depois dele, com o mesmo histórico.
- **SC-003**: Em nenhum caso o histórico de uma conversa aparece no raciocínio de
  outra conversa.
- **SC-004**: O número de mensagens de histórico consideradas por turno nunca passa
  de 12, independentemente do tamanho da conversa.
- **SC-005**: Clientes que já usam o chat sem identificador de conversa continuam
  recebendo respostas com o mesmo conteúdo de antes, acrescido apenas do
  identificador de conversa e da nova métrica.
- **SC-006**: A métrica de histórico reportada bate com o número real de mensagens
  fornecidas ao raciocínio em 100% das respostas.

## Assumptions

- O teto de 12 mensagens conta mensagens individuais (operador e OpsPilot
  separadamente), não pares de troca, e não inclui a mensagem do turno atual.
- Conversas não pertencem a um usuário específico: não há autenticação no chat hoje,
  e quem tem o identificador pode continuar a conversa. Controle de acesso fica fora
  de escopo.
- Não há, nesta feature, endpoint para listar, ler ou apagar conversas; nem política
  de retenção/expiração — mensagens antigas ficam guardadas indefinidamente.
- O identificador de conversa é gerado pelo sistema; o cliente não escolhe o
  identificador de uma conversa nova.
- O histórico é aplicado por composição em torno das estratégias existentes (como já
  é feito com a reflexão), de modo que as estratégias atuais não mudam de contrato
  para quem não usa conversa (CLI `arena`, `bench`).
- As conversas usam o mesmo arquivo de banco já configurado para as operações
  (specs/004); nos testes, um banco em memória e uma estratégia fake determinística
  substituem o armazenamento real e o LLM.
- A persistência dos dois registros do turno (pergunta e resposta) acontece só depois
  que a resposta final é obtida dentro do tempo limite.

# Feature Specification: Refletor de Aprendizado

**Feature Branch**: `009-learning-reflector`

**Created**: 2026-09-30

**Status**: Draft

**Input**: User description: "Refletor de aprendizado: após cada resposta, um withStructuredOutput({ hasLearning, fact }) lê a última mensagem do usuário e extrai fatos duráveis (nunca pedidos pontuais, nunca segredos) → memories.remember assíncrono; tool forget_preference."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - O OpsPilot aprende sozinho com o que o plantonista conta (Priority: P1)

No meio de um plantão, o plantonista comenta de passagem algo duradouro sobre si
("sou eu que cuido do checkout", "prefiro que você me responda em tópicos"), sem
pedir explicitamente que o OpsPilot lembre disso. Hoje esse fato só fica
guardado se o próprio OpsPilot decidir usar a ação de lembrar durante o
raciocínio. O plantonista espera que, depois da resposta, o OpsPilot extraia o
que vale a pena lembrar da mensagem dele e que isso esteja disponível nas
próximas conversas, sem atrasar a resposta atual.

**Why this priority**: é o valor central da feature. A memória semântica
(specs/008) só é útil se for alimentada, e depender de o raciocínio lembrar de
guardar é frágil. O refletor garante que o aprendizado aconteça em todo turno.

**Independent Test**: enviar ao chat, com usuário identificado, uma mensagem que
contém um fato duradouro. Verificar que a resposta chega sem esperar o
aprendizado e que, logo depois, o fato está na memória do usuário e é lembrado
numa conversa nova.

**Acceptance Scenarios**:

1. **Given** um usuário identificado, **When** ele envia uma mensagem com um fato
   duradouro sobre si e recebe a resposta, **Then** o fato, destilado numa frase
   curta e autocontida, passa a constar da memória desse usuário.
2. **Given** um fato aprendido num turno, **When** o mesmo usuário abre uma nova
   conversa com uma pergunta relacionada, **Then** o fato é fornecido ao
   raciocínio, como qualquer fato da memória.
3. **Given** uma mensagem com um fato duradouro, **When** o chat responde,
   **Then** o tempo de resposta não inclui o tempo de aprendizado.
4. **Given** um fato que o usuário já tinha na memória, **When** ele o repete com
   outras palavras, **Then** nenhuma cópia é criada (vale a deduplicação da
   memória).

---

### User Story 2 - Nunca aprender pedidos pontuais nem segredos (Priority: P1)

A maior parte do que o plantonista escreve são pedidos do momento ("abre um
incidente para o checkout", "lista os alertas") e, às vezes, dados sensíveis
colados sem querer (um token, uma senha, uma connection string). Nada disso pode
virar memória: pedidos pontuais poluiriam o contexto das próximas conversas, e
segredos guardados seriam um vazamento.

**Why this priority**: mesma prioridade que a US1, porque aprender sem esse filtro
é pior do que não aprender. Um segredo na memória é reinjetado em prompts
futuros e enviado ao provedor do modelo.

**Independent Test**: enviar mensagens que são só pedidos pontuais e mensagens
que contêm credenciais, e verificar que a memória do usuário continua vazia.

**Acceptance Scenarios**:

1. **Given** uma mensagem que é só um pedido pontual ("fecha o incidente 42"),
   **When** o turno termina, **Then** nada é aprendido.
2. **Given** uma mensagem que contém um segredo (senha, token, chave de API,
   connection string com credencial), **When** o turno termina, **Then** nada
   é aprendido, nem o segredo nem o resto da frase que o contém.
3. **Given** que a destilação proponha um fato que contém algo com cara de
   segredo, **When** o sistema vai registrá-lo, **Then** o registro é
   descartado mesmo assim (uma segunda barreira, independente do julgamento da
   destilação).
4. **Given** uma mensagem que mistura um pedido pontual e um fato duradouro
   ("sou do time de pagamentos, abre um incidente pro checkout"), **When** o
   turno termina, **Then** só o fato duradouro é aprendido.

---

### User Story 3 - Esquecer uma preferência pelo que ela diz (Priority: P2)

O plantonista mudou de ideia ("pode esquecer que eu prefiro respostas curtas") ou
percebe que o OpsPilot aprendeu algo errado. Ele quer pedir para esquecer
descrevendo a preferência em linguagem natural, sem conhecer nenhum
identificador interno.

**Why this priority**: com aprendizado automático, o usuário passa a ter fatos
que não pediu para guardar. Poder removê-los de forma natural é o contrapeso
necessário, embora a feature já entregue valor antes disso.

**Independent Test**: com uma preferência aprendida, pedir ao chat para
esquecê-la descrevendo-a com outras palavras, e verificar que ela deixa de
constar da memória.

**Acceptance Scenarios**:

1. **Given** uma preferência na memória do usuário, **When** ele pede para
   esquecê-la descrevendo-a em linguagem natural, **Then** o OpsPilot a remove e
   confirma qual fato foi esquecido.
2. **Given** um pedido para esquecer algo que não tem correspondente
   suficientemente parecido na memória, **When** o OpsPilot tenta esquecer,
   **Then** nada é removido e ele informa que não encontrou.
3. **Given** um pedido para esquecer, **When** ele é atendido, **Then** apenas
   fatos do próprio usuário podem ser removidos.

---

### Edge Cases

- **Sem usuário identificado**: nenhum aprendizado acontece (não há de quem
  lembrar).
- **Turno que falha, estoura o tempo ou é rejeitado**: nada é aprendido daquele
  turno.
- **Falha no aprendizado** (destilação indisponível, resposta malformada,
  memória indisponível): a resposta ao usuário já foi entregue e não é afetada;
  a falha fica registrada em log e o fato daquele turno é simplesmente perdido.
- **Destilação diz que há aprendizado, mas o fato vem vazio**: tratado como "não
  há aprendizado".
- **Fato longo demais**: descartado. A memória guarda frases curtas, e um fato
  de mais de 500 caracteres indica que a destilação não resumiu.
- **O raciocínio já guardou o fato explicitamente no mesmo turno**: o
  aprendizado automático não cria cópia (deduplicação da memória).
- **Vários turnos seguidos e rápidos do mesmo usuário**: cada turno é aprendido
  de forma independente; a deduplicação evita repetição.
- **Encerramento do serviço com aprendizado pendente**: pode ser perdido; não há
  fila durável.
- **Conteúdo da resposta do OpsPilot**: nunca é fonte de aprendizado; só a
  mensagem do usuário é considerada (o OpsPilot não "aprende" o que ele mesmo
  disse).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Após cada turno de chat concluído com sucesso e com usuário
  identificado, o sistema MUST analisar a mensagem do usuário daquele turno e
  decidir se ela contém um fato duradouro sobre o usuário.
- **FR-002**: A análise MUST produzir um resultado estruturado com dois campos:
  se há aprendizado e, quando houver, o fato destilado numa frase curta e
  autocontida (compreensível fora da conversa).
- **FR-003**: Quando há aprendizado, o fato MUST ser registrado na memória do
  usuário com as mesmas regras da memória semântica (deduplicação, isolamento
  por usuário).
- **FR-004**: A análise e o registro MUST acontecer depois que a resposta é
  entregue, sem aumentar o tempo de resposta do turno e sem alterar o seu
  conteúdo.
- **FR-005**: A análise MUST NOT considerar como aprendizado pedidos pontuais
  (ações ou consultas do momento), estado de alertas/incidentes, nem
  informação que só vale para a conversa atual.
- **FR-006**: A análise MUST NOT produzir fatos que contenham segredos (senhas,
  tokens, chaves de API, credenciais em URLs/connection strings, chaves
  privadas).
- **FR-007**: Independentemente do julgamento da análise, o sistema MUST descartar
  antes do registro qualquer fato que contenha padrões reconhecíveis de segredo.
- **FR-008**: Falhas na análise ou no registro MUST NOT afetar a resposta já
  entregue nem turnos seguintes, e MUST ser registradas em log sem incluir o
  conteúdo da mensagem do usuário.
- **FR-009**: Sem usuário identificado, ou quando o turno falha, MUST NOT haver
  análise nem aprendizado.
- **FR-010**: Só a mensagem do usuário do turno atual MUST ser usada como fonte;
  a resposta do OpsPilot e o histórico anterior MUST NOT ser fonte de fatos.
- **FR-011**: O raciocínio MUST dispor, quando o usuário está identificado, de uma
  ação para esquecer uma preferência a partir de uma descrição em linguagem
  natural: remove o fato do usuário mais parecido com a descrição, desde que a
  semelhança seja suficiente, e informa qual fato foi removido (ou que nenhum
  foi encontrado).
- **FR-012**: A ação de esquecer por descrição MUST **substituir** a ação de
  esquecer por identificador da memória semântica (specs/008): o raciocínio passa a
  ter uma única forma de esquecer, e os fatos lembrados deixam de ser
  apresentados com seu identificador. *(Decisão padrão — opção A — adotada sem
  resposta explícita à Q1; revisável.)*
- **FR-013**: O comportamento MUST ser verificável por testes automatizados sem
  rede, com uma análise determinística fake, incluindo a garantia de que o
  aprendizado não atrasa a resposta e de que segredos nunca chegam à memória.

### Key Entities

- **Resultado da análise de aprendizado**: saída estruturada por turno, com
  "há aprendizado" (sim/não) e "fato" (texto curto, presente só quando há
  aprendizado). É efêmero e não é persistido.
- **Fato de memória**: o mesmo da memória semântica (specs/008). Esta feature
  acrescenta uma nova origem (o aprendizado automático) e troca a forma de
  remoção pelo raciocínio (de identificador para descrição).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Em um conjunto de mensagens de teste com fatos duradouros
  explícitos, pelo menos 90% viram fatos na memória do usuário sem que ele peça.
- **SC-002**: Em um conjunto de mensagens de teste com segredos, 0% resulta em
  qualquer fato guardado.
- **SC-003**: Em um conjunto de mensagens de teste que são apenas pedidos
  pontuais, no máximo 5% resultam em fato guardado.
- **SC-004**: O tempo de resposta de um turno com aprendizado não difere do
  mesmo turno sem aprendizado, e a resposta nunca espera a análise.
- **SC-005**: 100% das falhas de aprendizado deixam a resposta do turno intacta.
- **SC-006**: Um plantonista consegue remover uma preferência aprendida em um
  único pedido em linguagem natural, sem conhecer identificadores.

## Assumptions

- **Decisões técnicas informadas pelo usuário** (detalhadas em `/speckit-plan`): a
  análise é uma chamada ao modelo com saída estruturada
  (`withStructuredOutput({ hasLearning, fact })`), o registro é
  `memories.remember` disparado de forma assíncrona (sem `await` no caminho da
  resposta), e a remoção por descrição é a tool `forget_preference`.
- A análise usa o mesmo provedor/modelo já configurado para o chat; cada turno
  com usuário identificado passa a custar uma chamada extra ao modelo.
- Cada mensagem gera **no máximo um** fato por turno; mensagens com vários fatos
  guardam o mais relevante (os outros podem ser aprendidos se repetidos depois).
- A "semelhança suficiente" para esquecer por descrição reaproveita o limiar de
  relevância da memória semântica (0,3), tomando o fato mais similar do usuário.
- A barreira contra segredos (FR-007) é uma verificação por padrões conhecidos
  (formatos de token/chave, pares `senha=`/`password:`, URLs com credencial,
  blocos de chave privada). Ela é propositalmente conservadora: prefere
  descartar um fato legítimo a guardar um segredo.
- Não há fila durável: aprendizados pendentes podem se perder num restart, o que
  é aceitável porque o fato tende a reaparecer em conversas futuras.
- `arena`, `bench` e o servidor MCP não usam `userId` e, portanto, não
  aprendem.
- A ação explícita de registrar um fato durante o raciocínio (specs/008)
  continua existindo; o aprendizado automático a complementa, e a deduplicação
  evita cópias quando os dois registram o mesmo fato.
- A operação de esquecer por identificador continua existindo no armazenamento
  da memória (é usada pela remoção por descrição); só deixa de ser uma ação do
  raciocínio.

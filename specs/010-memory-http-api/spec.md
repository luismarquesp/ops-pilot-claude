# Feature Specification: API HTTP de Memória

**Feature Branch**: `010-memory-http-api`

**Created**: 2026-10-02

**Status**: Draft

**Input**: User description: "Endpoints HTTP de memória: POST /memories (userId + fact → remember, com dedup; 201 criado / 200 duplicado), GET /memories?userId= (lista fatos do usuário, sem embedding), DELETE /memories/:id?userId= (forget restrito ao dono; 204 / 404). Validação zod na borda, reaproveitando o MemoryStore (SqliteMemoryStore) da specs/008 sem passar pelo LLM; a barreira containsSecret da specs/009 também vale para fatos enviados pela API."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Registrar um fato diretamente (Priority: P1)

Um operador (ou um script de onboarding) quer cadastrar fatos sobre um
plantonista — "é responsável pelo checkout", "prefere respostas em tópicos" —
sem precisar conversar com o OpsPilot e sem depender de o modelo decidir
guardá-los. Ele envia o fato para a API e recebe a confirmação imediata de que
ele foi guardado (ou de que um equivalente já existia).

**Why this priority**: hoje a única porta de entrada para a memória é o chat,
que custa chamadas ao modelo e não é determinística. Cadastro direto é o que
destrava semear e testar a memória.

**Independent Test**: enviar um fato para um usuário, verificar a confirmação
de criação; enviar de novo uma variação quase idêntica e verificar que a
resposta indica "já existia", com o mesmo identificador.

**Acceptance Scenarios**:

1. **Given** um usuário sem fatos, **When** um fato é enviado para ele, **Then**
   a resposta confirma a criação e devolve o fato guardado com identificador,
   usuário, texto e momento de criação.
2. **Given** um fato já guardado, **When** um fato quase idêntico é enviado para o
   mesmo usuário, **Then** a resposta indica que já existia e devolve o fato
   original, sem criar outro.
3. **Given** um fato que contém algo com cara de segredo (senha, token, chave,
   credencial em URL), **When** ele é enviado, **Then** é rejeitado com um erro
   específico e nada é guardado.
4. **Given** uma requisição sem usuário, sem fato, com fato vazio ou com fato
   longo demais, **When** ela é enviada, **Then** é rejeitada como entrada
   inválida, no mesmo formato de erro de validação já usado pela API.
5. **Given** um fato cadastrado pela API, **When** o mesmo usuário conversa com o
   OpsPilot sobre algo relacionado, **Then** o fato é lembrado como qualquer
   outro da memória.

---

### User Story 2 - Consultar o que o OpsPilot sabe sobre um usuário (Priority: P2)

Com o aprendizado automático (specs/009), o OpsPilot passa a guardar fatos que
ninguém digitou explicitamente. O plantonista (ou quem administra o OpsPilot)
quer ver a lista completa do que está guardado sobre ele, para conferir se está
correto.

**Why this priority**: transparência — sem isso, não há como auditar o que foi
aprendido. Depende de haver fatos (US1 ou chat) para ter valor.

**Independent Test**: cadastrar fatos para dois usuários e verificar que a
listagem de um traz só os dele, do mais recente para o mais antigo, sem dados
internos de comparação.

**Acceptance Scenarios**:

1. **Given** um usuário com fatos, **When** sua memória é listada, **Then** vêm
   todos os fatos dele, do mais recente para o mais antigo, cada um com
   identificador, texto e momento de criação.
2. **Given** um usuário sem fatos, **When** sua memória é listada, **Then** a
   lista vem vazia (não é um erro).
3. **Given** fatos de vários usuários, **When** a memória de um é listada,
   **Then** nenhum fato de outro usuário aparece.
4. **Given** uma listagem sem usuário informado, **When** ela é pedida, **Then**
   é rejeitada como entrada inválida.

---

### User Story 3 - Remover um fato específico (Priority: P3)

Ao revisar a lista, o plantonista encontra um fato errado ou desatualizado e
quer removê-lo pelo identificador, de forma precisa, sem depender da busca por
semelhança do chat.

**Why this priority**: complementa a listagem; o chat já oferece uma forma de
esquecer (por descrição), então esta é a via precisa, não a única.

**Independent Test**: cadastrar um fato, removê-lo pelo identificador e
verificar que some da listagem; tentar removê-lo informando outro usuário e
verificar que nada muda.

**Acceptance Scenarios**:

1. **Given** um fato do usuário, **When** ele é removido informando o
   identificador e o próprio usuário, **Then** a remoção é confirmada e o fato
   some da listagem e do que o OpsPilot lembra.
2. **Given** um fato de outro usuário, **When** alguém tenta removê-lo
   informando um usuário diferente do dono, **Then** a resposta é "não
   encontrado" e o fato permanece.
3. **Given** um identificador inexistente, **When** se tenta removê-lo, **Then**
   a resposta é "não encontrado".
4. **Given** um identificador malformado ou sem usuário informado, **When** se
   tenta remover, **Then** é rejeitado como entrada inválida.

---

### Edge Cases

- **Fato com espaços nas pontas**: é guardado sem eles (mesma normalização do
  chat).
- **Mesmo fato para usuários diferentes**: cada um tem o seu (dedup é por
  usuário).
- **Remover fato alheio**: responde exatamente como um fato inexistente — a API
  não revela se o identificador existe para outro usuário.
- **Mecanismo de significado indisponível ao registrar**: erro interno, nada é
  guardado. Listar e remover não dependem dele.
- **Segredo detectado**: a resposta de erro não ecoa o texto enviado.
- **Usuário com muitos fatos**: a listagem devolve todos (volumes esperados de
  dezenas a poucas centenas por usuário).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST permitir registrar um fato para um usuário informando
  o usuário e o texto do fato, sem passar pelo raciocínio do OpsPilot.
- **FR-002**: O registro MUST aplicar as mesmas regras da memória semântica:
  isolamento por usuário e deduplicação (similaridade acima de 0,92 devolve o
  fato existente em vez de criar outro).
- **FR-003**: A resposta do registro MUST distinguir "criado" de "já existia" e
  devolver o fato correspondente (identificador, usuário, texto, momento de
  criação), nunca a representação interna de significado.
- **FR-004**: O registro MUST rejeitar, com um erro específico e distinto do erro
  de validação, fatos que contenham padrões reconhecíveis de segredo — a mesma
  barreira do aprendizado automático (specs/009) — sem guardar nada e sem ecoar o
  texto na resposta.
- **FR-005**: O sistema MUST permitir listar todos os fatos de um usuário, do mais
  recente para o mais antigo, com identificador, usuário, texto e momento de
  criação.
- **FR-006**: O sistema MUST permitir remover um fato informando seu identificador
  e o usuário dono; a remoção só ocorre se o fato pertencer a esse usuário.
- **FR-007**: A remoção de um fato inexistente ou de outro usuário MUST responder
  "não encontrado", de forma indistinguível entre os dois casos.
- **FR-008**: Toda entrada (usuário, texto do fato, identificador) MUST ser
  validada na borda com as mesmas regras já usadas pelo chat e pelas ações do
  OpsPilot (usuário: 1–128 caracteres; fato: 1–500 caracteres após remover
  espaços das pontas; identificador: formato UUID), respondendo com o formato de
  erro de validação existente.
- **FR-009**: Fatos registrados, listados ou removidos pela API MUST ser os mesmos
  usados pelo chat: um fato registrado aqui é lembrado no chat, e um removido
  aqui deixa de ser lembrado.
- **FR-010**: O comportamento MUST ser verificável por testes automatizados sem
  rede, com armazenamento temporário em memória e representação de significado
  determinística.

### Key Entities

- **Fato de memória**: o mesmo da memória semântica (specs/008) — identificador,
  usuário dono, texto, momento de criação. Esta feature só adiciona formas de
  acesso direto; não muda o que é guardado.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um fato pode ser cadastrado, conferido na listagem e removido em
  três requisições, sem nenhuma chamada ao modelo de linguagem.
- **SC-002**: Em 100% das requisições, nenhuma listagem ou remoção afeta ou
  revela fatos de outro usuário.
- **SC-003**: 0% dos fatos com padrão de segredo enviados pela API são guardados.
- **SC-004**: Cadastrar o mesmo fato (ou variação quase idêntica) repetidas vezes
  para o mesmo usuário resulta em exatamente 1 fato guardado.
- **SC-005**: Um fato cadastrado pela API é lembrado pelo chat do mesmo usuário
  na primeira pergunta relacionada.

## Assumptions

- **Decisões técnicas informadas pelo usuário** (detalhadas em `/speckit-plan`):
  `POST /memories` (`{ userId, fact }` → 201 criado / 200 duplicado),
  `GET /memories?userId=` (lista sem embedding), `DELETE /memories/:id?userId=`
  (204 / 404); validação zod na borda; reaproveita o `MemoryStore`
  (`SqliteMemoryStore`) da specs/008 e a barreira `containsSecret` da specs/009.
- A listagem exige uma nova operação de leitura no armazenamento da memória
  (listar fatos de um usuário); as demais reaproveitam as existentes.
- **Sem autenticação**, como o restante da API hoje: quem souber o identificador de
  um usuário pode ler e alterar a memória dele. Controle de acesso fica fora de
  escopo e é um risco aceito no ambiente atual (uso interno).
- Sem paginação nem filtros na listagem nesta feature.
- Não há edição de fato; corrigir = remover + cadastrar.
- O chat e as ações do OpsPilot (`remember_fact`, `forget_preference`, aprendizado
  automático) continuam como estão.

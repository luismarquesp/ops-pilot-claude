# Feature Specification: Memória Semântica por Usuário

**Feature Branch**: `008-semantic-memory`

**Created**: 2026-09-30

**Status**: Draft

**Input**: User description: "Memória semântica: MemoryStore por userId - remember (dedup > 0.92), recall top-3 produto escalar (min 0.3), forget; tabela memories, embedding all-MiniLM-L6-v2 local em BLOB; /chat ganha userId e injeta o recall no prompt; teste: recall acha fato sem palavra em comum. @huggingface/transformers com pooling: mean + normalize: true e lazy singleton src/memory/embeddings.ts e src/memory/memory-store.ts; colunas de memories (id, user_id, fact, embedding, created_at)"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - O OpsPilot lembra fatos do plantonista entre conversas (Priority: P1)

Um plantonista já contou ao OpsPilot fatos duradouros sobre si e seu contexto de
trabalho ("sou responsável pelo serviço de pagamentos", "prefiro respostas curtas",
"nosso banco principal roda em réplica tripla"). Dias depois, em uma conversa
totalmente nova, ele pergunta algo relacionado usando outras palavras. Ele espera
que o OpsPilot leve em conta os fatos relevantes que já conhece sobre ele, sem
precisar repeti-los.

**Why this priority**: é o valor central da feature. A conversa persistente
(specs/007) só lembra das últimas trocas de *uma* conversa; a memória semântica
lembra do *usuário*, através de conversas, e encontra fatos pelo significado — não
por coincidência de palavras.

**Independent Test**: registrar um fato para um usuário, abrir uma conversa nova
para o mesmo usuário com uma pergunta semanticamente relacionada que não
compartilha nenhuma palavra com o fato, e verificar que o fato foi fornecido ao
raciocínio daquele turno.

**Acceptance Scenarios**:

1. **Given** um usuário com fatos registrados, **When** ele envia uma mensagem ao
   chat identificando-se, **Then** até 3 fatos dele, os mais relacionados à
   mensagem, são fornecidos ao raciocínio junto com a pergunta.
2. **Given** um fato registrado e uma pergunta com o mesmo significado mas sem
   nenhuma palavra em comum com o fato, **When** a memória é consultada com essa
   pergunta, **Then** o fato é encontrado.
3. **Given** um usuário cujos fatos não têm relação suficiente com a mensagem,
   **When** ele envia a mensagem, **Then** nenhum fato é fornecido ao raciocínio
   e a pergunta segue inalterada.
4. **Given** uma mensagem enviada sem identificação de usuário, **When** o chat
   responde, **Then** o comportamento é exatamente o de hoje (nenhuma memória
   consultada).

---

### User Story 2 - Registrar fatos sem duplicar (Priority: P2)

O mesmo fato tende a ser dito várias vezes, com pequenas variações ("sou do time
de pagamentos" / "eu sou do time de pagamentos."). O sistema deve registrar fatos
novos, mas reconhecer quando um fato praticamente idêntico já existe para aquele
usuário e não criar uma cópia.

**Why this priority**: sem deduplicação, a memória enche de quase-cópias que
ocupam as 3 vagas da consulta com a mesma informação, empobrecendo o contexto.

**Independent Test**: registrar um fato, registrar uma variação quase idêntica
para o mesmo usuário, e verificar que só um fato existe; registrar a mesma
variação para outro usuário e verificar que ela é aceita para ele.

**Acceptance Scenarios**:

1. **Given** um usuário sem fatos, **When** um fato é registrado, **Then** ele
   passa a existir na memória desse usuário.
2. **Given** um usuário com um fato registrado, **When** um fato quase idêntico
   (similaridade acima de 0,92) é registrado para o mesmo usuário, **Then** nenhum
   fato novo é criado e o registro existente é devolvido.
3. **Given** um usuário com um fato registrado, **When** um fato diferente
   (similaridade até 0,92) é registrado, **Then** um novo fato é criado.

---

### User Story 3 - Esquecer um fato (Priority: P3)

Um fato deixa de ser verdade (o plantonista trocou de time) ou foi registrado por
engano. Deve ser possível remover esse fato da memória do usuário para que ele
nunca mais seja fornecido ao raciocínio.

**Why this priority**: correção e privacidade — importante, mas a memória já
entrega valor antes de existir a remoção.

**Independent Test**: registrar um fato, removê-lo e verificar que consultas
posteriores do mesmo usuário nunca mais o retornam.

**Acceptance Scenarios**:

1. **Given** um fato registrado de um usuário, **When** ele é esquecido, **Then**
   consultas seguintes desse usuário não o retornam.
2. **Given** um fato de outro usuário, **When** um usuário tenta esquecê-lo,
   **Then** o fato não é removido.

---

### Edge Cases

- **Isolamento entre usuários**: fatos de um usuário nunca aparecem na consulta,
  deduplicação ou remoção de outro usuário.
- **Usuário sem nenhum fato**: a consulta devolve lista vazia e o chat segue como
  se não houvesse memória.
- **Mais de 3 fatos relevantes**: apenas os 3 mais similares são usados, do mais
  para o menos similar.
- **Fato no limiar**: similaridade exatamente 0,3 é incluída na consulta;
  similaridade exatamente 0,92 **não** é considerada duplicata.
- **Fato vazio ou só espaços**: rejeitado como entrada inválida.
- **Identificação de usuário malformada** (vazia, tipo errado, longa demais):
  rejeitada com o mesmo formato de erro de validação já usado pelo chat.
- **Esquecer fato inexistente**: operação sem efeito, sinalizada como "nada
  removido", sem erro fatal.
- **Primeira utilização após iniciar o serviço**: o preparo do mecanismo de
  significado acontece só quando a memória é usada pela primeira vez; usos
  seguintes reaproveitam o mesmo preparo.
- **Memória com conversa persistente**: memória (por usuário) e histórico (por
  conversa) se somam no mesmo turno sem interferir um no outro.
- **Turno que falha ou estoura o tempo**: a consulta à memória não altera nada; o
  turno segue as regras de falha já existentes. Fatos registrados pelo OpsPilot
  *durante* um turno que depois falha permanecem registrados (a ação já foi
  executada).
- **Mecanismo de significado indisponível** (ex.: modelo não pôde ser carregado):
  turnos com usuário identificado falham com erro interno; turnos sem usuário não
  são afetados.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST manter uma memória de fatos separada por usuário, onde
  cada fato é um texto curto em linguagem natural.
- **FR-002**: O sistema MUST permitir registrar um fato para um usuário; se já
  existir um fato desse usuário com similaridade de significado **maior que 0,92**,
  nenhum fato novo é criado e o existente é devolvido.
- **FR-003**: O sistema MUST permitir consultar a memória de um usuário a partir de
  um texto, devolvendo **até 3** fatos ordenados do mais para o menos similar,
  descartando os de similaridade **menor que 0,3**.
- **FR-004**: A consulta MUST encontrar fatos por proximidade de significado, sem
  depender de palavras em comum entre o texto consultado e o fato.
- **FR-005**: O sistema MUST permitir esquecer um fato de um usuário; a remoção só
  afeta fatos do próprio usuário e informa se algo foi removido.
- **FR-006**: O chat MUST aceitar, opcionalmente, uma identificação de usuário;
  sem ela, o comportamento atual do chat (incluindo conversa persistente) continua
  idêntico.
- **FR-007**: Quando o usuário é identificado, o sistema MUST consultar a memória
  com a mensagem do turno e fornecer os fatos encontrados ao raciocínio, junto com
  a pergunta, para qualquer estratégia disponível (com ou sem reflexão), sem que
  cada estratégia precise saber que a memória existe.
- **FR-008**: Quando a consulta não encontra fatos, a pergunta fornecida ao
  raciocínio MUST ser exatamente a mesma que seria sem memória.
- **FR-009**: As métricas de cada resposta MUST incluir a quantidade de fatos de
  memória fornecidos ao raciocínio naquele turno (de 0 a 3).
- **FR-010**: Fatos MUST ser persistidos no mesmo armazenamento durável das
  operações e conversas, guardando para cada fato: identificador, usuário, texto,
  representação de significado e momento de criação; eles sobrevivem a reinícios.
- **FR-011**: O registro de fatos MUST ser criado automaticamente na primeira
  inicialização, sem passos manuais, e reinicializações MUST NOT apagar ou
  duplicar fatos existentes.
- **FR-012**: A representação de significado dos fatos MUST ser calculada
  localmente, sem enviar o texto dos fatos a serviços externos.
- **FR-013**: Fatos entram e saem da memória pelo próprio OpsPilot durante o chat:
  quando o usuário está identificado, o raciocínio dispõe de uma ação para
  registrar um fato duradouro e outra para esquecer um fato, ambas restritas ao
  usuário do turno — o raciocínio nunca escolhe nem vê a identificação de outro
  usuário. Sem usuário identificado, essas ações não ficam disponíveis. Os fatos
  fornecidos ao raciocínio carregam seu identificador, para que possam ser
  esquecidos. *(Decisão padrão — opção A — adotada no `/speckit-plan` sem resposta
  explícita à Q1; revisável.)*
- **FR-014**: O comportamento da memória MUST ser verificável por testes
  automatizados com armazenamento temporário em memória; a regra de consulta,
  deduplicação e isolamento MUST ser testável com uma representação de significado
  determinística, e existe pelo menos um teste com o mecanismo real provando que um
  fato é encontrado por uma pergunta sem nenhuma palavra em comum.

### Key Entities

- **Usuário**: quem conversa com o OpsPilot, identificado por um identificador
  opaco informado pelo cliente. Não há cadastro de usuários nesta feature.
- **Fato de memória**: uma informação duradoura sobre um usuário. Atributos:
  identificador único, usuário dono, texto do fato, representação de significado
  (usada para comparar fatos e perguntas) e momento de criação.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um fato registrado é encontrado por uma pergunta de mesmo significado
  sem nenhuma palavra em comum com ele (verificado por teste automatizado).
- **SC-002**: Em 100% das consultas, nenhum fato de outro usuário é devolvido.
- **SC-003**: Nenhuma consulta devolve mais de 3 fatos nem fatos abaixo do limiar
  mínimo de similaridade.
- **SC-004**: Registrar o mesmo fato (ou uma variação quase idêntica) repetidas
  vezes para o mesmo usuário resulta em exatamente 1 fato guardado.
- **SC-005**: Clientes que usam o chat sem identificar o usuário recebem respostas
  com o mesmo conteúdo de antes, acrescido apenas da nova métrica.
- **SC-006**: 100% dos fatos registrados antes de um reinício continuam
  consultáveis depois dele.
- **SC-007**: Após o primeiro uso, consultar a memória acrescenta menos de 1
  segundo ao tempo de resposta de um turno de chat.

## Assumptions

- **Decisões técnicas informadas pelo usuário** (detalhadas em `/speckit-plan`):
  modelo de embeddings `all-MiniLM-L6-v2` rodando localmente via
  `@huggingface/transformers`, com `pooling: "mean"` e `normalize: true`, carregado
  como singleton preguiçoso em `src/memory/embeddings.ts`; `MemoryStore` com
  `remember`/`recall`/`forget` em `src/memory/memory-store.ts`; tabela `memories`
  com colunas `id`, `user_id`, `fact`, `embedding` (BLOB) e `created_at`, no mesmo
  arquivo `OPSPILOT_DB`. Como os vetores são normalizados, "similaridade" é o
  produto escalar (equivalente ao cosseno).
- A identificação de usuário é um texto opaco (ex.: login ou e-mail) confiado ao
  cliente; não há autenticação no chat hoje e controle de acesso fica fora de
  escopo.
- A busca compara a pergunta contra todos os fatos do usuário (varredura linear);
  volumes esperados são de dezenas a poucas centenas de fatos por usuário, sem
  necessidade de índice vetorial.
- A consulta à memória usa apenas a mensagem atual do turno (não o histórico da
  conversa).
- Na deduplicação, o fato existente é mantido como está (texto e data originais);
  não há atualização/mescla de fatos.
- O modelo de significado é predominantemente treinado em inglês; o teste de "sem
  palavra em comum" usa um par fato/pergunta escolhido para passar com folga acima
  do limiar de 0,3, e a qualidade para português é melhor esforço.
- O teste com o mecanismo real requer o modelo disponível localmente (baixado e
  cacheado na primeira execução); os demais testes usam uma representação
  determinística fake, sem rede.
- Não há, nesta feature, listagem de fatos, expiração/retenção automática nem
  extração automática de fatos a partir das conversas.

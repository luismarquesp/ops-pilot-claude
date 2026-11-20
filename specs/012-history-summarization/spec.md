# Feature Specification: Sumarização de Histórico (Pruning)

**Feature Branch**: `012-history-summarization`

**Created**: 2026-10-03

**Status**: Draft

**Input**: User description: "Sumarização de histórico (pruning): tabela conversation_summaries; o que sai das 8 mensagens recentes vira resumo de ~150 tokens preservando decisões, fatos e pendências, MESCLADO ao resumo anterior e persistido - refeito só quando 8 novas mensagens saem da janela, nunca a cada request. Resumo entra no contexto; evento \"summarize\". Com teste fake"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Conversa longa sem perder o que importa (Priority: P1)

Um plantonista conversa com o OpsPilot ao longo de um incidente inteiro —
dezenas de turnos. Hoje só as 12 últimas mensagens entram no raciocínio: o que
foi decidido no começo ("vamos fazer rollback do checkout", "o DBA já foi
acionado") simplesmente some, e o contexto cresce até esse teto sem nenhuma
compressão. Com a sumarização, as mensagens mais antigas que saem da janela
recente viram um resumo curto que preserva decisões, fatos e pendências, e
esse resumo acompanha a conversa até o fim.

**Why this priority**: é o valor central — continuidade em conversas longas
com contexto limitado. Sozinha já entrega o benefício.

**Independent Test**: com um resumidor falso e determinístico, conduzir uma
conversa até que 8 mensagens saiam da janela recente e verificar que o próximo
turno recebe o resumo no contexto e que só as mensagens ainda não resumidas
entram por extenso.

**Acceptance Scenarios**:

1. **Given** uma conversa com até 15 mensagens gravadas, **When** um novo turno
   começa, **Then** nenhum resumo é gerado e todas as mensagens entram por
   extenso, como hoje.
2. **Given** uma conversa em que 8 mensagens ainda não resumidas ficaram fora
   das 8 mais recentes (16 mensagens não resumidas), **When** um novo turno
   começa, **Then** essas 8 mensagens mais antigas viram resumo, o resumo é
   guardado, e o turno recebe resumo + as 8 mensagens recentes.
3. **Given** uma conversa que já tem resumo, **When** um turno começa sem que
   8 novas mensagens tenham saído da janela, **Then** o resumo guardado é
   reutilizado sem ser refeito.
4. **Given** um resumo existente, **When** mais 8 mensagens saem da janela,
   **Then** o novo resumo é a **mescla** do resumo anterior com essas 8
   mensagens — o que estava no resumo antigo continua representado.
5. **Given** a conversa retomada depois de reiniciar o serviço, **When** um
   novo turno começa, **Then** o resumo guardado é usado (persistência).

---

### User Story 2 - Ver quando a conversa foi resumida (Priority: P2)

Quem opera ou depura o OpsPilot quer saber, pela própria resposta do chat, que
um turno disparou sumarização e o que entrou no resumo — sem precisar olhar o
banco.

**Why this priority**: observabilidade e confiança no que o agente "lembra";
depende da US1.

**Independent Test**: no turno que dispara a sumarização, verificar que o
rastro contém um evento `summarize` com o resumo novo e quantas mensagens ele
absorveu; nos demais turnos, o evento não aparece.

**Acceptance Scenarios**:

1. **Given** um turno que gera ou refaz o resumo, **When** a resposta é
   devolvida, **Then** o rastro começa com um evento do tipo `summarize`
   contendo o texto do resumo e o número de mensagens absorvidas.
2. **Given** um turno que só reutiliza o resumo guardado, **When** a resposta é
   devolvida, **Then** o rastro não tem evento `summarize`.
3. **Given** qualquer turno com resumo no contexto, **When** a resposta é
   devolvida, **Then** as métricas de contexto mostram a parcela estimada do
   resumo separada das demais fontes.

---

### Edge Cases

- Conversa nova ou com poucas mensagens → nada muda em relação a hoje.
- O resumidor falha (erro ou estouro de tempo) → o turno **não** falha: segue
  com o resumo anterior (se houver) mais todas as mensagens não resumidas por
  extenso; nada é gravado e a sumarização é tentada de novo no próximo turno.
- O resumidor devolve texto vazio → tratado como falha (resumo anterior
  preservado).
- O resumo sai bem maior que ~150 tokens → é aceito (meta, não teto rígido),
  mas o tamanho fica visível nas métricas de contexto.
- Muitas mensagens acumuladas de uma vez (ex.: conversa anterior à feature com
  40 mensagens) → um único resumo absorve todas as que estão fora da janela,
  em uma só chamada, sem loop por lote.
- Dois turnos simultâneos na mesma conversa disparando sumarização → o resumo
  final não pode regredir (perder mensagens já absorvidas) nem absorver a mesma
  mensagem duas vezes.
- O turno falha ou estoura o tempo **depois** de um resumo ser gerado → o
  resumo já gravado permanece válido (ele descreve mensagens antigas, que não
  mudam).
- Memória semântica e resumo coexistem: fatos do usuário (specs/008) e resumo
  da conversa são fontes distintas.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST manter, por conversa, no máximo um resumo
  persistido, junto com a marca de até qual mensagem ele cobre.
- **FR-002**: A janela recente MUST ser de 8 mensagens; mensagens ainda não
  resumidas que estão fora dessa janela são "pendentes".
- **FR-003**: Quando houver 8 ou mais mensagens pendentes no início de um
  turno, o sistema MUST gerar um novo resumo que mescla o resumo anterior (se
  houver) com **todas** as mensagens pendentes, persisti-lo e avançar a marca
  de cobertura. Com menos de 8 pendentes, MUST NOT chamar o resumidor.
- **FR-004**: O resumo MUST ter como meta ~150 tokens e MUST preservar
  decisões tomadas, fatos estabelecidos (serviços, incidentes, causas,
  responsáveis) e pendências em aberto; conversa fiada e repetições podem ser
  descartadas.
- **FR-005**: O contexto do turno MUST conter, nesta ordem: fatos lembrados do
  usuário (specs/008), resumo da conversa (se houver), mensagens não resumidas
  por extenso (de 8 a 15), pergunta atual.
- **FR-006**: No turno em que um resumo é gerado, o rastro MUST incluir um
  evento `summarize` com o texto do novo resumo e o número de mensagens
  absorvidas; nos demais turnos, MUST NOT incluir.
- **FR-007**: Falha do resumidor MUST NOT falhar o turno nem alterar o resumo
  persistido (ver Edge Cases).
- **FR-008**: As métricas do chat MUST passar a separar a parcela estimada do
  resumo no detalhamento de contexto (specs/011) e `historyMessages` MUST
  continuar contando só as mensagens que entraram por extenso.
- **FR-009**: Gravações concorrentes do resumo da mesma conversa MUST NOT fazer
  a marca de cobertura retroceder.
- **FR-010**: O resumo MUST ser apagado/inválido junto com a conversa se a
  conversa deixar de existir (sem resumos órfãos).
- **FR-011**: O comportamento MUST ser testável com um resumidor falso e
  determinístico, sem modelo real nem rede, incluindo: gatilho exato no limiar
  de 8, reutilização sem nova chamada, mescla com o resumo anterior,
  persistência, falha do resumidor e evento `summarize`.

### Key Entities

- **Resumo de conversa**: pertence a uma conversa; texto do resumo, marca da
  última mensagem coberta, quantidade total de mensagens absorvidas, momento da
  última atualização.
- **Mensagens pendentes**: mensagens posteriores à marca de cobertura que já
  estão fora da janela das 8 mais recentes.
- **Evento `summarize`**: entrada do rastro do turno com o resumo novo e o
  número de mensagens que ele absorveu nesse turno.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Numa conversa de 40 turnos (80 mensagens), o resumidor é chamado
  no máximo 9 vezes — uma a cada 8 mensagens que saem da janela — e nunca em
  dois turnos consecutivos sem 8 novas mensagens pendentes.
- **SC-002**: Depois do 8º turno, o contexto de histórico de cada turno fica
  limitado a resumo + no máximo 15 mensagens, independentemente do tamanho da
  conversa — o tamanho estimado do histórico para de crescer linearmente.
- **SC-003**: Uma decisão tomada nos primeiros turnos continua presente no
  resumo depois de pelo menos duas remesclagens (verificável com o resumidor
  falso e, manualmente, com o real).
- **SC-004**: 100% dos turnos em que o resumidor falha completam normalmente.
- **SC-005**: Em média, o resumo real fica em torno de 150 tokens estimados
  (tolerância de até ~200) numa conversa de exemplo.

## Assumptions

- A janela recente passa de 12 (specs/007) para 8 mensagens; entre uma
  sumarização e a próxima, as pendentes (até 7) **continuam por extenso** no
  contexto, para nada ficar fora do contexto entre um lote e outro. Por isso o
  histórico por extenso varia de 8 a 15 mensagens.
- A sumarização acontece **antes** de rodar o raciocínio, no próprio turno que
  atinge o limiar (o resumo novo já vale para esse turno); o custo extra fica
  restrito a esses turnos.
- O resumidor lê só o resumo anterior e as mensagens pendentes — nunca a
  conversa inteira.
- O resumo é guardado no mesmo banco das conversas, numa tabela própria de
  resumos de conversa; a cobertura é marcada pelo identificador sequencial das
  mensagens.
- O resumo não passa pela barreira de segredos da memória (specs/009): ele
  deriva de mensagens que já estão gravadas por extenso, sem ampliar exposição.
- Não há endpoint para consultar ou apagar resumos nesta versão.
- O resumidor real usa o mesmo modelo do agente; o uso de tokens dele entra no
  `promptTokens` do turno (specs/011), já que acontece dentro do turno.

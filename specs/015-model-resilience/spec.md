# Feature Specification: Resiliência de Modelo (retry + modelos reserva)

**Feature Branch**: `015-model-resilience`

**Created**: 2026-10-21

**Status**: Draft

**Input**: User description: "Resiliência de modelo: env OPENROUTER_MODEL_FALLBACK; fábrica model.ts: withRetry no primário; withFallbacks([reservas]); trace: evento \"fallback\", metrics.modelUsed; caso nada funcione, 503"

## Contexto

Hoje o OpsPilot depende de um único modelo de linguagem. Quando o provedor
devolve limite de requisições, fica indisponível ou falha de forma passageira,
o turno inteiro cai com `500 internal_error`, sem dizer ao cliente que o
problema é do modelo e não do OpsPilot. Isso foi observado na validação do
specs/014: com a cota diária do modelo gratuito esgotada, todos os turnos
responderam 500.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - O turno sobrevive a uma falha do modelo principal (Priority: P1)

Um plantonista pergunta algo ao OpsPilot no meio de um incidente, e o modelo
principal está com limite de requisições estourado ou instável. Em vez de
receber um erro, ele recebe a resposta normalmente. O sistema primeiro
reinsiste no modelo principal algumas vezes, para cobrir falhas passageiras.
Se o modelo continuar falhando, passa para os modelos reserva configurados,
na ordem.

**Why this priority**: é o valor central. Um copiloto de plantão que cai
junto com um provedor de modelo é inútil justamente na hora do incidente.

**Independent Test**: com um modelo principal simulado que sempre falha e uma
reserva simulada que responde, enviar uma pergunta e verificar que a resposta
chega com sucesso e vem da reserva.

**Acceptance Scenarios**:

1. **Given** um modelo principal que falha uma vez e depois responde, **When**
   o turno roda, **Then** a resposta vem do modelo principal, sem passar para
   nenhuma reserva.
2. **Given** um modelo principal que falha em todas as tentativas e uma
   reserva configurada que responde, **When** o turno roda, **Then** a
   resposta vem da reserva.
3. **Given** duas reservas configuradas em que a primeira também falha,
   **When** o turno roda, **Then** a segunda reserva é usada.
4. **Given** reservas configuradas e o modelo principal saudável, **When** o
   turno roda, **Then** nenhuma reserva é chamada.
5. **Given** qualquer parte do turno que consulta o modelo (roteador,
   estratégias, crítico da reflexão, resumidor, refletor de aprendizado),
   **When** o modelo principal falha, **Then** essa parte também se beneficia
   das tentativas e das reservas.

---

### User Story 2 - Falha total vira um erro claro e honesto (Priority: P2)

Quando nem o modelo principal nem nenhuma reserva respondem, quem chama o
OpsPilot precisa saber que o serviço de modelo está indisponível, que isso é
temporário e que não é um defeito do OpsPilot. Assim, um cliente ou um
operador pode tentar de novo mais tarde em vez de abrir um chamado de bug.

**Why this priority**: troca um 500 opaco por um sinal acionável; depende da
US1 para definir o que é "nada funcionou".

**Independent Test**: com o modelo principal e todas as reservas simulados
falhando, enviar uma pergunta e verificar a resposta 503 com o motivo e os
modelos tentados, e que nada foi gravado na conversa.

**Acceptance Scenarios**:

1. **Given** o modelo principal e todas as reservas falhando, **When** o turno
   roda, **Then** a resposta é 503 com o código `model_unavailable` e a lista
   dos modelos tentados, na ordem.
2. **Given** nenhuma reserva configurada e o modelo principal falhando em
   todas as tentativas, **When** o turno roda, **Then** a resposta é 503.
3. **Given** um turno que terminou em 503, **When** se consulta a conversa,
   **Then** nem a pergunta nem uma resposta foram gravadas, e o aprendizado não
   foi disparado.
4. **Given** um erro que não vem do modelo (por exemplo, uma falha de
   programação), **When** o turno roda, **Then** a resposta continua sendo
   500, sem ser mascarada como 503.

---

### User Story 3 - Saber qual modelo respondeu (Priority: P3)

Quem acompanha o OpsPilot quer saber, pela própria resposta do chat, se o
turno usou o modelo principal ou uma reserva, e quando houve troca. Isso
explica mudanças de qualidade ou de custo e mostra quando o principal está
instável.

**Why this priority**: observabilidade; depende da US1.

**Independent Test**: num turno em que a reserva assumiu, verificar que as
métricas indicam o modelo usado e que o rastro contém um evento de troca com
o modelo de origem, o de destino e o motivo.

**Acceptance Scenarios**:

1. **Given** um turno sem falhas, **When** a resposta é devolvida, **Then** as
   métricas indicam o modelo principal como o modelo usado e o rastro não tem
   evento de troca.
2. **Given** um turno em que a reserva assumiu, **When** a resposta é
   devolvida, **Then** as métricas indicam a reserva como o modelo usado e o
   rastro tem um evento `fallback` com modelo de origem, modelo de destino e
   motivo (só o nome do erro), atribuído à etapa do grafo em que ocorreu.
3. **Given** um turno em que o modelo principal falhou e se recuperou com uma
   nova tentativa, **When** a resposta é devolvida, **Then** não há evento
   `fallback`, porque não houve troca de modelo.

---

### Edge Cases

- A lista de reservas no ambiente tem espaços, itens vazios, repetições ou o
  próprio modelo principal: itens vazios são ignorados, repetições são
  removidas mantendo a primeira ocorrência, e o modelo principal não entra
  como reserva.
- A variável de reservas está ausente ou vazia: não há reservas, só as
  tentativas no modelo principal.
- Várias chamadas ao modelo no mesmo turno trocam para a mesma reserva: o
  rastro registra a troca uma vez por par (origem → destino) por turno, para
  não poluir o rastro.
- Num mesmo turno, chamadas diferentes terminam em modelos diferentes (por
  exemplo, o roteador na reserva e a estratégia no principal): o modelo usado
  informado é o que produziu a resposta final; os eventos `fallback` mostram as
  trocas.
- O roteador do specs/014 esgota principal e reservas: ele cai no seu próprio
  fallback (`react`, `source: "fallback"`) e o turno segue; se a estratégia
  também esgotar todos os modelos, o turno responde 503.
- O resumidor (specs/012) ou o refletor de aprendizado (specs/009) esgotam
  todos os modelos: seguem a regra que já têm (não derrubam o turno), sem 503.
- O teto de tempo do turno (180 s) continua valendo: se as tentativas e as
  reservas passarem dele, a resposta é 504, como hoje.
- Uma falha que se repete de forma idêntica em qualquer modelo (por exemplo,
  pedido malformado) também esgota as reservas e resulta em 503. Isso é
  aceitável nesta versão.
- Mensagens de erro do provedor podem ecoar conteúdo do usuário: logs e o
  motivo do evento `fallback` carregam só o nome do erro.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Toda chamada ao modelo de linguagem MUST passar por um único
  ponto de criação de modelo, que aplica a mesma política de resiliência.
- **FR-002**: Em falha do modelo principal, o sistema MUST tentar o mesmo
  modelo de novo um número limitado de vezes (padrão: 2 tentativas por
  modelo, ou seja, 1 nova tentativa), com espera crescente entre elas, antes de passar para qualquer
  reserva.
- **FR-003**: O sistema MUST aceitar uma lista ordenada de modelos reserva
  por configuração de ambiente (`OPENROUTER_MODEL_FALLBACK`, itens separados
  por vírgula) e, depois de esgotar as tentativas no principal, MUST tentar
  cada reserva na ordem até uma responder.
- **FR-004**: A lista de reservas MUST ser validada na subida: itens vazios
  ignorados, repetições removidas e o modelo principal excluído. Ausente ou
  vazia → sem reservas, sem erro.
- **FR-005**: Quando o principal e todas as reservas falham numa chamada da
  qual a resposta do turno depende, o `/chat` MUST responder 503 com
  `{ error: "model_unavailable", modelsTried: [...] }`, sem gravar nada na
  conversa e sem disparar o aprendizado.
- **FR-006**: Erros que não vêm do modelo MUST manter o comportamento atual
  (500 `internal_error`, 404, 504 etc.), sem virar 503.
- **FR-007**: A resposta do `/chat` MUST informar em `metrics.modelUsed` o
  identificador do modelo que produziu a resposta final do turno.
- **FR-008**: Quando uma chamada troca de modelo, o rastro MUST conter um
  evento `{ type: "fallback", from, to, reason }`, com `reason` igual só ao
  nome do erro e com o `node` da etapa do grafo em que ocorreu (specs/014). O
  evento aparece uma vez por par origem → destino por turno.
- **FR-009**: Novas tentativas no mesmo modelo MUST NOT gerar evento
  `fallback`.
- **FR-010**: Partes do turno que hoje toleram falha do modelo (roteador,
  resumidor, refletor de aprendizado) MUST manter essa tolerância; só uma
  falha total na geração da resposta leva ao 503.
- **FR-011**: Chamadas extras causadas por novas tentativas e reservas MUST
  ser refletidas nas métricas de uso de tokens que já existem (specs/011),
  quando o provedor informar o uso.
- **FR-012**: Logs de falha de modelo MUST conter só o nome do erro e os
  identificadores dos modelos, nunca o conteúdo da mensagem do usuário nem a
  mensagem de erro do provedor.
- **FR-013**: A política de resiliência MUST ser testável sem rede, com
  modelos simulados que falham ou respondem de forma determinística.

### Key Entities

- **Modelo principal**: o modelo configurado hoje (`OPEN_ROUTER_MODEL`).
- **Modelos reserva**: lista ordenada vinda de `OPENROUTER_MODEL_FALLBACK`,
  tentada só depois de esgotar as novas tentativas no principal.
- **Evento de troca (`fallback`)**: modelo de origem, modelo de destino, motivo
  (nome do erro) e etapa do grafo.
- **Modelo usado**: identificador do modelo que produziu a resposta final do
  turno.
- **Indisponibilidade de modelo**: condição em que principal e reservas
  falharam; vira 503 com a lista dos modelos tentados.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Com o modelo principal indisponível e pelo menos uma reserva
  saudável, 100% dos turnos respondem com sucesso.
- **SC-002**: Falhas passageiras do modelo principal (que se resolvem em até
  1 nova tentativa) não aparecem para o usuário nem acionam reservas.
- **SC-003**: Quando nenhum modelo responde, 100% dos turnos devolvem 503
  `model_unavailable`, e nenhum devolve 500 por causa do modelo.
- **SC-004**: Em 100% das respostas de sucesso, o modelo usado está informado;
  em 100% dos turnos com troca de modelo, o rastro mostra a troca.
- **SC-005**: Um turno sem falhas não fica mais lento nem faz mais chamadas ao
  modelo do que hoje.

## Assumptions

- O nome da variável segue o pedido (`OPENROUTER_MODEL_FALLBACK`), embora o
  modelo principal use `OPEN_ROUTER_MODEL`; renomear o principal fica fora de
  escopo. As duas variáveis são documentadas no `.env.example`.
- Número de novas tentativas e espera entre elas são fixos nesta versão
  (padrão 2 tentativas por modelo, inclusive em cada reserva, decidido na
  implementação em 2026-10-21); torná-los configuráveis fica
  fora de escopo.
- Qualquer falha devolvida pela chamada ao modelo (limite de requisições,
  indisponibilidade, erro de rede, tempo esgotado) conta para tentativas e
  reservas; não há classificação de erros "não recuperáveis" nesta versão.
- O 503 inclui a lista dos modelos tentados (identificadores públicos de
  modelo, não segredos). Um cabeçalho `Retry-After` fica fora de escopo.
- `arena`, `bench` e o servidor MCP passam a ter a mesma política porque
  usam o mesmo ponto de criação de modelo; nenhum deles ganha 503 próprio.
- O teto de tempo do turno (specs/003) não muda.

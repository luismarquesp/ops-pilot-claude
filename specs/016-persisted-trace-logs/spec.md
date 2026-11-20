# Feature Specification: Rastro persistido + logs estruturados

**Feature Branch**: `016-persisted-trace-logs`

**Created**: 2026-11-17

**Status**: Draft

**Input**: User description: "Trace persistido + logs JSON: /chat: requestId no corpo e no header X-Request-Id. SQLite: requests (métricas) e trace_events (node, payloads). src/obs/logger.ts: 1 linha JSON por evento, só metadados. GET /requests/:id registro + trace ordenado"

## Contexto

Hoje o rastro (`trace`) e as métricas (`metrics`) de um turno do `/chat` só
existem na resposta HTTP: se o cliente não guardou a resposta, não há como
reconstruir depois o que o agente fez — que rota o roteador escolheu, quais
tools foram chamadas, se houve troca de modelo (specs/015), quantos tokens o
turno gastou (specs/011). Os logs do servidor são texto livre
(`console.warn`/`console.error`), sem um identificador que ligue uma linha de
log a uma requisição específica. Num incidente de produção, quem investiga um
comportamento estranho do copiloto precisa de um id para citar e de um lugar
para consultá-lo.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Toda requisição ao chat tem um identificador (Priority: P1)

Um plantonista recebe uma resposta estranha do OpsPilot e quer reportá-la.
Toda resposta do `/chat` — de sucesso ou de erro — traz um identificador
único da requisição, no corpo e no cabeçalho `X-Request-Id`, que ele pode
copiar e citar.

**Why this priority**: é a âncora de todo o resto: sem um id, não há como
ligar logs, registro persistido e relato do usuário.

**Independent Test**: enviar uma pergunta válida e uma inválida ao `/chat` e
verificar que ambas as respostas trazem um `requestId` no formato UUID,
igual no corpo e no cabeçalho, e diferente entre as duas.

**Acceptance Scenarios**:

1. **Given** uma pergunta válida, **When** o `/chat` responde 200, **Then** o
   corpo tem `requestId` (UUID) e o cabeçalho `X-Request-Id` tem o mesmo
   valor.
2. **Given** uma requisição inválida (400), uma estratégia desconhecida
   (422), uma conversa inexistente (404), um modelo indisponível (503) ou um
   tempo esgotado (504), **When** o `/chat` responde, **Then** o corpo de erro
   e o cabeçalho também trazem o `requestId`.
3. **Given** duas requisições quaisquer, **When** ambas respondem, **Then** os
   `requestId` são diferentes.
4. **Given** um cliente que envia seu próprio `X-Request-Id`, **When** o
   `/chat` responde, **Then** o id devolvido é gerado pelo servidor (o valor
   do cliente é ignorado).

---

### User Story 2 - Consultar depois o que aconteceu num turno (Priority: P2)

Quem investiga um turno usa o `requestId` para buscar o registro completo:
quando aconteceu, qual o resultado (sucesso ou qual erro), as métricas do
turno e o rastro inteiro, na ordem em que os eventos ocorreram, com a etapa
do grafo de cada evento.

**Why this priority**: é o valor central de diagnóstico; depende da US1 para
ter o id.

**Independent Test**: fazer um turno bem-sucedido, buscar o registro por
`GET /requests/:id` e verificar que métricas e rastro são iguais aos
devolvidos pelo `/chat`, na mesma ordem.

**Acceptance Scenarios**:

1. **Given** um turno bem-sucedido, **When** se consulta `GET /requests/:id`,
   **Then** a resposta traz o registro (id, momento, status, conversa,
   estratégia/rota, métricas) e o rastro com os mesmos eventos e a mesma ordem
   do `trace` devolvido pelo `/chat`, cada um com sua etapa (`node`) e posição.
2. **Given** um turno que falhou depois de validado (404, 503, 504 ou 500),
   **When** se consulta pelo id, **Then** o registro existe com o status e o
   código de erro, sem métricas de turno e sem rastro.
3. **Given** um id que nunca existiu, **When** se consulta, **Then** a
   resposta é 404 `request_not_found`.
4. **Given** um id que não é UUID, **When** se consulta, **Then** a resposta é
   400 com os problemas de validação.
5. **Given** o servidor reiniciado, **When** se consulta um id de antes do
   reinício, **Then** o registro continua disponível.

---

### User Story 3 - Logs estruturados e seguros para máquinas (Priority: P3)

Quem opera o OpsPilot quer filtrar os logs por requisição e agregá-los numa
ferramenta de logs. Cada acontecimento relevante vira exatamente uma linha
JSON, com o `requestId`, e nunca carrega o conteúdo das mensagens, das
respostas ou das tools.

**Why this priority**: operação e privacidade; o diagnóstico detalhado já é
coberto pela US2.

**Independent Test**: com um destino de log capturável, fazer um turno e
verificar que cada linha é um JSON válido isolado, que todas carregam o
mesmo `requestId`, e que nenhuma contém o texto da pergunta, da resposta ou
de qualquer observação de tool.

**Acceptance Scenarios**:

1. **Given** um turno bem-sucedido, **When** ele termina, **Then** há uma
   linha de log para o início da requisição, uma por evento do rastro e uma
   para o fim, todas com o mesmo `requestId`.
2. **Given** uma linha de log de evento do rastro, **When** é lida, **Then**
   ela tem só metadados: momento, nível, nome do acontecimento, `requestId`,
   tipo do evento, etapa (`node`), posição e — quando aplicável — nome da
   tool, rota, origem da rota e modelos de origem/destino de um `fallback`.
3. **Given** a linha de fim de requisição, **When** é lida, **Then** ela tem
   status HTTP, duração e as métricas numéricas do turno (chamadas ao modelo,
   tokens, modelo usado), sem conteúdo.
4. **Given** uma falha (503, 500 etc.), **When** é logada, **Then** a linha
   leva só o código do erro e o nome do erro, nunca a mensagem do erro.
5. **Given** os logs que hoje saem em texto livre na camada HTTP (modelo
   indisponível, erro inesperado), **When** acontecem, **Then** saem no mesmo
   formato JSON de uma linha.

---

### Edge Cases

- A gravação do registro ou do rastro falha (banco indisponível, disco
  cheio): a resposta do `/chat` não muda — o usuário recebe a resposta e o
  `requestId` mesmo assim; a falha vira uma linha de log de erro só com o nome
  do erro. O `GET /requests/:id` desse id responde 404.
- Requisições rejeitadas na validação (400) ou por estratégia desconhecida
  (422) recebem `requestId` e geram logs, mas não são persistidas: não houve
  turno.
- JSON malformado no corpo (rejeitado antes da validação) também recebe
  `requestId` e linha de log, e responde 500 como hoje.
- Um turno com tempo esgotado (504) continua rodando em segundo plano: o que
  ele produzir depois da resposta não altera o registro já gravado nem gera
  rastro persistido.
- Payloads grandes do rastro (por exemplo, observações de tool com muitos
  alertas) são persistidos inteiros, sem truncamento.
- Eventos `summarize` e `fallback` fazem parte do rastro e são persistidos e
  logados como qualquer outro evento, na posição em que ocorreram.
- O refletor de aprendizado (specs/009) roda depois da resposta e não gera
  eventos no rastro persistido da requisição.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Cada requisição ao `/chat` MUST receber um identificador único
  (UUID) gerado pelo servidor no início do processamento, antes da validação.
- **FR-002**: Toda resposta do `/chat` MUST trazer o identificador no
  cabeçalho `X-Request-Id` e no corpo como `requestId`, tanto em sucesso
  quanto em erro (400, 404, 422, 500, 503, 504). O restante do corpo de cada
  resposta MUST permanecer como hoje.
- **FR-003**: Um `X-Request-Id` enviado pelo cliente MUST ser ignorado.
- **FR-004**: Todo turno que passa da validação MUST ser persistido como um
  registro de requisição com: id, momento de início, duração, status HTTP,
  código de erro (quando houver), conversa, `userId` (quando houver), rota
  escolhida e sua origem (quando houver), e as métricas do turno (quando o
  turno teve sucesso).
- **FR-005**: Todo evento do rastro de um turno bem-sucedido MUST ser
  persistido ligado ao registro da requisição, com sua posição na sequência,
  tipo, etapa do grafo (`node`) e o conteúdo completo do evento.
- **FR-006**: Registro e rastro de uma requisição MUST ser gravados juntos —
  ou ambos existem, ou nenhum existe.
- **FR-007**: Falha ao persistir MUST NOT alterar a resposta do `/chat`
  (status, corpo e `requestId` iguais); a falha MUST ser logada só com o nome
  do erro.
- **FR-008**: `GET /requests/:id` MUST devolver o registro da requisição e o
  rastro em ordem crescente de posição; id não-UUID → 400; id inexistente →
  404 `{ error: "request_not_found" }`.
- **FR-009**: O rastro devolvido por `GET /requests/:id` MUST ser igual, em
  conteúdo e ordem, ao `trace` devolvido pelo `/chat` no mesmo turno, e as
  métricas iguais a `metrics`.
- **FR-010**: Registro e rastro MUST sobreviver a reinícios do servidor,
  usando o mesmo arquivo de banco das conversas e da memória.
- **FR-011**: O sistema MUST ter um único logger estruturado que escreve
  exatamente uma linha JSON por acontecimento, com pelo menos momento, nível,
  nome do acontecimento e, quando houver, `requestId`.
- **FR-012**: O logger MUST emitir, por requisição ao `/chat`: uma linha de
  início, uma linha por evento do rastro (turnos bem-sucedidos) e uma linha de
  fim com status, duração e métricas numéricas.
- **FR-013**: Linhas de log MUST conter só metadados: nunca o texto da
  pergunta, da resposta, do resumo, de pensamentos, de observações de tools,
  dos argumentos de tools, nem mensagens de erro — só nomes de erro, códigos,
  ids, tipos, nomes de etapas/tools/rotas/modelos e números.
- **FR-014**: Os logs da camada HTTP que hoje são texto livre MUST passar a
  usar o logger estruturado.
- **FR-015**: O destino do logger MUST ser substituível, para que os testes
  capturem as linhas sem escrever na saída do processo.
- **FR-016**: Montar o registro, o rastro persistível e as linhas de log a
  partir do resultado do turno MUST ser feito por funções puras, testáveis
  sem banco nem rede.

### Key Entities

- **Requisição (`requests`)**: um turno do `/chat` que passou da validação —
  id, momento, duração, status, código de erro, conversa, usuário, rota e
  origem da rota, métricas do turno.
- **Evento de rastro (`trace_events`)**: um evento do `trace` de uma
  requisição — requisição a que pertence, posição, tipo, etapa do grafo e
  conteúdo completo. Removido junto com a requisição.
- **Linha de log**: um acontecimento serializado como um objeto JSON numa
  linha, só com metadados, ligado à requisição pelo `requestId`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% das respostas do `/chat`, de sucesso ou de erro, trazem um
  identificador de requisição, igual no corpo e no cabeçalho.
- **SC-002**: Para 100% dos turnos bem-sucedidos, a consulta pelo id devolve
  o mesmo rastro (conteúdo e ordem) e as mesmas métricas que o cliente
  recebeu, inclusive após reinício do servidor.
- **SC-003**: 100% das linhas de log de uma requisição são JSON válido isolado
  e podem ser filtradas pelo identificador da requisição.
- **SC-004**: Nenhuma linha de log contém o texto da pergunta, da resposta ou
  de observações de tools (verificado com marcadores únicos em teste).
- **SC-005**: Uma falha de persistência não muda nenhuma resposta do `/chat`.

## Assumptions

- O id é sempre gerado pelo servidor; propagar um id de correlação vindo do
  cliente fica fora de escopo.
- Os nomes das tabelas seguem o pedido (`requests`, `trace_events`) no mesmo
  arquivo `OPSPILOT_DB`; o conteúdo do evento é guardado inteiro.
- O texto da pergunta e da resposta não é duplicado no registro da requisição:
  já está nas mensagens da conversa (specs/007), ligado por `conversationId`.
  O conteúdo dos eventos do rastro (pensamentos, observações, resposta) é
  persistido, por ser o que o cliente já recebe no `trace`.
- O `GET /requests/:id` segue o modelo de acesso atual da API (sem
  autenticação, como `/chat` e `/memories`); controle de acesso fica fora de
  escopo.
- Retenção/limpeza de registros antigos, listagem/busca de requisições e
  exportação para ferramentas externas ficam fora de escopo.
- Os logs vão para a saída padrão do processo; níveis configuráveis por
  ambiente ficam fora de escopo. Logs de `arena`, `bench`, `mcp` e dos
  scripts de avaliação continuam como estão.
- Persistência e logs acontecem na camada HTTP/serviço em volta do `runChat`;
  as estratégias e o grafo de produção não mudam (o rastro já sai com `node`
  desde o specs/014).
- A sobrecarga de persistir e logar é desprezível frente às chamadas ao
  modelo; não há meta de desempenho própria.

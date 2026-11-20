# Feature Specification: War room web

**Feature Branch**: `018-war-room-web`

**Created**: 2026-11-20

**Status**: Draft

**Input**: User description: "War room web/ (Vite+react+TS) com as instructions de design: chat -> /chat, com "ver raciocínio" abrindo trace tipado. 202 vira cartão aprovar/negar; engrenagem com URL da API. base /opspilot/; CORS"

## Contexto

Hoje o plantonista só fala com o OpsPilot por `curl` ou script. A war room é uma
interface web para conversar com o copiloto durante um incidente. Nela o
plantonista pode:

- ver por que o agente chegou a uma resposta;
- autorizar, ou recusar, as ações que mudam o estado da produção antes que
  aconteçam.

A interface segue as regras de design de
[.github/instructions/design.instructions.md](../../.github/instructions/design.instructions.md):
hierarquia, espaçamento em escala, estados vazios e de erro, dark mode e
acessibilidade.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Conversar com o copiloto (Priority: P1)

Durante o plantão, o usuário abre a war room, digita uma pergunta ("quais
alertas estão disparando?") e recebe a resposta do OpsPilot na mesma tela.
Perguntas seguintes continuam a mesma conversa, e o usuário pode começar uma
conversa nova quando quiser.

**Why this priority**: sem conversa não há war room; é o menor recorte que já
substitui o `curl`.

**Independent Test**: com a API no ar, enviar duas perguntas seguidas e ver as
duas respostas na ordem. A segunda resposta mostra que o contexto da primeira
foi mantido.

**Acceptance Scenarios**:

1. **Given** uma conversa vazia, **When** o usuário envia uma pergunta, **Then**
   a pergunta aparece imediatamente, há indicação de progresso com tempo
   decorrido, e a resposta aparece ao chegar.
2. **Given** uma conversa com respostas, **When** o usuário envia outra
   pergunta, **Then** ela segue na mesma conversa.
3. **Given** uma conversa em andamento, **When** o usuário escolhe "Nova
   conversa", **Then** o histórico visível é limpo e a próxima pergunta abre uma
   conversa nova.
4. **Given** a API responde com erro (modelo indisponível, tempo esgotado,
   conversa inexistente, entrada inválida ou falha inesperada), **Then** a
   mensagem é traduzida em linguagem humana, com a próxima ação e o
   identificador da requisição copiável. O texto digitado não se perde.
5. **Given** a war room sem nenhuma mensagem, **Then** há um estado vazio que
   explica o que perguntar, com exemplos clicáveis.

---

### User Story 2 - Ver o raciocínio (Priority: P1)

Cada resposta do copiloto tem a ação "Ver raciocínio". Ela abre o rastro do
turno na ordem em que aconteceu. Cada tipo de passo tem apresentação própria:

- rota escolhida e por quê;
- plano;
- pensamento;
- chamada de ferramenta, com argumentos;
- observação;
- crítica;
- troca de modelo;
- resumo do histórico;
- resposta.

Junto aparecem as métricas do turno: chamadas ao modelo, tokens, latência e
modelo usado.

**Why this priority**: num incidente, o plantonista precisa confiar na
resposta antes de agir. Ver as ferramentas consultadas é o que dá essa
confiança.

**Independent Test**: enviar uma pergunta que use uma ferramenta, abrir "Ver
raciocínio" e conferir que os passos, os tipos e a ordem batem com o rastro
devolvido pela API.

**Acceptance Scenarios**:

1. **Given** uma resposta recebida, **When** o usuário abre "Ver raciocínio",
   **Then** vê os passos na ordem, cada um identificado por tipo (com ícone e
   rótulo, não só cor) e pela etapa do fluxo onde ocorreu.
2. **Given** um passo de tipo que a interface não conhece, **Then** ele aparece
   de forma genérica e legível, sem quebrar a tela.
3. **Given** o painel aberto, **When** o usuário fecha com teclado ou mouse,
   **Then** o foco volta para a resposta de onde saiu.
4. **Given** um turno que trocou de modelo por falha, **Then** a troca aparece
   destacada como aviso.

---

### User Story 3 - Aprovar ou negar ações sensíveis (Priority: P2)

Quando o copiloto quer executar uma ação que muda o estado da produção (abrir
ou resolver incidente), a API não executa direto e devolve "aguardando
aprovação". A war room mostra isso como um **cartão de aprovação** com:

- a ação;
- o alvo (serviço ou incidente);
- os detalhes;
- dois botões: **Aprovar** e **Negar**.

A decisão volta ao copiloto, que conclui o turno e mostra a resposta final.

**Why this priority**: é a principal proteção contra o agente mudando a
produção por engano. Depende da conversa (US1) existir.

**Independent Test**: pedir "resolva o incidente 3", receber o cartão,
**negar**, e confirmar que o incidente continua aberto. Repetir **aprovando** e
confirmar que foi resolvido.

**Acceptance Scenarios**:

1. **Given** uma resposta "aguardando aprovação", **Then** aparece um cartão
   com a ação descrita em linguagem humana, sem precisar ler JSON. Os detalhes
   técnicos ficam disponíveis sob demanda.
2. **Given** o cartão, **When** o usuário aprova, **Then** o cartão mostra
   "aprovado", os botões são desativados, e a resposta final do copiloto
   aparece em seguida.
3. **Given** o cartão, **When** o usuário nega, **Then** a ação não é executada
   e o copiloto confirma que não executou.
4. **Given** um cartão já decidido, **Then** não é possível decidir de novo.
   Duplo clique não gera duas decisões.
5. **Given** um cartão pendente, **Then** o campo de nova pergunta fica
   bloqueado, com explicação, até a decisão.
6. **Given** que a decisão falhou (rede ou API), **Then** o cartão volta a
   ficar pendente com a mensagem de erro, e o usuário pode tentar de novo.

**Escopo (decidido em 2026-11-20)**: esta feature cria também o fluxo de
aprovação na API. Hoje as ações sensíveis executam direto e não existe resposta
"aguardando aprovação". A API passa a:

- pausar o turno antes de uma ação sensível;
- devolver a ação pendente;
- aceitar a decisão;
- retomar o turno a partir do ponto onde parou.

7. **Given** um cartão pendente, **When** o usuário recarrega a página, **Then**
   o cartão pendente volta, recuperado da API, e ainda pode ser decidido.
8. **Given** uma aprovação pendente há mais de 15 minutos, **Then** ela expira
   como **negada** sem executar, e o cartão mostra "expirada".

---

### User Story 4 - Apontar para outra API (Priority: P2)

Um ícone de engrenagem abre as configurações, onde o usuário informa o endereço
da API do OpsPilot. Assim a mesma war room serve ao ambiente local, de
homologação ou de produção. A escolha fica salva neste navegador.

**Why this priority**: sem isso a war room só funciona com um endereço fixo.

**Independent Test**: trocar o endereço para uma API em outra porta, enviar uma
pergunta e ver a resposta vir dela. Recarregar a página e confirmar que o
endereço continua o escolhido.

**Acceptance Scenarios**:

1. **Given** as configurações abertas, **When** o usuário informa um endereço
   válido e salva, **Then** as próximas perguntas vão para ele.
2. **Given** um endereço malformado, **Then** o erro aparece junto ao campo e
   nada é salvo.
3. **Given** as configurações, **When** o usuário pede para testar a conexão,
   **Then** vê "conectado" ou o motivo da falha, incluindo "a API não permite
   acesso a partir desta origem".
4. **Given** nenhum endereço salvo, **Then** é usado um padrão e as
   configurações mostram qual é.
5. **Given** que o endereço mudou no meio de uma conversa, **Then** a próxima
   pergunta abre uma conversa nova, porque a conversa anterior pertence à outra
   API.

---

### User Story 5 - Publicar sob um caminho e acessar de outra origem (Priority: P3)

A war room é publicada sob o caminho `/opspilot/` de um servidor que já hospeda
outras coisas, e não na raiz. Ela fala com a API, que pode estar em outro
endereço. Para isso, a API passa a aceitar chamadas vindas das origens
autorizadas.

**Why this priority**: é preciso para colocar no ar, mas não para usar
localmente.

**Independent Test**:
1. Servir a versão publicada sob `/opspilot/` e abrir
   `https://host/opspilot/`. Todos os recursos devem carregar, sem erros.
2. Chamar a API de uma origem autorizada e de uma não autorizada, e conferir
   que só a primeira é aceita.

**Acceptance Scenarios**:

1. **Given** a war room publicada sob `/opspilot/`, **Then** a página e todos os
   seus recursos carregam a partir desse caminho, inclusive ao recarregar.
2. **Given** a API configurada com uma lista de origens autorizadas, **When** a
   war room de uma dessas origens chama a API, **Then** a chamada é aceita, e o
   cabeçalho do identificador da requisição fica legível pela página.
3. **Given** uma origem fora da lista, **Then** o navegador bloqueia a resposta,
   e a war room explica o motivo (ver US4, cenário 3).
4. **Given** a API sem lista configurada, **Then** nenhuma origem externa é
   aceita e o comportamento atual (sem navegador) não muda.

---

### Edge Cases

- A resposta demora até o limite de 3 minutos da API. O progresso segue
  visível, e ao estourar aparece o erro de tempo esgotado com "Tentar de novo".
- O usuário envia uma pergunta vazia ou só com espaços: o envio fica
  desativado.
- A pergunta tem várias linhas ou um texto longo (log colado): é preservada e
  exibida com as quebras de linha.
- A resposta traz Markdown, como listas ou blocos de código: é exibida
  formatada, e nenhum HTML vindo da resposta é executado.
- Um rastro longo, com dezenas de passos, ou uma observação enorme: o painel
  rola, e conteúdos longos podem ser expandidos ou recolhidos.
- A API está fora do ar: é exibido um erro de conexão com sugestão de checar o
  endereço na engrenagem.
- O endereço salvo deixou de responder: a falha é mostrada no envio, nunca uma
  tela em branco.
- A tela é estreita (360px), está com zoom de 200%, o tema é escuro ou o
  usuário navega só por teclado: tudo continua utilizável (ver design
  instructions).
- Um cartão de aprovação fica pendente e o usuário recarrega a página: o cartão
  é recuperado da API e continua decidível. Se expirou, aparece como
  "expirada".
- O agente propõe mais de uma ação sensível no mesmo turno: cada uma pausa o
  turno separadamente, um cartão por vez, na ordem.
- Duas abas decidem a mesma aprovação: a primeira decisão vale, e a segunda
  recebe "já decidida". A ação nunca é executada duas vezes.

## Requirements *(mandatory)*

### Functional Requirements

**Conversa**

- **FR-001**: A war room MUST enviar a pergunta do usuário ao endpoint de chat
  da API e exibir a resposta na ordem da conversa.
- **FR-002**: A war room MUST manter a conversa: perguntas seguintes usam o
  identificador da conversa devolvido pela API. "Nova conversa" descarta o
  identificador.
- **FR-003**: A war room MUST mostrar progresso com tempo decorrido enquanto
  espera, e permitir cancelar a espera.
- **FR-004**: A war room MUST traduzir cada resposta de erro da API em
  mensagem humana, com próxima ação e identificador da requisição copiável,
  conforme a tabela de erros das design instructions. A pergunta digitada é
  preservada.
- **FR-005**: A war room MUST ter estados de carregando, vazio, erro e com
  dados em toda área que busca dados.

**Raciocínio**

- **FR-006**: Cada resposta MUST oferecer "Ver raciocínio", que abre o rastro do
  turno na ordem original, com apresentação específica para cada tipo de passo
  conhecido: rota, plano, pensamento, ação, observação, crítica, troca de
  modelo, resumo e resposta.
- **FR-007**: Tipos de passo desconhecidos MUST aparecer de forma genérica, sem
  erro.
- **FR-008**: O painel de raciocínio MUST mostrar as métricas do turno (chamadas
  ao modelo, tokens de prompt, latência, modelo usado, cortes de contexto).
- **FR-009**: A war room MUST validar o formato da resposta da API antes de
  exibir. Resposta fora do contrato vira erro tratado, não tela quebrada.

**Aprovação**

- **FR-010**: Uma resposta "aguardando aprovação" MUST virar um cartão com a
  ação, o alvo, os detalhes e os botões Aprovar e Negar.
- **FR-011**: A decisão MUST ser enviada uma única vez por cartão. Depois de
  decidido, o cartão fica só leitura, com o resultado.
- **FR-012**: Com um cartão pendente, novas perguntas MUST ficar bloqueadas até
  a decisão.
- **FR-013**: A ação só MUST ser executada depois de "Aprovar". "Negar",
  expiração ou nenhuma decisão nunca executam.

**Aprovação na API**

- **FR-013a**: Quando o agente decide chamar uma ferramenta sensível (abrir ou
  resolver incidente), o turno MUST pausar antes da execução. O chat responde
  "aceito, aguardando aprovação" (202) com:
  - o identificador da aprovação;
  - a ferramenta;
  - os argumentos;
  - um resumo em linguagem humana;
  - o identificador da conversa e o da requisição.
- **FR-013b**: A API MUST oferecer uma forma de registrar a decisão (aprovar ou
  negar) de uma aprovação pendente, com estas regras:
  - **Aprovar**: executa a ação e conclui o turno, com resposta final, rastro e
    métricas iguais aos de um turno normal.
  - **Negar**: conclui o turno sem executar, e o copiloto informa que não
    executou.
  - **Aprovação já decidida, expirada ou inexistente**: erro claro, sem
    executar.
- **FR-013c**: A aprovação pendente MUST sobreviver a reinício da API e ser
  consultável pela conversa, para a war room recuperar o cartão depois de
  recarregar.
- **FR-013d**: Uma aprovação MUST expirar após 15 minutos sem decisão e ser
  tratada como negada.
- **FR-013e**: A decisão MUST valer uma única vez. Decisões concorrentes sobre a
  mesma aprovação resultam em uma só execução.
- **FR-013f**: O rastro do turno MUST registrar a pausa e a decisão como passos
  próprios, e a requisição pausada MUST ficar registrada como as demais
  (specs/016). As ações sensíveis acionadas por outros canais (MCP) não mudam.
- **FR-013g**: Turnos pausados MUST NOT disparar o aprendizado de memória nem
  gravar a resposta na conversa antes da decisão.

**Configuração**

- **FR-014**: A engrenagem MUST permitir definir o endereço da API, validado
  como URL http(s) e salvo neste navegador, com um padrão quando nada foi
  salvo.
- **FR-015**: A configuração MUST oferecer "Testar conexão", que distingue: API
  inacessível, origem não autorizada e conectado.
- **FR-016**: Trocar o endereço MUST iniciar uma conversa nova.

**Publicação e origem**

- **FR-017**: A versão publicada MUST funcionar servida sob o caminho
  `/opspilot/`.
- **FR-018**: A API MUST aceitar chamadas de navegador apenas das origens
  autorizadas, configuradas por variável de ambiente. Sem configuração, nenhuma
  origem externa é aceita.
- **FR-019**: Para origens autorizadas, a API MUST expor o cabeçalho
  `X-Request-Id` à página e responder às verificações prévias do navegador
  (preflight).

**Design**

- **FR-020**: Toda a interface MUST seguir as design instructions: tokens,
  escala de espaçamento, uma ação primária por seção, temas claro e escuro, e
  WCAG 2.2 AA (teclado, foco visível, rótulos e anúncio de conteúdo novo).
- **FR-021**: A war room MUST NOT guardar no navegador o conteúdo das
  conversas. Só a configuração, o tema e o identificador da conversa atual
  ficam salvos.

### Key Entities *(include if feature involves data)*

- **Mensagem**: pergunta do usuário ou resposta do copiloto. Tem estado
  (enviando, respondida, com erro), identificador da requisição, rastro e
  métricas.
- **Passo do raciocínio**: item do rastro de um turno. Tem tipo, etapa do fluxo
  onde ocorreu e conteúdo específico do tipo.
- **Aprovação pendente**: ação sensível proposta pelo copiloto. Tem ação, alvo,
  detalhes e estado (pendente, aprovada, negada, falhou ao decidir).
- **Configuração**: endereço da API e preferência de tema, deste navegador.
- **Aprovação (na API)**: ação sensível pausada. Pertence a uma conversa e a uma
  requisição. Tem ferramenta, argumentos, resumo, estado (pendente, aprovada,
  negada, expirada), criação, prazo e momento da decisão.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um plantonista que nunca usou a war room faz uma pergunta e lê a
  resposta em menos de 30 segundos após abrir a página, sem instruções.
- **SC-002**: A partir de uma resposta, o usuário chega ao passo de ferramenta
  consultada em no máximo 2 interações.
- **SC-003**: 100% das ações sensíveis passam por um cartão. Nenhuma é
  executada sem "Aprovar" nos testes de aceitação.
- **SC-004**: 100% das respostas de erro da API conhecidas mostram mensagem
  humana com próxima ação. Nenhuma mostra stack trace ou texto cru de exceção.
- **SC-005**: As telas principais (conversa, raciocínio, cartão e
  configurações) passam em verificação automática de acessibilidade sem
  violações sérias, nos temas claro e escuro.
- **SC-006**: Todo o fluxo (perguntar, ver raciocínio, aprovar e configurar) é
  concluído só com teclado.
- **SC-007**: A versão publicada sob `/opspilot/` carrega sem nenhum recurso
  com falha.

## Assumptions

- **Uso e acesso**
  - Usuário único por navegador, sem login: a war room é ferramenta interna,
    com acesso controlado pela rede ou pelo proxy, como a API hoje.
  - Não há identificação do usuário. A conversa funciona sem `userId`, e a
    memória semântica fica fora deste escopo.
- **Escopo**
  - A war room cobre só a conversa. Telas de alertas, incidentes, `/stats` e
    memórias ficam para specs futuras.
  - O endpoint de chat devolve a resposta inteira ao final, sem streaming. O
    progresso exibido é o tempo decorrido, não passos parciais.
  - A escolha da estratégia (`strategy`) fica com o roteador. A interface não
    expõe esse controle nesta versão.
- **Configuração**
  - Endereço padrão da API: a mesma origem da página, quando servida junto, ou
    `http://localhost:3000` em desenvolvimento.
  - CORS: lista de origens explícita, nunca curinga (`*`), sem cookies ou
    credenciais.
- **Desenvolvimento e testes**
  - Stack da interface definida pelo pedido: Vite + React + TypeScript, na
    pasta `web/`, que é publicada separada da API. Detalhes ficam no plano.
  - Os testes da interface rodam sem a API real, com respostas simuladas
    conforme o contrato.

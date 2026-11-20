# Feature Specification: Endpoint HTTP de Chat sobre o Núcleo de Raciocínio

**Feature Branch**: `003-chat-endpoint`

**Created**: 2026-09-15

**Status**: Draft

**Input**: User description: "POST /chat em src/http/server.ts (ou padrão do express): body { message, strategy?, reflect? } validando com zod; default react. 200 { answer, trace, metrics }; 400 body inválido { issues do zod }; 422 estratégia desconhecida; timeout 180s -> 504. Registry em src/agents/index.ts (nome -> estratégia; reflect aplica wihReflection). TEste de integração com estratégia fake determinística, sem rede."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Perguntar ao OpsPilot por HTTP e receber resposta, rastro e métricas (Priority: P1)

Como sistema ou pessoa integrando com o OpsPilot, quero enviar uma pergunta em
linguagem natural por HTTP e receber de volta a resposta final, o rastro completo do
raciocínio e as métricas de execução, sem precisar saber nada sobre como o núcleo de
raciocínio é montado internamente.

**Why this priority**: é o valor central da feature — sem essa via de entrada por
HTTP, o núcleo de raciocínio (specs/001) só é acessível pela CLI (`arena`), o que
impede qualquer integração externa (uma UI, um bot de plantão, etc.).

**Independent Test**: pode ser testado sozinho enviando uma requisição com apenas
`message` preenchido e verificando que a resposta traz `answer`, `trace` e `metrics`
coerentes com uma execução da estratégia padrão.

**Acceptance Scenarios**:

1. **Given** o serviço no ar, **When** uma requisição é enviada só com `message`,
   **Then** a estratégia padrão é usada e a resposta contém `answer`, `trace` e
   `metrics`.
2. **Given** uma execução concluída com sucesso, **When** a resposta é recebida,
   **Then** ela reflete exatamente o resultado daquela execução (mesma resposta,
   mesmo rastro, mesmas métricas que uma chamada equivalente ao núcleo de raciocínio
   produziria).

---

### User Story 2 - Escolher estratégia e reflexão por requisição (Priority: P2)

Como sistema ou pessoa integrando com o OpsPilot, quero indicar, a cada requisição,
qual estratégia de raciocínio usar e se quero a camada extra de autocrítica
(specs/002), para poder comparar ou escolher o comportamento mais adequado sem
precisar de configuração fora da própria chamada.

**Why this priority**: sem essa flexibilidade, o endpoint só exporia uma fração do
que o núcleo de raciocínio já oferece (múltiplas estratégias, com ou sem reflexão);
depende da User Story 1 já existir.

**Independent Test**: pode ser testado sozinho enviando a mesma pergunta com
diferentes combinações de estratégia/reflexão e conferindo que cada resposta reflete
a combinação pedida (rastro e métricas compatíveis com aquela escolha específica).

**Acceptance Scenarios**:

1. **Given** uma estratégia reconhecida informada na requisição, **When** ela é
   diferente da padrão, **Then** a execução usa a estratégia pedida, não a padrão.
2. **Given** a opção de reflexão marcada na requisição, **When** a execução roda,
   **Then** o comportamento de autocrítica já definido em specs/002 é aplicado sobre
   a estratégia escolhida (ou a padrão, se nenhuma foi informada).

---

### User Story 3 - Falhas de entrada e de execução são previsíveis (Priority: P3)

Como sistema integrando com o OpsPilot, quero que corpos de requisição inválidos,
estratégias desconhecidas, e execuções que demoram demais tenham cada uma sua própria
resposta de erro clara e distinguível, para poder tratar cada caso programaticamente
sem depender de inspecionar texto livre.

**Why this priority**: sem respostas de erro previsíveis, um cliente não consegue
diferenciar "eu errei o pedido" de "o servidor não conseguiu responder a tempo",
tornando a integração frágil; depende das User Stories 1 e 2 já existirem.

**Independent Test**: pode ser testado sozinho enviando, isoladamente: um corpo sem
`message`; um corpo com uma estratégia inexistente; e observando que cada um recebe
um código e formato de resposta diferentes e claramente identificáveis.

**Acceptance Scenarios**:

1. **Given** um corpo de requisição sem `message` (ou com tipos errados), **When** a
   requisição é validada, **Then** a resposta indica um corpo inválido e descreve
   especificamente o que está errado.
2. **Given** um corpo com uma estratégia que não existe no sistema, **When** a
   requisição é processada, **Then** a resposta indica estratégia desconhecida, com um
   código diferente do usado para corpo inválido.
3. **Given** uma execução que não termina dentro do tempo máximo permitido, **When**
   esse tempo se esgota, **Then** o cliente recebe uma resposta de tempo esgotado, em
   vez de esperar indefinidamente.

---

### Edge Cases

- O que acontece quando `strategy` é informado mas não corresponde a nenhuma
  estratégia registrada? Resposta de estratégia desconhecida (US3, AC#2) — nunca uma
  resposta de sucesso nem um erro genérico não identificado.
- O que acontece quando `reflect` é pedido junto de uma `strategy` desconhecida? A
  validação da estratégia acontece antes de aplicar a reflexão — o resultado é o mesmo
  erro de estratégia desconhecida, não uma tentativa de refletir sobre algo que não
  existe.
- O que acontece quando o corpo da requisição tem campos além de `message`/
  `strategy`/`reflect`? Campos extras são ignorados; a requisição é processada
  normalmente com base nos campos reconhecidos.
- O que acontece quando `message` é uma string vazia? É tratado como corpo inválido
  (mesmo caminho de erro de `message` ausente), já que não há pergunta de fato a
  processar.
- O que acontece quando a execução estoura o tempo máximo permitido, mas termina
  processando em segundo plano depois disso? O cliente já recebeu a resposta de tempo
  esgotado e não deve esperar outra resposta para a mesma requisição; o resultado
  tardio é apenas descartado.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema DEVE expor um endpoint HTTP que aceita requisições para
  iniciar uma execução de raciocínio a partir de uma mensagem em linguagem natural.
- **FR-002**: O corpo da requisição DEVE ser validado na fronteira: uma mensagem é
  obrigatória; a escolha de estratégia e a opção de reflexão são opcionais.
- **FR-003**: Quando nenhuma estratégia é informada, o sistema DEVE usar a estratégia
  ReAct como padrão.
- **FR-004**: Em caso de sucesso, o sistema DEVE responder com a resposta final, o
  rastro completo da execução, e as métricas de execução (mesma forma já produzida
  pelo núcleo de raciocínio em specs/001).
- **FR-005**: Quando o corpo da requisição falha na validação, o sistema DEVE
  responder com um código de "requisição inválida" e descrever especificamente quais
  campos falharam e por quê.
- **FR-006**: Quando o nome de estratégia informado não corresponde a nenhuma
  estratégia registrada, o sistema DEVE responder com um código distinto do usado
  para corpo de requisição inválido.
- **FR-007**: Quando uma execução não termina dentro de um tempo máximo de 180
  segundos, o sistema DEVE responder ao cliente com um código de tempo esgotado, em
  vez de deixá-lo esperando indefinidamente.
- **FR-008**: O sistema DEVE manter um registro único que mapeia identificadores de
  estratégia para suas implementações, usado para resolver a estratégia pedida em
  toda requisição.
- **FR-009**: Quando a reflexão é solicitada, o sistema DEVE aplicá-la sobre a
  estratégia já resolvida para aquela requisição (a pedida, ou a padrão), reusando o
  mesmo comportamento de reflexão já definido em specs/002 — sem exigir um registro
  próprio para cada combinação de estratégia com reflexão.
- **FR-010**: O comportamento do endpoint (sucesso e cada caso de erro) DEVE ter
  testes de integração automatizados usando uma estratégia de raciocínio falsa e
  determinística, sem depender de um modelo de linguagem real nem de acesso à rede.

### Key Entities

- **Requisição de Chat**: mensagem em linguagem natural (obrigatória), estratégia
  desejada (opcional) e indicação de reflexão (opcional).
- **Resposta de Chat (sucesso)**: resposta final, rastro completo e métricas de
  execução — mesma forma já definida para o resultado de uma estratégia de raciocínio.
- **Registro de Estratégias**: o mapeamento entre um identificador de estratégia e a
  estratégia de raciocínio correspondente, consultado para resolver cada requisição.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um cliente consegue obter resposta final, rastro completo e métricas de
  execução para uma pergunta em linguagem natural em uma única requisição HTTP,
  informando somente a mensagem.
- **SC-002**: Um cliente consegue escolher entre todas as estratégias de raciocínio
  disponíveis no sistema, e adicionar a camada extra de autocrítica, usando o mesmo
  formato de requisição para qualquer uma delas.
- **SC-003**: 100% das requisições com corpo malformado recebem uma resposta que
  identifica especificamente o que estava inválido, nunca um erro genérico ou opaco.
- **SC-004**: 100% das requisições que informam uma estratégia não reconhecida
  recebem uma resposta distinguível — por código e por formato — das respostas de
  corpo inválido.
- **SC-005**: Nenhuma requisição a este endpoint deixa um cliente esperando por uma
  resposta por mais de 180 segundos.
- **SC-006**: 100% do comportamento do endpoint (sucesso e cada caso de erro) é
  coberto por testes automatizados que rodam sem exigir um modelo de linguagem real
  nem acesso à rede.

## Assumptions

- `strategy` aceita os identificadores das estratégias de base já registradas hoje no
  núcleo de raciocínio (ex.: a estratégia ReAct e a estratégia Plan-and-Execute) — não
  os nomes já refletidos usados internamente pela `arena` (ex.: o equivalente a
  "reflect:" mais o nome da estratégia); a reflexão é sempre pedida separadamente pelo
  campo `reflect`, para o cliente não precisar conhecer essa convenção interna de
  nomenclatura.
- `reflect` é um indicador de sim/não (aplicar a reflexão ou não), usando o
  comportamento e os padrões (número de rodadas etc.) já definidos em specs/002 — não
  permite, por enquanto, configurar parâmetros da reflexão por requisição.
- O tempo máximo de 180 segundos é contado do recebimento da requisição até a
  resposta ser enviada; se a execução de raciocínio só terminar depois desse prazo, o
  resultado tardio é descartado — o cliente não recebe uma segunda resposta para a
  mesma requisição.
- Campos desconhecidos além de `message`/`strategy`/`reflect` no corpo da requisição
  são ignorados, não rejeitados.
- Cada requisição é independente (uma mensagem por chamada, sem histórico de
  conversa) — mesma limitação que o núcleo de raciocínio já tem hoje (uma pergunta por
  execução).
- Autenticação e autorização deste endpoint ficam fora do escopo desta feature — o
  uso previsto por enquanto é interno/de desenvolvimento, na mesma fronteira de
  confiança que já existe ao rodar a `arena`/`bench` localmente.

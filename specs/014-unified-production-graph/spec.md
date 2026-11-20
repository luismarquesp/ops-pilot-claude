# Feature Specification: Grafo Unificado de Produção com Roteador

**Feature Branch**: `014-unified-production-graph`

**Created**: 2026-10-19

**Status**: Draft

**Input**: User description: "Grafo unificado: production-graph.ts: nós contexto, roteador, as 3 estratégias como nós e resposta. Roteador: withStructuredOutput (route, reason); tabela no prompt; evento \"route\" e campo node em todo evento de trace. /chat: strategy opcional (se vier, é override no trace)"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - O agente escolhe sozinho a estratégia certa (Priority: P1)

Um plantonista manda uma pergunta ao OpsPilot sem saber (nem querer saber)
qual estratégia de raciocínio usar. Hoje, sem `strategy`, o turno sempre roda
`react` — mesmo quando a pergunta pede um plano em vários passos ("abra um
incidente para cada alerta crítico e me diga o runbook de cada um") ou uma
resposta revisada com cuidado. Com o grafo unificado, cada turno passa por um
fluxo único — **contexto → roteador → estratégia escolhida → resposta** — e o
roteador decide, com uma justificativa curta, qual das três estratégias
atende melhor a pergunta.

**Why this priority**: é o valor central — uma única porta de entrada que
escolhe a forma de raciocinar por pergunta. Sozinha já entrega o benefício.

**Independent Test**: com um roteador de teste que devolve uma rota fixa, enviar
uma pergunta sem `strategy` e verificar que a estratégia executada é a
escolhida, que o rastro abre (após um eventual resumo) com um evento de rota
contendo a rota e a justificativa, e que a resposta vem dessa estratégia.

**Acceptance Scenarios**:

1. **Given** uma pergunta sem `strategy`, **When** o turno roda, **Then** o
   roteador é consultado uma vez, escolhe exatamente uma entre `react`,
   `plan-and-execute` e `reflection`, e só a estratégia escolhida executa.
2. **Given** um turno roteado, **When** a resposta é devolvida, **Then** o
   rastro contém um evento `route` com a rota escolhida, a justificativa
   (`reason`) e a origem `router`, posicionado antes de qualquer evento da
   estratégia.
3. **Given** o prompt do roteador, **When** ele é montado, **Then** contém uma
   tabela com as três rotas e, para cada uma, quando usá-la; a decisão é
   devolvida em formato estruturado (`route`, `reason`), nunca em texto livre.
4. **Given** um turno com conversa, memória e orçamento de contexto, **When**
   ele passa pelo grafo, **Then** o contexto entregue à estratégia é o mesmo
   que seria montado hoje (specs/007, 008, 012, 013) — o grafo não muda o
   prompt das estratégias.

---

### User Story 2 - Forçar uma estratégia e ver que foi forçada (Priority: P2)

Quem compara estratégias (ou depura um caso) quer continuar escolhendo a
estratégia na requisição. Com `strategy` informado, o roteador não decide:
a escolha do cliente vale, e o rastro deixa claro que foi um override.

**Why this priority**: preserva o controle explícito e a compatibilidade com
clientes atuais; depende do fluxo da US1.

**Independent Test**: enviar `strategy: "plan-and-execute"` e verificar que o
roteador não foi consultado (nenhuma chamada de decisão), que a estratégia
pedida executou e que o evento `route` traz origem `override`.

**Acceptance Scenarios**:

1. **Given** `strategy` válido na requisição, **When** o turno roda, **Then** o
   roteador não faz chamada ao modelo, a estratégia pedida executa e o rastro
   contém `route` com essa rota e origem `override`.
2. **Given** `strategy` desconhecido, **When** a requisição chega, **Then** a
   resposta é 422 `unknown_strategy` listando as rotas disponíveis, como hoje,
   e nada é gravado.
3. **Given** um cliente que já envia `strategy: "react"` ou
   `"plan-and-execute"`, **When** atualiza para esta versão, **Then** continua
   funcionando sem mudanças no corpo da requisição.

---

### User Story 3 - Saber qual etapa produziu cada evento (Priority: P3)

Quem lê o rastro de um turno quer saber de qual etapa do fluxo veio cada
evento — o resumo veio do contexto, a rota do roteador, pensamentos e ações
da estratégia — sem inferir pela ordem.

**Why this priority**: observabilidade; depende da US1.

**Independent Test**: rodar um turno que gera resumo, rota e eventos de
estratégia e verificar que todo evento do rastro traz o campo `node`
preenchido com a etapa correta.

**Acceptance Scenarios**:

1. **Given** qualquer turno, **When** a resposta é devolvida, **Then** todo
   evento do rastro tem `node` com um dos valores: `contexto`, `roteador`,
   `react`, `plan-and-execute`, `reflection`, `resposta`.
2. **Given** um turno que gerou resumo (specs/012), **When** a resposta é
   devolvida, **Then** o evento `summarize` tem `node: "contexto"` e continua
   abrindo o rastro, antes do `route`.
3. **Given** um turno roteado para `reflection`, **When** a resposta é
   devolvida, **Then** pensamentos, ações, observações, críticas e a resposta
   produzidos ali têm `node: "reflection"`.

---

### Edge Cases

- O roteador falha (erro do modelo, saída fora do formato, rota inexistente) →
  o turno não cai: segue com `react` e o evento `route` registra origem
  `fallback` com uma justificativa que diz que o roteador falhou (só o nome do
  erro, sem conteúdo da mensagem do usuário no log).
- `strategy` informado e `reflect: true` → a estratégia pedida roda com
  reflexão, como hoje; se a rota já for `reflection`, a reflexão não é aplicada
  duas vezes.
- Sem `strategy` e `reflect: true` → o roteador decide a rota e a reflexão é
  aplicada sobre ela (mesma regra do item anterior).
- A chamada do roteador entra no teto de tempo do turno: se o tempo estoura
  durante a decisão, o turno responde 504 e nada é gravado, como hoje.
- Turno que falha em qualquer nó → nenhuma mensagem é gravada (specs/007).
- O roteador decide só a partir da pergunta atual e do contexto já montado;
  ele nunca executa tools.
- Turno com override não gasta chamada ao modelo para rotear.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Todo turno do `/chat` MUST passar por um único fluxo de etapas
  nomeadas, nesta ordem: `contexto` (monta o contexto do turno), `roteador`
  (decide a rota), uma das três estratégias (`react`, `plan-and-execute`,
  `reflection`) e `resposta` (consolida resposta, rastro e métricas).
- **FR-002**: A etapa `contexto` MUST produzir exatamente o mesmo prompt e as
  mesmas métricas de contexto de hoje (histórico, memória, resumo, orçamento —
  specs/007, 008, 012, 013).
- **FR-003**: Sem `strategy` na requisição, o roteador MUST escolher uma única
  rota entre `react`, `plan-and-execute` e `reflection`, devolvendo uma
  decisão estruturada com `route` (uma das três) e `reason` (texto curto).
- **FR-004**: As instruções do roteador MUST conter uma tabela das rotas
  disponíveis com o critério de uso de cada uma; a lista de rotas da tabela e
  a lista aceita na decisão MUST vir da mesma fonte, para nunca divergirem.
- **FR-005**: A rota `reflection` MUST corresponder a `react` com a camada de
  reflexão (specs/002); `react` e `plan-and-execute` mantêm o comportamento
  atual.
- **FR-006**: Com `strategy` válido na requisição, o roteador MUST NOT chamar
  o modelo; a rota pedida MUST ser executada e registrada como override.
- **FR-007**: `strategy` MUST continuar opcional no `/chat`; valor desconhecido
  MUST resultar em 422 `unknown_strategy` com a lista de rotas disponíveis
  (agora incluindo `reflection`).
- **FR-008**: Todo turno MUST registrar no rastro um evento `route` com
  `route`, `reason` e origem (`router`, `override` ou `fallback`), antes de
  qualquer evento da estratégia e depois do evento `summarize`, quando houver.
- **FR-009**: Se a decisão do roteador falhar ou for inválida, o turno MUST
  seguir com `react` e registrar a origem `fallback`; o log MUST conter só o
  nome do erro.
- **FR-010**: Todo evento do rastro MUST trazer o campo `node` identificando a
  etapa que o produziu.
- **FR-011**: A chamada do roteador MUST contar em `metrics.llmCalls` e em
  `metrics.promptTokens`, e MUST ficar dentro do teto de tempo do turno.
- **FR-012**: `reflect: true` MUST continuar aceito, aplicando reflexão sobre a
  rota escolhida (pelo roteador ou por override), sem aplicá-la duas vezes
  quando a rota já é `reflection`.
- **FR-013**: Gravação da conversa, aprendizado (specs/009) e demais
  comportamentos pós-turno MUST permanecer iguais: só após sucesso, e o
  aprendizado fora da contagem de tokens.
- **FR-014**: A decisão do roteador MUST ser substituível por um dublê
  determinístico nos testes, sem chamada real ao modelo.

### Key Entities

- **Rota**: uma das três formas de raciocinar (`react`, `plan-and-execute`,
  `reflection`), com o critério de quando usá-la (linha da tabela do roteador).
- **Decisão de rota**: `route` + `reason` + origem (`router`, `override`,
  `fallback`); vira o evento `route` do rastro.
- **Etapa (node)**: nome da etapa do fluxo que produziu um evento
  (`contexto`, `roteador`, `react`, `plan-and-execute`, `reflection`, `resposta`).
- **Evento de rastro**: os tipos atuais mais `route`, todos com `node`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% dos turnos do `/chat` devolvem exatamente um evento `route`
  no rastro, e 100% dos eventos do rastro têm `node` preenchido.
- **SC-002**: Em turnos com `strategy` informado, zero chamadas ao modelo são
  gastas para rotear.
- **SC-003**: Uma falha do roteador nunca derruba o turno: em 100% dos casos de
  falha simulada, o turno responde com sucesso via `react`.
- **SC-004**: Num conjunto de perguntas de referência com rota esperada
  (pergunta simples de consulta, tarefa em vários passos, pedido de resposta
  revisada), o roteador acerta a rota em pelo menos 80% dos casos.
- **SC-005**: Clientes que já enviam `strategy` existente não precisam de
  nenhuma mudança no corpo da requisição.
- **SC-006**: Turnos sem `strategy` acrescentam no máximo uma chamada ao modelo
  em relação ao turno equivalente de hoje.

## Assumptions

- "As 3 estratégias" são `react`, `plan-and-execute` e `reflection` (= `react`
  com a camada de reflexão do specs/002).
- Sem `strategy`, o roteador substitui o default fixo `react` atual.
- A etapa `resposta` consolida o resultado e não acrescenta eventos novos ao
  rastro; o evento `answer` produzido pela estratégia mantém o `node` da
  estratégia.
- O formato de resposta do `/chat` só ganha campos (evento `route`, `node` em
  cada evento); nenhum campo existente é removido ou renomeado.
- `npm run arena` e `npm run bench` continuam rodando estratégias diretamente,
  sem passar pelo roteador; levá-los ao grafo fica fora de escopo.
- O servidor MCP não é afetado (expõe tools, não o chat).
- A qualidade do roteador real (SC-004) é avaliada por um script manual com o
  modelo real, como o avaliador do specs/009; os testes automatizados usam
  dublê.

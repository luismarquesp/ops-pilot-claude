# Feature Specification: Medição de Contexto (Tokens)

**Feature Branch**: `011-context-token-metrics`

**Created**: 2026-10-03

**Status**: Draft

**Input**: User description: "Instrumente a medição de contexto: src/context/tokens.ts com estimateTokens (char/4) e o usage real do LangChain; métricas do /chat com promptTokens real e contextBreakdown estimado por fontes; conversa-long.sh imprime o promptTokens por turno. Com testes"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ver quanto contexto um turno realmente consumiu (Priority: P1)

Quem opera o OpsPilot quer saber, a cada resposta do chat, quantos tokens de
entrada o modelo de fato recebeu naquele turno — o número que o provedor
informa, não um palpite. Com histórico (specs/007) e memória (specs/008) o
prompt cresce sozinho a cada turno, e hoje não há como enxergar esse
crescimento nem o custo associado.

**Why this priority**: é a medida de verdade; sem ela, qualquer decisão sobre
cortar histórico ou memória é às cegas. Sozinha já entrega valor.

**Independent Test**: enviar uma pergunta ao chat com um modelo falso que
informa uso de tokens conhecido em cada chamada, e verificar que as métricas
da resposta trazem a soma exata desses tokens de entrada.

**Acceptance Scenarios**:

1. **Given** um turno em que o modelo é chamado uma única vez e informa N
   tokens de entrada, **When** a resposta do chat é devolvida, **Then** as
   métricas trazem `promptTokens = N`.
2. **Given** um turno em que o modelo é chamado várias vezes (uso de tools,
   plan-and-execute, reflexão), **When** a resposta é devolvida, **Then**
   `promptTokens` é a soma dos tokens de entrada informados em todas as
   chamadas do turno.
3. **Given** um provedor que não informa uso de tokens em nenhuma chamada,
   **When** a resposta é devolvida, **Then** `promptTokens` aparece como
   ausente (nulo), nunca como zero, e o turno não falha por isso.
4. **Given** um turno que falha ou estoura o tempo, **When** o erro é
   devolvido, **Then** o comportamento de erro existente não muda.

---

### User Story 2 - Entender de onde vem o contexto (Priority: P2)

Além do total real, o operador quer saber quanto do prompt veio de cada fonte
que o OpsPilot monta: a pergunta atual, o histórico da conversa e os fatos de
memória. Como o provedor só informa o total, essa divisão é uma estimativa
barata e determinística, calculada sobre o texto que cada fonte acrescenta.

**Why this priority**: explica o número da US1 (o que está crescendo?) e
permite comparar fontes, mas é estimado — complementa, não substitui, o real.

**Independent Test**: rodar um turno com histórico e fatos conhecidos e
verificar que cada fonte do detalhamento bate com a estimativa calculada à mão
sobre o texto correspondente.

**Acceptance Scenarios**:

1. **Given** um turno sem histórico e sem `userId`, **When** a resposta é
   devolvida, **Then** o detalhamento tem histórico = 0, memória = 0 e
   pergunta = estimativa do texto da pergunta.
2. **Given** um turno com 12 mensagens de histórico e 3 fatos lembrados,
   **When** a resposta é devolvida, **Then** cada fonte traz a estimativa do
   bloco de texto que ela acrescenta ao prompt, e o total estimado é a soma
   das fontes.
3. **Given** o mesmo texto de entrada, **When** a estimativa é calculada
   várias vezes, **Then** o resultado é sempre o mesmo (determinístico, sem
   chamar o modelo).

---

### User Story 3 - Acompanhar o crescimento numa conversa longa (Priority: P3)

Para demonstrar e investigar o efeito do histórico, o operador roda um script
que conduz uma conversa de vários turnos contra a API local e imprime, turno a
turno, os tokens de entrada reais — vendo a curva subir até o teto de
histórico e estabilizar.

**Why this priority**: ferramenta de observação/demonstração; depende das
métricas da US1 (e opcionalmente da US2) já estarem na resposta.

**Independent Test**: com a API rodando, executar o script e verificar que ele
imprime uma linha por turno com número do turno e `promptTokens`, usando o
mesmo `conversationId` em todos os turnos.

**Acceptance Scenarios**:

1. **Given** a API rodando, **When** o script é executado, **Then** ele envia
   as mensagens na mesma conversa e imprime, para cada turno, o número do
   turno, `promptTokens`, mensagens de histórico usadas e o total estimado.
2. **Given** um turno cujo `promptTokens` vem ausente, **When** o script
   imprime a linha, **Then** mostra um marcador explícito (ex.: `n/d`) em vez
   de quebrar.
3. **Given** a API fora do ar ou um turno com erro HTTP, **When** o script
   roda, **Then** ele para com mensagem de erro clara e código de saída
   diferente de zero.

---

### Edge Cases

- Texto vazio → estimativa 0; texto com 1 a 4 caracteres → estimativa 1
  (arredondamento para cima).
- Caracteres fora do ASCII (acentos, emoji) contam pelo comprimento do texto,
  sem tratamento especial — é estimativa grosseira por definição.
- Algumas chamadas do turno informam uso e outras não → `promptTokens` soma as
  que informaram; só é nulo se nenhuma informou.
- Uso informado pelo provedor em formatos diferentes (metadados de uso
  padronizados vs. metadados brutos da resposta) → ambos são reconhecidos.
- Chamadas ao modelo fora do turno de chat (refletor de aprendizado da
  specs/009, disparado sem esperar) **não** entram no `promptTokens` do turno.
- Turnos concorrentes não podem misturar contagens entre si.
- O detalhamento estimado não cobre instruções de sistema, definições de tools
  nem as mensagens intermediárias do agente; por isso o total estimado tende a
  ser menor que o real — a diferença é esperada e documentada.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST oferecer uma função pura de estimativa de tokens
  que, para um texto, devolve `ceil(comprimento / 4)` (0 para texto vazio).
- **FR-002**: O sistema MUST oferecer uma função pura que extrai os tokens de
  entrada (e, quando houver, de saída e total) do uso informado numa resposta
  do modelo, reconhecendo os formatos de uso expostos pelo LangChain, e
  devolve "ausente" quando nenhum uso é informado.
- **FR-003**: O sistema MUST acumular, por turno de chat, o uso informado em
  todas as chamadas ao modelo feitas pela estratégia (ReAct, plan-and-execute,
  com ou sem reflexão), isolado de outros turnos concorrentes.
- **FR-004**: As métricas da resposta do `/chat` MUST incluir `promptTokens`:
  a soma dos tokens de entrada reais do turno, ou nulo se nenhuma chamada
  informou uso.
- **FR-005**: As métricas da resposta do `/chat` MUST incluir
  `contextBreakdown` com a estimativa (FR-001) por fonte — `question`
  (pergunta atual), `history` (bloco de histórico) e `memory` (bloco de fatos)
  — e um `total` igual à soma das fontes.
- **FR-006**: Cada fonte do detalhamento MUST ser estimada sobre exatamente o
  texto que ela acrescenta ao prompt montado; fonte ausente vale 0.
- **FR-007**: Métricas existentes (`llmCalls`, `latencyMs`, `historyMessages`,
  `memoryFacts`) e o restante do contrato do `/chat` MUST permanecer
  inalterados; os campos novos são aditivos.
- **FR-008**: A instrumentação MUST NOT alterar o prompt enviado ao modelo nem
  a resposta produzida, e falha ao ler o uso MUST NOT derrubar o turno.
- **FR-009**: O projeto MUST incluir um script `conversa-long.sh` que conduz
  uma conversa de vários turnos (mesmo `conversationId`) contra a API local e
  imprime, por turno, número do turno, `promptTokens`, `historyMessages` e
  `contextBreakdown.total`; URL base e quantidade de turnos configuráveis por
  variável de ambiente, com defaults.
- **FR-010**: O script MUST encerrar com código diferente de zero e mensagem
  clara se a API não responder ou devolver erro HTTP.
- **FR-011**: Toda lógica nova (estimativa, extração de uso, acumulação,
  detalhamento, novas métricas do `/chat`) MUST nascer com testes
  automatizados que não dependem de modelo real nem de rede.

### Key Entities

- **Estimativa de tokens**: número inteiro ≥ 0 derivado só do comprimento de
  um texto.
- **Uso do modelo (por chamada)**: tokens de entrada, saída e total informados
  pelo provedor em uma chamada; pode estar ausente.
- **Uso do turno**: acumulado das chamadas de um turno; `promptTokens` é seu
  total de entrada.
- **Detalhamento de contexto**: estimativa por fonte (`question`, `history`,
  `memory`) e `total`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% das respostas bem-sucedidas do chat trazem `promptTokens`
  (valor ou nulo explícito) e `contextBreakdown` com as três fontes e o total.
- **SC-002**: Com modelo falso que informa uso conhecido, `promptTokens` bate
  exatamente com a soma esperada em turnos de 1 e de várias chamadas.
- **SC-003**: Para o mesmo texto, a estimativa é idêntica em execuções
  repetidas, e `total` é sempre a soma das fontes.
- **SC-004**: Numa conversa de 15 turnos, o script imprime 15 linhas e torna
  visível o crescimento dos tokens de entrada até o teto de histórico (12
  mensagens) e sua estabilização depois dele.
- **SC-005**: Nenhum teste existente quebra; a suíte continua rodando sem
  rede nem modelo real.

## Assumptions

- `promptTokens` é a soma dos tokens de entrada de **todas** as chamadas ao
  modelo do turno (reflete custo); o tamanho da maior chamada isolada fica
  fora do escopo desta versão.
- O detalhamento cobre só as fontes que o serviço de chat monta (pergunta,
  histórico, memória); instruções de sistema, schemas de tools e mensagens
  intermediárias do agente não são estimados.
- A heurística de 4 caracteres por token é intencionalmente grosseira; não se
  adiciona tokenizador real.
- O refletor de aprendizado (specs/009) e o embedder local não contam para o
  turno.
- O script fica em `scripts/conversa-long.sh`, roda em shell POSIX (Git Bash
  no Windows), usa `curl` e o próprio Node para ler JSON (sem exigir `jq`), e
  pressupõe a API já iniciada com `npm run dev` (default
  `http://localhost:3000`, 15 turnos). Não faz parte de `npm test`.
- Nenhuma mudança de persistência: as métricas não são gravadas no banco.

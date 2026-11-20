# Feature Specification: Orçamento de Contexto por Seção (ContextBuilder)

**Feature Branch**: `013-context-section-budget`

**Created**: 2026-10-06

**Status**: Draft

**Input**: User description: "ContextBuilder com orçamento por seção. src/context/context-builder.ts monta o prompt de TODAS as estratégias com teto por seção via env CONTEXT_BUDGET_*; system e mensagem intocáveis, resumo 200, janela 1200 (corta as mais antigas), memória 300 (corta menor score). Teste: tetos baixos cortam na ordem certa"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Contexto de tamanho previsível em qualquer estratégia (Priority: P1)

Um plantonista conversa com o OpsPilot durante um incidente longo, com muitos
fatos lembrados e um resumo de conversa crescendo. Hoje cada fonte de contexto
(fatos da memória, resumo, histórico recente) entra no prompt sem limite
próprio: uma mensagem gigante colada no chat (um stack trace, um log) ou um
resumo que inchou empurra o prompt para cima, e o custo e a latência do turno
ficam imprevisíveis. Com o orçamento por seção, cada fonte tem um teto
próprio, a montagem do prompt é a mesma para todas as estratégias de
raciocínio, e o que excede é cortado pela parte menos valiosa de cada seção.

**Why this priority**: é o valor central — teto conhecido de contexto por
turno, independentemente da estratégia e do tamanho da conversa. Sozinha já
entrega o benefício.

**Independent Test**: com tetos baixos e uma pergunta acompanhada de fatos,
resumo e histórico que excedem esses tetos, montar o contexto e verificar que
cada seção ficou dentro do seu teto, que a pergunta saiu intacta e que os
itens removidos foram exatamente os previstos pela regra de corte de cada
seção.

**Acceptance Scenarios**:

1. **Given** fatos, resumo e histórico todos abaixo dos tetos padrão, **When**
   o contexto é montado, **Then** o prompt resultante é idêntico ao de hoje
   (nenhum corte, mesma ordem: fatos → resumo → histórico → pergunta).
2. **Given** um histórico que excede o teto da janela, **When** o contexto é
   montado, **Then** as mensagens **mais antigas** são removidas uma a uma até
   o restante caber, e as mais recentes permanecem inteiras e na ordem.
3. **Given** fatos lembrados que excedem o teto da memória, **When** o contexto
   é montado, **Then** os fatos de **menor relevância** são removidos primeiro
   até o restante caber, e os mantidos seguem do mais para o menos relevante.
4. **Given** um resumo que excede o teto do resumo, **When** o contexto é
   montado, **Then** o resumo é encurtado para caber no teto, mantendo seu
   início.
5. **Given** uma pergunta do usuário muito longa (maior que qualquer teto),
   **When** o contexto é montado, **Then** a pergunta entra integralmente —
   ela nunca é cortada nem conta contra o orçamento das outras seções.
6. **Given** qualquer uma das estratégias de raciocínio disponíveis (com ou
   sem reflexão), **When** um turno roda, **Then** o contexto que ela recebe
   foi montado pela mesma regra de orçamento.

---

### User Story 2 - Ajustar os tetos sem mudar código (Priority: P2)

Quem opera o OpsPilot quer apertar ou afrouxar o orçamento de cada seção
(por exemplo, dar mais espaço ao histórico em um ambiente com modelo de janela
maior) apenas mudando configuração de ambiente na subida do serviço.

**Why this priority**: torna o orçamento operável em ambientes diferentes;
depende da US1.

**Independent Test**: subir com tetos customizados via ambiente e verificar
que os cortes passam a respeitar os novos valores; com valores ausentes ou
inválidos, verificar que os padrões valem.

**Acceptance Scenarios**:

1. **Given** nenhuma configuração de orçamento no ambiente, **When** o serviço
   sobe, **Then** valem os padrões: resumo 200, janela 1200, memória 300
   tokens estimados.
2. **Given** um teto customizado válido para uma seção, **When** o contexto é
   montado, **Then** essa seção respeita o novo teto e as demais seguem com
   seus valores.
3. **Given** um valor inválido para um teto (não numérico, negativo,
   fracionário), **When** o serviço sobe, **Then** aquele teto volta ao padrão
   e o problema é registrado no log sem derrubar o serviço.

---

### User Story 3 - Ver o que foi cortado (Priority: P3)

Quem depura um turno quer saber, pela própria resposta do chat, se o orçamento
cortou algo e de qual seção — sem isso, "o agente esqueceu o que eu disse" é
indistinguível de um corte de orçamento.

**Why this priority**: observabilidade; depende da US1.

**Independent Test**: num turno com cortes, verificar que as métricas da
resposta informam, por seção, quantos itens foram removidos e que o
detalhamento de contexto reflete o que de fato entrou no prompt.

**Acceptance Scenarios**:

1. **Given** um turno em que o orçamento removeu mensagens e fatos e encurtou
   o resumo, **When** a resposta é devolvida, **Then** as métricas informam
   quantas mensagens e quantos fatos foram removidos e se o resumo foi
   encurtado.
2. **Given** um turno com cortes, **When** a resposta é devolvida, **Then** o
   detalhamento estimado de contexto (specs/011), a contagem de mensagens por
   extenso e a contagem de fatos refletem o conteúdo **após** os cortes.
3. **Given** um turno sem cortes, **When** a resposta é devolvida, **Then** as
   métricas de corte vêm zeradas.

---

### Edge Cases

- A mensagem mais recente do histórico, sozinha, já excede o teto da janela →
  ela também é removida (mensagens nunca são cortadas pela metade); a janela
  pode ficar vazia.
- Um único fato excede o teto da memória → é removido; a seção de memória pode
  ficar vazia (e some do prompt, como hoje quando não há fatos).
- Teto configurado como 0 → a seção correspondente fica sempre vazia e some do
  prompt.
- Fatos com a mesma relevância na fronteira do corte → sai primeiro o que
  aparece por último na ordem de relevância recebida (desempate estável e
  determinístico).
- Mensagens removidas da janela por orçamento não somem da conversa: continuam
  gravadas e ainda serão absorvidas pela sumarização (specs/012) quando
  saírem da janela recente.
- O orçamento não altera a sumarização: o gatilho de resumo (specs/012)
  continua contando mensagens, não tokens; o corte acontece só na montagem do
  prompt do turno.
- Sem `userId` (sem memória) e sem conversa anterior → o prompt é só a
  pergunta, como hoje.
- Instruções de sistema das estratégias e descrições de tools nunca são
  medidas nem cortadas pelo orçamento.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST montar o contexto de todas as estratégias de
  raciocínio (com e sem reflexão) por um único componente de montagem, que
  aplica o orçamento por seção antes de o raciocínio começar.
- **FR-002**: As seções orçadas MUST ser: resumo da conversa, janela de
  histórico e memória (fatos lembrados). As instruções de sistema e a
  mensagem atual do usuário MUST ficar fora do orçamento e MUST NOT ser
  alteradas.
- **FR-003**: Os tetos padrão MUST ser: resumo 200, janela 1200, memória 300,
  medidos na mesma estimativa de tokens já usada nas métricas de contexto
  (specs/011), aplicada ao texto que a seção acrescenta ao prompt (incluindo
  seu cabeçalho).
- **FR-004**: Cada teto MUST poder ser substituído por configuração de
  ambiente própria (uma variável por seção, prefixo `CONTEXT_BUDGET_`), lida
  e validada na subida do serviço; valor ausente ou inválido MUST cair no
  padrão, e valor inválido MUST ser registrado no log.
- **FR-005**: Janela acima do teto → MUST remover as mensagens mais antigas,
  inteiras, até caber; as restantes mantêm a ordem original.
- **FR-006**: Memória acima do teto → MUST remover os fatos de menor
  relevância, inteiros, até caber; os restantes mantêm a ordem de relevância.
- **FR-007**: Resumo acima do teto → MUST ser encurtado para caber, mantendo o
  início do texto e preferindo terminar em fim de linha/tópico.
- **FR-008**: Seções sem conteúdo após o corte MUST sumir do prompt, sem deixar
  cabeçalho vazio.
- **FR-009**: Abaixo dos tetos, o prompt montado MUST ser idêntico ao atual
  (mesma ordem fatos → resumo → histórico → pergunta, mesmo texto).
- **FR-010**: A regra de corte MUST ser determinística: mesma entrada e mesmos
  tetos → mesmo prompt, sem chamada a modelo, rede ou banco.
- **FR-011**: As métricas do chat MUST informar, por turno, quantas mensagens e
  quantos fatos foram removidos pelo orçamento e se o resumo foi encurtado; o
  detalhamento de contexto, `historyMessages` e `memoryFacts` MUST refletir o
  conteúdo após os cortes.
- **FR-012**: O comportamento MUST ser coberto por testes com tetos baixos que
  verifiquem a ordem de corte de cada seção (mais antigas na janela, menor
  relevância na memória, final do resumo), a intocabilidade da pergunta, a
  independência entre seções e a leitura/validação dos tetos via ambiente.

### Key Entities

- **Orçamento de contexto**: conjunto de tetos por seção (resumo, janela,
  memória), com padrões e substituição por ambiente.
- **Seção de contexto**: bloco do prompt com conteúdo próprio, cabeçalho e
  regra de corte; a pergunta é uma seção fixa, fora do orçamento.
- **Relatório de cortes**: por turno, quantas mensagens e fatos foram
  removidos e se o resumo foi encurtado.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Em 100% dos turnos, cada seção orçada fica dentro do seu teto
  estimado, qualquer que seja o tamanho da conversa, da memória ou do resumo.
- **SC-002**: Com os tetos padrão, a soma estimada de resumo + histórico +
  memória nunca passa de 1700 tokens por turno, em todas as estratégias.
- **SC-003**: Em conversas abaixo dos tetos, 100% dos prompts são idênticos
  aos produzidos antes da feature (sem regressão).
- **SC-004**: A pergunta do usuário chega íntegra ao raciocínio em 100% dos
  turnos, inclusive quando sozinha excede todos os tetos.
- **SC-005**: Um operador muda o teto de uma seção apenas com configuração de
  ambiente e reinício, sem alteração de código.

## Assumptions

- "Tokens" significa a estimativa já adotada pelo projeto (≈ 4 caracteres por
  token, specs/011); não há tokenizador real do modelo nesta versão.
- O teto mede o bloco inteiro que a seção acrescenta (cabeçalho + conteúdo),
  coerente com o detalhamento de contexto existente.
- Nomes das variáveis: `CONTEXT_BUDGET_SUMMARY`, `CONTEXT_BUDGET_WINDOW`,
  `CONTEXT_BUDGET_MEMORY` (inteiros ≥ 0); documentadas em `.env.example`.
- Não há teto global além da soma das seções; a pergunta e as instruções de
  sistema podem fazer o prompt total passar de 1700.
- As seções são orçadas de forma independente: sobra de uma não é emprestada a
  outra.
- O resumo encurtado no prompt não altera o resumo persistido (specs/012).
- A relevância dos fatos é a pontuação de similaridade já devolvida pela
  recuperação da memória (specs/008).
- As mensagens intermediárias do agente (pensamentos, chamadas e resultados de
  tools dentro do turno) ficam fora do orçamento nesta versão.

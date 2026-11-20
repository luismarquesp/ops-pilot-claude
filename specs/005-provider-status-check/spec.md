# Feature Specification: Status de Provedores Externos

**Feature Branch**: `005-provider-status-check`

**Created**: 2026-09-21

**Status**: Draft

**Input**: User description: "Tool de status de provedores externos: Tool check_provider_status em src/agents/tool.ts: consulta a statuspage publica do provedor via API statuspage.io (sem chave): github -> https://www.githubstatus.com/api/v2/status.json; cloudflare -> https://www.cloudflarestatus.com/api/v2/status.json. Parâmetro provider: (enum: github | cloudflare, default \"github\", describe explicando). Descrição orientada a quando usar: suspeita de problema externo, 'é o nosso ou do provedor?', dependência fora do ar. Resiliência: timeout de 5s, via AbortSignal.timeout; falha de rede ou 5xx, UMA nova tentativa; resposta validada com zod. ({ status: { indicador, description }}); qualquer falha final retorna string de erro legível como resultado da tool (erro é observação - nunca lançar exceção fora da tool). Retorno compacto (indicador + descrição, uma linha), para não inflar o contexto. Teste: a função fetch é injetável; testes cobrem sucesso, timeout, resposta inválida sem uso de rede (fake fetch)"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Checar se o problema é nosso ou do provedor (Priority: P1)

Durante um incidente, o plantonista suspeita que a causa não é interna — pode ser
uma dependência externa (ex.: GitHub, Cloudflare) fora do ar. Sem sair da
conversa com o copiloto, ele pergunta pelo status público daquele provedor e
recebe uma resposta objetiva.

**Why this priority**: É o valor central da feature — encurtar o tempo de
diagnóstico durante um incidente, evitando que o time invista tempo investigando
algo que na verdade é um problema externo conhecido (ou descartando essa hipótese
rapidamente quando o provedor está saudável).

**Independent Test**: Pedir o status de um provedor suportado (ex.: "o GitHub
está com problema?") e confirmar que a resposta traz o status atual daquele
provedor especificamente, em uma frase objetiva.

**Acceptance Scenarios**:

1. **Given** o plantonista suspeita de um problema externo, **When** ele pede o
   status do GitHub, **Then** recebe uma resposta curta com o nível de saúde
   atual do GitHub e uma descrição objetiva.
2. **Given** o plantonista pede o status sem indicar qual provedor, **When** a
   consulta é feita, **Then** o provedor padrão (GitHub) é consultado.
3. **Given** o plantonista pede o status do Cloudflare, **When** a consulta é
   feita, **Then** recebe o status atual do Cloudflare, não o de outro provedor.
4. **Given** o plantonista pede o status de um provedor que não é suportado,
   **When** ele faz o pedido, **Then** recebe uma indicação clara de que esse
   provedor não está disponível para consulta, sem que nenhuma consulta externa
   chegue a ser feita.

---

### User Story 2 - Resposta confiável mesmo quando o provedor está lento ou instável (Priority: P2)

A própria página de status pública de um provedor pode estar lenta, fora do ar,
ou retornar algo inesperado — justamente no momento em que o plantonista mais
precisa de uma resposta rápida. A consulta nunca deve travar a conversa nem
quebrar a interação do copiloto.

**Why this priority**: Sem essa garantia, a própria ferramenta de diagnóstico
vira um novo ponto de falha durante um incidente — o que anula o valor da User
Story 1 exatamente na hora em que ela mais importa.

**Independent Test**: Simular uma consulta que nunca responde e uma que retorna
dados corrompidos/inesperados, e confirmar que em ambos os casos o plantonista
recebe uma mensagem de erro legível em poucos segundos, nunca um travamento ou
uma falha não tratada da conversa.

**Acceptance Scenarios**:

1. **Given** a página de status do provedor não responde a tempo, **When** o
   plantonista pede o status, **Then** ele recebe uma mensagem de erro legível
   em poucos segundos, em vez de esperar indefinidamente.
2. **Given** a página de status do provedor responde de forma inesperada
   (formato diferente do esperado), **When** o plantonista pede o status,
   **Then** ele recebe uma mensagem de erro legível, nunca uma falha que
   interrompe a conversa.
3. **Given** uma falha passageira na primeira tentativa de consulta, **When** a
   consulta é refeita automaticamente uma vez, **Then** o plantonista recebe o
   status normalmente se a segunda tentativa funcionar.

---

### Edge Cases

- O que acontece se o parâmetro de provedor não for informado? Assume o provedor
  padrão (GitHub) — coberto pelo Acceptance Scenario 2 da User Story 1.
- O que acontece se o provedor pedido não for um dos suportados? A consulta é
  rejeitada antes de qualquer chamada externa — coberto pelo Acceptance Scenario
  4 da User Story 1.
- O que acontece se a consulta externa demorar mais que o tempo tolerado? Vira
  uma falha tratada (mensagem de erro legível), não uma espera indefinida —
  coberto pela User Story 2.
- O que acontece se a resposta do provedor vier em um formato inesperado
  (não é o que a integração espera)? Tratada como falha, mesma resposta de erro
  legível das demais falhas — coberto pela User Story 2.
- O que acontece depois que a única nova tentativa automática também falha? O
  plantonista recebe a mensagem de erro legível — a conversa continua
  normalmente, ele pode tentar de novo ou seguir por outro caminho.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema DEVE permitir que o plantonista consulte, de dentro da
  conversa, o status público atual de um provedor externo suportado.
- **FR-002**: Os provedores suportados nesta primeira versão são GitHub e
  Cloudflare; nenhum outro provedor pode ser consultado por esta capacidade.
- **FR-003**: Quando o plantonista não especifica qual provedor consultar, o
  sistema DEVE consultar o GitHub por padrão.
- **FR-004**: Quando o plantonista pede um provedor fora dos suportados, o
  sistema DEVE recusar o pedido de forma clara, sem chegar a fazer nenhuma
  consulta externa.
- **FR-005**: A consulta DEVE retornar dentro de um tempo curto e limitado,
  mesmo que a página de status do provedor esteja lenta ou não responda —
  nunca deixando a conversa esperando indefinidamente.
- **FR-006**: Diante de uma falha passageira na consulta (rede instável ou
  indisponibilidade momentânea do provedor), o sistema DEVE tentar novamente
  automaticamente exatamente uma vez antes de desistir.
- **FR-007**: Se, mesmo depois da nova tentativa, a consulta não puder ser
  concluída (por lentidão, indisponibilidade ou resposta em formato
  inesperado), o sistema DEVE responder com uma mensagem de erro legível, e
  NÃO DEVE interromper a conversa de forma abrupta ou não tratada.
- **FR-008**: A resposta de uma consulta bem-sucedida DEVE ser objetiva e
  curta — o nível de saúde atual do provedor mais uma descrição breve, sem
  detalhes adicionais que não ajudem a responder "é o nosso ou é do
  provedor?".
- **FR-009**: A capacidade de consultar o status de um provedor externo DEVE
  ser descrita de forma que fique claro que ela serve para investigar suspeita
  de causa externa/upstream — distinta de abrir ou rastrear um incidente
  interno do próprio time.
- **FR-010**: A suíte de testes automatizados DEVE cobrir consulta bem-sucedida,
  consulta que excede o tempo tolerado, e consulta com resposta em formato
  inesperado, nenhum desses casos exigindo uma chamada de rede real.

### Key Entities

- **Provedor externo**: uma dependência de terceiros cujo status público pode
  ser consultado (nesta versão: GitHub ou Cloudflare).
- **Resultado da consulta de status**: o resumo objetivo devolvido ao
  plantonista — nível de saúde atual do provedor e uma descrição breve.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um plantonista consegue saber o status atual de um provedor
  suportado sem sair da conversa com o copiloto, em uma única pergunta.
- **SC-002**: Mesmo quando a página de status do provedor está lenta ou fora
  do ar, o plantonista recebe uma resposta (de sucesso ou de erro legível) em
  poucos segundos — nunca uma espera indefinida.
- **SC-003**: 100% das consultas a um provedor não suportado são recusadas
  antes de qualquer chamada externa, com uma mensagem clara sobre quais
  provedores são válidos.
- **SC-004**: A resposta de uma consulta bem-sucedida cabe em uma única frase
  objetiva, independentemente de quanto detalhe a página do provedor
  disponibilize.
- **SC-005**: A suíte de testes automatizados valida sucesso, lentidão/tempo
  esgotado e resposta inesperada sem depender de acesso real à rede.

## Assumptions

- Os dois provedores suportados nesta primeira versão (GitHub e Cloudflare)
  expõem uma página de status pública, sem necessidade de autenticação/chave
  de acesso.
- "Objetiva e curta" significa nível de saúde atual + uma descrição breve —
  sem histórico de incidentes, sem detalhamento por componente, sem
  informações adicionais da página do provedor.
- Uma falha de rede ou uma indisponibilidade momentânea do provedor é tratada
  como passageira e ganha exatamente uma nova tentativa automática; uma
  resposta em formato inesperado do provedor é tratada como falha final,
  sem nova tentativa adicional além da já prevista para timeout/indisponibilidade.
- O tempo tolerado por tentativa de consulta é curto (da ordem de poucos
  segundos) — suficiente para uma resposta normal da página de status, curto o
  bastante para nunca travar a conversa.
- Esta capacidade é somente leitura sobre o status de terceiros — ela nunca
  abre, resolve ou altera incidentes/alertas do próprio OpsPilot; se o
  plantonista quiser registrar o achado como um incidente interno, isso
  continua sendo feito separadamente pela capacidade já existente de abrir
  incidentes.
- Novos provedores além de GitHub/Cloudflare podem ser adicionados no futuro,
  mas estão fora do escopo desta versão.

# Feature Specification: Persistência Real de Operações (SQLite)

**Feature Branch**: `004-sqlite-ops-persistence`

**Created**: 2026-09-16

**Status**: Draft

**Input**: User description: "Persistência real de operações: SqlliteOpsStore (src/store/sqlite-ops-store.ts) implementa a interface OpsStore existente via node:sqlite (DatabaseSync); caminho em OPSPILOT_DB (default ./data/opspilot.db); \":memory:\" nos testes; 4 tabelas - services, alerts, incidents, runbooks - espelhando os tipos atuais do dominínio (incidents ganha resolved_at e summary, anuláveis); DDL idempotente no construtor; CHECK em todo campo de domínio fechado (tier, severity, status); seed idempotente = cenário Mercadinho do mock (5 serviços, 6 alertas: 3 firing, 3 resolved; runbooks de checkout/payments/auth); prepared statements em toda query; Sem SQL concatenado; tools novas: list_incidents (status open | resolved | all, default open) e consultar_runbook(service); composição injeta o SqliteOpsStore; mock in memory fica para testes e para o bench; data/ no .gitignore; revisar descrições de src/agents/tools.ts pelas 6 regras; testes \":memory:\" seed, abrir/listar/resolver, filtros CHECKS; testes das tools existentes passam a rodar sobre \":memory:\""

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Dados sobrevivem a um restart (Priority: P1)

Um plantonista abre e resolve incidentes ao longo do dia. Depois de um restart do
processo (deploy, reinício do serviço, queda e volta), ele espera encontrar
exatamente o mesmo estado que deixou — nada de incidentes que "voltaram a abrir"
ou de alertas que desapareceram porque viviam só na memória do processo.

**Why this priority**: É o motivo de existir desta feature — sem persistência real,
o copiloto não pode ser confiado com o histórico de operações de um plantão de
verdade; cada restart apaga o trabalho feito.

**Independent Test**: Abrir um incidente, resolver outro, reiniciar o processo, e
confirmar que a lista de incidentes reflete exatamente as duas ações — sem precisar
de nenhuma outra funcionalidade da feature para validar isso.

**Acceptance Scenarios**:

1. **Given** um incidente foi aberto em uma execução anterior do sistema, **When** o
   processo é reiniciado, **Then** o incidente continua aparecendo na listagem, com
   os mesmos dados.
2. **Given** um incidente foi resolvido em uma execução anterior, **When** o
   processo é reiniciado, **Then** o incidente aparece como resolvido, com o
   horário de resolução preservado.
3. **Given** o sistema nunca rodou antes neste ambiente, **When** ele é iniciado
   pela primeira vez, **Then** um cenário de demonstração completo já está
   disponível (serviços, alertas e runbooks), sem passos manuais de setup.
4. **Given** o sistema já rodou antes e já tem dados, **When** ele é iniciado
   novamente, **Then** o cenário de demonstração NÃO é duplicado — os dados
   existentes permanecem como estavam.

---

### User Story 2 - Consultar e filtrar incidentes por status (Priority: P2)

Durante o plantão, o operador quer saber rapidamente "o que ainda está aberto" sem
precisar ler a lista inteira de tudo que já aconteceu, mas também quer poder olhar
o histórico completo (incluindo o que já foi resolvido) quando precisar investigar
algo.

**Why this priority**: É a ação mais frequente de um plantão ("como está a
situação agora?"); depende da persistência (US1) mas é o valor de uso do dia a dia.

**Independent Test**: Com um conjunto conhecido de incidentes abertos e resolvidos
já persistidos, pedir a listagem filtrando por "aberto", depois por "resolvido",
depois por "todos", e conferir que cada resposta traz exatamente o subconjunto
esperado.

**Acceptance Scenarios**:

1. **Given** existem incidentes abertos e resolvidos, **When** o operador pede a
   listagem sem especificar um filtro, **Then** apenas os incidentes abertos são
   retornados (esse é o comportamento padrão).
2. **Given** existem incidentes abertos e resolvidos, **When** o operador pede
   explicitamente pelos resolvidos, **Then** apenas os incidentes resolvidos são
   retornados.
3. **Given** existem incidentes abertos e resolvidos, **When** o operador pede por
   "todos", **Then** tanto os abertos quanto os resolvidos são retornados.

---

### User Story 3 - Consultar runbook de um serviço (Priority: P3)

No meio de um incidente, o operador quer saber rapidamente qual é o procedimento
recomendado para aquele serviço específico, sem precisar sair do fluxo de
conversa com o copiloto para procurar documentação em outro lugar.

**Why this priority**: Agrega valor de resposta a incidente, mas é um complemento
às duas capacidades centrais (persistir e listar) — o plantão funciona sem ela,
só é mais lento sem essa orientação.

**Independent Test**: Pedir o runbook de um serviço que tem um cadastrado (ex.:
checkout) e confirmar que o conteúdo retornado é o procedimento daquele serviço;
pedir o runbook de um serviço sem procedimento cadastrado e confirmar uma resposta
clara de "não encontrado", não um erro genérico.

**Acceptance Scenarios**:

1. **Given** o serviço "checkout" tem um runbook cadastrado, **When** o operador
   pede o runbook desse serviço, **Then** o procedimento correspondente é
   retornado.
2. **Given** um serviço não tem runbook cadastrado, **When** o operador pede o
   runbook desse serviço, **Then** o sistema responde de forma clara que não há
   runbook disponível, sem falhar.

---

### Edge Cases

- O que acontece se alguém tentar registrar um serviço, alerta ou incidente com um
  valor fora do conjunto permitido (ex.: uma severidade ou um status que não
  existe)? O registro deve ser rejeitado antes de ser salvo, nunca armazenado
  silenciosamente com um valor inválido.
- O que acontece ao tentar resolver um incidente que já está resolvido? A operação
  não deve corromper o dado nem falhar de forma confusa — o incidente permanece
  resolvido, com uma resposta clara ao operador.
- O que acontece ao pedir a listagem ou o runbook de um serviço que nunca existiu?
  O sistema responde com uma mensagem de erro de domínio compreensível, nunca uma
  falha não tratada.
- O que acontece quando os testes automatizados rodam? Eles não podem depender de
  nem alterar nenhum dado real em disco — precisam de um ambiente isolado e
  descartável, reiniciado a cada execução.
- O que acontece com os cenários de demonstração/comparação de estratégias
  (arena e benchmark)? Eles precisam continuar reproduzíveis execução após
  execução, então não dependem do armazenamento durável — usam um cenário fixo e
  isolado.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema DEVE persistir de forma durável serviços, alertas/incidentes
  e runbooks, de modo que o estado sobreviva a um restart do processo.
- **FR-002**: O sistema DEVE preparar automaticamente a estrutura de armazenamento
  necessária ao iniciar, de forma segura para ser executada repetidamente (sem
  erros nem duplicação em inícios subsequentes).
- **FR-003**: O sistema DEVE popular um cenário de demonstração padrão na primeira
  vez que roda em um ambiente novo, contendo 5 serviços, 6 alertas/incidentes
  (3 em aberto, 3 resolvidos) e runbooks para os serviços de checkout, pagamentos
  e autenticação.
- **FR-004**: O sistema NÃO DEVE duplicar o cenário de demonstração em inícios
  subsequentes — popular esses dados é uma operação idempotente.
- **FR-005**: O sistema DEVE rejeitar o registro de qualquer serviço, alerta ou
  incidente cujo valor, em um campo de domínio fechado (ex.: criticidade do
  serviço, severidade e status do alerta/incidente), esteja fora do conjunto de
  valores permitido para aquele campo.
- **FR-006**: Operadores DEVEM poder listar incidentes filtrando por status: em
  aberto, resolvidos, ou todos — com "em aberto" como filtro padrão quando nenhum
  é especificado.
- **FR-007**: Operadores DEVEM continuar podendo abrir um novo incidente para um
  serviço monitorado, informando título, serviço e severidade.
- **FR-008**: Operadores DEVEM continuar podendo marcar um incidente aberto como
  resolvido, informando seu identificador.
- **FR-009**: Ao resolver um incidente, o sistema DEVE registrar o momento da
  resolução e PODE registrar um resumo de fechamento (campo opcional).
- **FR-010**: Operadores DEVEM poder consultar o procedimento (runbook)
  recomendado para um serviço específico.
- **FR-011**: Quando o operador pede uma listagem, abertura, resolução ou consulta
  de runbook referente a um serviço ou incidente inexistente, o sistema DEVE
  responder com uma mensagem de erro de domínio clara, e NÃO DEVE encerrar a
  interação de forma abrupta ou não tratada.
- **FR-012**: Cada ação disponível ao operador (listar alertas, listar incidentes,
  abrir incidente, resolver incidente, consultar runbook) DEVE ser descrita de
  forma que fique inequívoco quando usar cada uma — em particular, a diferença
  entre listar o que já existe e abrir algo novo — e todo campo de entrada de
  valores fechados DEVE deixar explícitas as opções válidas.
- **FR-013**: A suíte de testes automatizados DEVE ser capaz de exercitar o
  comportamento completo de persistência (popular dados, abrir, listar, resolver,
  filtrar, e rejeitar valores inválidos de campos fechados) sem depender de
  nenhum dado real em disco.
- **FR-014**: As ferramentas de demonstração e de comparação de estratégias
  (arena e benchmark) DEVEM continuar operando sobre um cenário isolado e
  reproduzível, independente do armazenamento durável usado em produção/dev.

### Key Entities

- **Serviço**: um componente monitorado da operação (ex.: checkout, pagamentos,
  autenticação); tem um nome e uma classificação de criticidade.
- **Alerta/Incidente**: um evento operacional associado a um serviço; tem título,
  severidade, status (em aberto ou resolvido), e, quando resolvido, o momento da
  resolução e, opcionalmente, um resumo de fechamento.
- **Runbook**: o procedimento de remediação recomendado para um serviço,
  consultado durante o tratamento de um incidente.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Depois de um restart do sistema, 100% dos incidentes abertos ou
  resolvidos antes do restart continuam visíveis exatamente como foram deixados.
- **SC-002**: Um ambiente novo, ao ser iniciado pela primeira vez, fica pronto para
  uso com o cenário de demonstração completo (5 serviços, 6 incidentes, 3
  runbooks) sem nenhum passo manual de configuração.
- **SC-003**: Iniciar o sistema uma segunda vez (ou mais) nunca duplica os dados de
  demonstração.
- **SC-004**: 100% das tentativas de registrar um valor inválido em um campo de
  domínio fechado são rejeitadas antes de chegarem a ser salvas.
- **SC-005**: Um operador encontra a orientação de remediação para um incidente de
  checkout, pagamentos ou autenticação em uma única pergunta/ação, sem precisar
  sair da conversa com o copiloto.
- **SC-006**: A suíte de testes automatizados completa (persistência e
  ferramentas existentes) roda e passa sem exigir nenhum arquivo ou banco de
  dados real presente no ambiente de execução.

## Assumptions

- A persistência é implementada como um armazenamento local embarcado em arquivo,
  com o caminho do arquivo configurável por variável de ambiente e um valor
  padrão dentro de uma pasta de dados do projeto; as execuções de teste usam uma
  instância totalmente isolada em memória, nunca o arquivo real.
- O conteúdo exato do cenário de demonstração ("Mercadinho" — nomes de serviços,
  títulos de alertas, texto dos runbooks) é ilustrativo; o que importa é respeitar
  as contagens descritas (5 serviços, 6 incidentes sendo 3 abertos e 3 resolvidos,
  3 runbooks para checkout/pagamentos/autenticação).
- As categorias de criticidade de serviço são um novo campo de domínio fechado;
  seus valores específicos são definidos no planejamento técnico, seguindo o
  mesmo padrão de validação já usado para severidade e status.
- Um cenário de dados isolado e reproduzível (não o armazenamento durável)
  continua disponível para uso pelos testes automatizados e pelas ferramentas de
  demonstração/benchmark, para que seus resultados não dependam do estado
  acumulado do armazenamento real.
- Resolver um incidente que já está resolvido é tratado como uma operação segura
  (idempotente) — não é necessário impedir a chamada, apenas garantir que o dado
  final permaneça consistente.
- Não é necessário migrar dados de qualquer armazenamento anterior usado para
  demonstração; o novo armazenamento durável começa com seu próprio cenário
  populado do zero.
- Acesso concorrente de múltiplos processos escrevendo ao mesmo tempo no
  armazenamento durável não é um requisito desta iteração.

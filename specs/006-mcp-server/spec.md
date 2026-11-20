# Feature Specification: MCP Server (stdio) para OpsPilot

**Feature Branch**: `006-mcp-server`

**Created**: 2026-09-22

**Status**: Draft

**Input**: User description: "MCP server do OpsPilot: src/mcp/server.ts com @modelcontextprotocol/sdk, transport stdio, expondo list_alerts, open_incident e resolve_incident - reutilizando o mesmo OpsStore e os mesmos schemas zod das tools existentes (uma unica fonte de verdade). Nome do server: opspilot. Script npm: mcp = \"tsx src/mcp/server.ts\" (se precisar de env, alterar o script e carregar ela antes). REGRA CRÍTICA: nenhum console.log no server - no stdio o stdout é o canal do protocolo; diagnóstico vai para o stderr. Test: sobre o server e valida o list de tools"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Conectar um cliente MCP ao OpsPilot e ver as ferramentas disponíveis (Priority: P1)

Um desenvolvedor/integrador configura um cliente compatível com MCP (ex.: um app de
desktop com suporte a MCP, ou outro agente) para conversar com o OpsPilot via processo
local (stdio), em vez de usar a API HTTP existente. Ao conectar, o cliente precisa
descobrir quais ferramentas o OpsPilot expõe e o que cada uma faz, sem precisar
consultar a implementação do LangChain.

**Why this priority**: É a base de tudo — sem uma conexão MCP que anuncie corretamente
o servidor `opspilot` e suas ferramentas, nenhuma das outras capacidades pode ser usada
por um cliente MCP.

**Independent Test**: Conectar um cliente MCP ao processo do servidor e confirmar que
ele responde como o servidor `opspilot`, anunciando exatamente as ferramentas
esperadas, cada uma com nome, descrição e schema de entrada corretos.

**Acceptance Scenarios**:

1. **Given** um cliente MCP inicia o processo do servidor via stdio, **When** o
   cliente lista as ferramentas disponíveis, **Then** recebe exatamente três
   ferramentas: `list_alerts`, `open_incident` e `resolve_incident`.
2. **Given** o cliente já tem a lista de ferramentas, **When** ele inspeciona uma
   delas, **Then** o nome, a descrição e o schema de entrada são idênticos aos da
   ferramenta equivalente já usada pelo agente LangChain do OpsPilot.
3. **Given** o servidor foi iniciado, **When** o cliente observa o fluxo bruto do
   processo, **Then** o canal de saída padrão (stdout) contém apenas mensagens do
   protocolo MCP — nenhuma linha de log ou diagnóstico aparece ali.

---

### User Story 2 - Consultar alertas e abrir um incidente por um cliente MCP (Priority: P2)

Durante um plantão, o plantonista (ou o agente que o representa) usando um cliente MCP
quer saber o que está disparando agora e, ao identificar um problema real, registrar
formalmente um incidente para aquele serviço — tudo pela mesma via MCP, sem precisar da
API HTTP.

**Why this priority**: É o par de ações que transforma a conexão (User Story 1) em
valor real: enxergar o que está acontecendo e agir abrindo um incidente.

**Independent Test**: Pela conexão MCP, chamar `list_alerts` e confirmar que a lista
retornada reflete o estado real dos alertas; em seguida chamar `open_incident` para um
serviço válido e confirmar que o incidente criado aparece com os mesmos dados que a
via HTTP/LangChain produziria para a mesma chamada.

**Acceptance Scenarios**:

1. **Given** existem alertas disparando, **When** o cliente MCP chama `list_alerts`
   sem parâmetros, **Then** recebe os alertas com status "firing" (o mesmo
   comportamento padrão da ferramenta equivalente já existente).
2. **Given** um serviço monitorado existente, **When** o cliente MCP chama
   `open_incident` com título, serviço e severidade válidos, **Then** um novo
   incidente é criado e devolvido com seus dados (id, status "open", etc.).
3. **Given** o cliente MCP chama `open_incident` para um serviço que não existe,
   **When** a chamada é processada, **Then** o resultado da ferramenta traz uma
   mensagem de erro legível, sem que o processo do servidor caia ou trave a conexão.

---

### User Story 3 - Resolver um incidente por um cliente MCP (Priority: P3)

Depois de tratar o problema, o plantonista (via cliente MCP) fecha o ciclo marcando o
incidente correspondente como resolvido, pela mesma conexão usada para abri-lo.

**Why this priority**: Fecha o ciclo de vida do incidente começado na User Story 2;
tem prioridade menor porque só faz sentido depois que abrir/consultar já funciona.

**Independent Test**: Pela conexão MCP, chamar `resolve_incident` com o id de um
incidente aberto e confirmar que ele passa a "resolved"; chamar novamente com um id
inexistente e confirmar que o erro volta como resultado legível da ferramenta.

**Acceptance Scenarios**:

1. **Given** um incidente aberto existente, **When** o cliente MCP chama
   `resolve_incident` com o id desse incidente, **Then** o incidente retorna com
   status "resolved".
2. **Given** um id que não corresponde a nenhum incidente, **When** o cliente MCP
   chama `resolve_incident` com esse id, **Then** o resultado da ferramenta traz uma
   mensagem de erro legível, sem que o processo do servidor caia ou trave a conexão.

---

### Edge Cases

- O que acontece se o cliente MCP chamar uma ferramenta com um parâmetro fora do
  schema esperado (ex.: severidade inválida)? A chamada é rejeitada pela validação
  zod antes de qualquer acesso ao `OpsStore`, com um erro legível como resultado da
  ferramenta — coberto pelo mesmo comportamento das ferramentas LangChain existentes.
- O que acontece se não houver nenhum alerta disparando no momento de `list_alerts`?
  A ferramenta retorna uma lista vazia, não um erro.
- O que acontece se algum código do processo tentar escrever no stdout (ex.: um
  `console.log` esquecido)? Isso corromperia o canal do protocolo MCP e quebraria a
  capacidade do cliente de interpretar as respostas — por isso nenhuma saída de
  diagnóstico pode ir para stdout; toda saída de diagnóstico vai para stderr.
- O que acontece se o servidor precisar de variáveis de ambiente para funcionar (ex.:
  caminho do banco)? Elas são carregadas antes do servidor iniciar, pelo script npm
  dedicado, sem expor segredos em log.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema DEVE expor um servidor MCP, em `src/mcp/server.ts`, que
  responde a clientes MCP como o servidor `opspilot`, usando transporte stdio.
- **FR-002**: O servidor MCP DEVE expor exatamente três ferramentas: `list_alerts`,
  `open_incident` e `resolve_incident` — nenhuma ferramenta adicional nesta versão.
- **FR-003**: O schema de entrada (validação zod) de cada ferramenta exposta via MCP
  DEVE ser o mesmo já definido para a ferramenta equivalente usada pelo agente
  LangChain — não pode existir uma segunda definição divergente do mesmo contrato.
- **FR-004**: O comportamento de negócio de cada ferramenta exposta via MCP DEVE ser
  implementado sobre o mesmo `OpsStore` (mesma interface/instância de persistência)
  já usado pelo restante da aplicação — nenhuma implementação de store paralela ou
  duplicada apenas para o MCP.
- **FR-005**: `list_alerts` via MCP DEVE suportar o mesmo filtro de status e o mesmo
  comportamento padrão (status "firing" quando não informado) da ferramenta
  `list_alerts` já existente.
- **FR-006**: `open_incident` via MCP DEVE criar um incidente através do `OpsStore` e
  devolver o incidente criado; se o serviço referenciado não existir, o erro de
  domínio DEVE voltar como resultado normal da ferramenta (mensagem legível), nunca
  como uma exceção não tratada que derruba o processo do servidor.
- **FR-007**: `resolve_incident` via MCP DEVE resolver um incidente pelo id através do
  `OpsStore`; se o id não corresponder a nenhum incidente, o erro de domínio DEVE
  voltar como resultado normal da ferramenta, nunca como falha não tratada.
- **FR-008**: O processo do servidor MCP NUNCA DEVE escrever no stdout fora das
  mensagens do próprio protocolo MCP — nenhuma chamada a `console.log` (ou
  equivalente que escreva em stdout) é permitida no código do servidor; qualquer
  saída de diagnóstico DEVE ir para stderr.
- **FR-009**: O servidor MCP DEVE ser iniciável por um script npm dedicado (`npm run
  mcp`), que executa `src/mcp/server.ts` via `tsx`.
- **FR-010**: Caso o servidor precise de variáveis de ambiente para operar, o script
  npm DEVE carregá-las antes de iniciar o servidor, seguindo o mesmo mecanismo nativo
  já usado pelo script `dev` do projeto (sem introduzir uma biblioteca como
  `dotenv`).
- **FR-011**: Uma suíte de testes automatizados DEVE validar que o servidor MCP
  anuncia corretamente suas três ferramentas (nome, descrição e schema de entrada)
  a um cliente conectado.

### Key Entities

- **Servidor MCP `opspilot`**: o processo, iniciado via stdio, que expõe um
  subconjunto das capacidades já existentes do OpsPilot (alertas e incidentes) a
  qualquer cliente compatível com o Model Context Protocol.
- **Ferramenta MCP**: cada uma das três capacidades expostas (`list_alerts`,
  `open_incident`, `resolve_incident`); não é uma nova entidade de negócio — é a
  mesma ferramenta já usada pelo agente LangChain, apenas anunciada por um segundo
  transporte (MCP/stdio) sobre o mesmo `OpsStore`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um cliente MCP que conecta ao servidor `opspilot` recebe a lista
  completa e correta das três ferramentas suportadas em uma única troca de
  handshake/listagem, sem precisar de nenhuma chamada adicional.
- **SC-002**: As três ações centrais de plantão (consultar alertas, abrir incidente,
  resolver incidente) podem ser completadas inteiramente por um cliente MCP, com
  resultados equivalentes aos já produzidos pelas ferramentas LangChain existentes
  para a mesma entrada.
- **SC-003**: 100% dos erros de domínio (serviço inexistente, incidente inexistente)
  chegam ao cliente MCP como resultado legível da ferramenta, nunca como queda do
  processo do servidor ou travamento da conexão.
- **SC-004**: Em nenhum momento da execução do servidor o stdout contém algo além de
  mensagens do protocolo MCP — verificado automaticamente pela suíte de testes.
- **SC-005**: Iniciar o servidor exige um único comando documentado (`npm run mcp`).

## Assumptions

- O SDK `@modelcontextprotocol/sdk` e o transporte stdio (o processo do servidor é
  iniciado localmente pelo próprio cliente MCP) são a escolha já definida pelo
  pedido original — não há alternativa de transporte (ex.: HTTP/SSE) nesta versão.
- O servidor MCP reutiliza o mesmo backend de persistência já usado em produção pelo
  restante da aplicação (`SqliteOpsStore`, ver [index.ts](../../src/index.ts)) — não
  um store em memória/mock separado — para que o estado visto por um cliente MCP seja
  o mesmo estado visto pela API HTTP existente.
- Nesta primeira versão, apenas `list_alerts`, `open_incident` e `resolve_incident`
  são expostas via MCP; `list_incidents` e `consultar_runbook` (já existentes como
  ferramentas LangChain) ficam fora de escopo e podem ser adicionadas depois sem
  quebrar este contrato.
- Diagnóstico em stderr não tem um formato obrigatório nesta versão — a única regra
  rígida é a exclusão total do stdout como canal de diagnóstico.
- Caso nenhuma variável de ambiente seja de fato necessária para o servidor MCP
  funcionar, o script `mcp` permanece simples (`tsx src/mcp/server.ts`), sem
  mecanismo de carga de env; ele só precisa ser ajustado se uma dependência real
  (ex.: caminho do banco) exigir isso.

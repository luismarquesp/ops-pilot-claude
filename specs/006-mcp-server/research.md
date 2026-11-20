# Phase 0 Research: MCP Server (stdio) para OpsPilot

## 1. Pacote e API do SDK

**Decision**: usar `@modelcontextprotocol/sdk` (confirmado no npm registry, versão
atual `1.30.0`, `engines.node >= 18` — compatível com o Node 22 LTS da
constitution). Classes usadas:
- `McpServer`, de `@modelcontextprotocol/sdk/server/mcp.js`.
- `StdioServerTransport`, de `@modelcontextprotocol/sdk/server/stdio.js` — por
  padrão lê de `process.stdin` e escreve em `process.stdout`; é exatamente por
  isso que stdout é o canal do protocolo (confirma a regra crítica do pedido
  original, FR-008) e nada além dela pode escrever ali.
- Registro de ferramenta via `server.registerTool(name, config, handler)`, onde
  `config` aceita `{ description, inputSchema, ... }` e `handler` é
  `async (input) => CallToolResult`.

**Rationale**: é o pacote citado explicitamente no pedido do usuário e é o SDK
oficial do protocolo MCP para TypeScript/Node; `registerTool` é a API atual
recomendada (as sobrecargas antigas de `server.tool(...)` aparecem marcadas como
`@deprecated` na própria definição de tipos do pacote).

**Alternatives considered**: implementar o protocolo JSON-RPC do MCP manualmente
sobre stdin/stdout — rejeitado por reinventar o que o SDK oficial já resolve
(framing, capabilities negotiation, schema de erro), contrariando o pedido
explícito de usar `@modelcontextprotocol/sdk`.

## 2. Reaproveitar o mesmo schema zod nas duas tools (LangChain + MCP)

**Decision**: extrair, de `src/agents/tools.ts`, os três schemas zod hoje
definidos inline (`list_alerts`, `open_incident`, `resolve_incident`) para
constantes nomeadas e exportadas em um novo módulo `src/agents/ops-actions.ts`.
A tool LangChain (`tool({ schema: opsActionSchema, ... })`) e o `registerTool`
do MCP (`inputSchema: opsActionSchema.shape`) passam a apontar para a mesma
constante — `.shape` é usado do lado MCP porque a tipagem de `registerTool`
aceita um "raw shape" (`ZodRawShapeCompat`, um objeto simples de campos zod,
não um `ZodObject` envolto), então extrair `.shape` de um `z.object({...})`
já existente preserva exatamente as mesmas regras de validação sem duplicar a
definição dos campos.

**Rationale**: satisfaz literalmente FR-003 ("mesma fonte de verdade") sem
depender de uma feature mais nova/incerta do SDK (aceitar um `ZodObject`
completo via Standard Schema); `.shape` é suportado por qualquer versão recente
do pacote e não exige reescrever a validação.

**Alternatives considered**:
- Manter os schemas duplicados (um em `tools.ts`, outro em `server.ts`) —
  rejeitado, viola FR-003 diretamente (risco real de divergência silenciosa
  entre os dois transportes).
- Passar o `ZodObject` inteiro (sem `.shape`) para `inputSchema` — mantido como
  possível no futuro (a tipagem do SDK também aceita `AnySchema` via Standard
  Schema), mas não adotado agora por não ter sido confirmado com certeza contra
  a versão instalada; `.shape` é a opção comprovadamente estável.

## 3. Reaproveitar a mesma lógica de negócio (mesmo `OpsStore`) sem duplicar

**Decision**: mover também a *chamada* ao `OpsStore` (não só o schema) para
`src/agents/ops-actions.ts`, como funções `listAlertsAction(store, input)`,
`openIncidentAction(store, input)` e `resolveIncidentAction(store, input)` que
apenas chamam o método correspondente do `OpsStore` e deixam o erro de domínio
(`ServiceNotFoundError`/`IncidentNotFoundError`) propagar (throw), sem formatar
nada de transporte. Cada transporte (`tools.ts` para LangChain, `server.ts`
para MCP) importa essas funções e só decide, no seu próprio formato de erro,
como representar uma falha:
- LangChain: `catch { return "Erro: " + error.message }` (comportamento já
  existente, inalterado).
- MCP: `catch { return { content: [{ type: "text", text: error.message }],
  isError: true } }`.

**Rationale**: cumpre FR-004 (mesmo `OpsStore`, nenhuma implementação
paralela) e mantém a Constitution (Princípio IV — erro de domínio como classe,
traduzido só na borda de cada transporte; Princípio III — `ops-actions.ts` é a
camada de serviço, `server.ts`/`tools.ts` são controllers finos).

**Alternatives considered**: deixar `src/mcp/server.ts` chamar `OpsStore`
diretamente, duplicando o `try/catch` que já existe em `tools.ts` — rejeitado
por criar duas cópias da mesma lógica de tradução de erro, que tendem a
divergir com o tempo (exatamente o problema que FR-003/FR-004 pedem para
evitar).

## 4. Garantir "nenhuma escrita em stdout" (FR-008) de forma testável

**Decision**: a regra é garantida por convenção de código (nenhum
`console.log`/`console.info`/`console.warn`/`process.stdout.write` em
`src/mcp/**`; diagnóstico via `console.error`, que escreve em stderr) e por um
teste automatizado que intercepta `process.stdout.write` durante a
inicialização do servidor e a execução de uma chamada de ferramenta,
verificando que ela nunca é invocada.

**Rationale**: `StdioServerTransport` já usa stdout como canal do protocolo por
padrão — qualquer escrita concorrente ali corrompe o framing JSON-RPC que o
cliente MCP espera. Um teste que efetivamente intercepta a escrita é mais
confiável do que apenas inspeção manual de código, e não exige rodar um
subprocesso real.

**Alternatives considered**: apenas revisão manual/lint (ex.: regra de ESLint
proibindo `console.log`) — o projeto não usa ESLint hoje; adotar um teste
automatizado é consistente com o Princípio II (Test-First) sem introduzir uma
ferramenta nova.

## 5. Testar o servidor MCP sem subir um processo real

**Decision**: usar `InMemoryTransport.createLinkedPair()` (também exportado
pelo `@modelcontextprotocol/sdk`, em `.../inMemory.js`) para conectar um
`Client` MCP de teste diretamente ao `McpServer` dentro do mesmo processo
`node:test`, chamando `client.listTools()` para validar nome/descrição/schema
das três ferramentas, e `client.callTool(...)` para os cenários de sucesso e de
erro de domínio (reaproveitando `createMockOpsStore()` de
`src/store/mock-ops-store.ts`, já usado pelos testes de `tools.ts`).

**Rationale**: mantém os testes rápidos e determinísticos (sem I/O real de
processo/stdio), no mesmo runner (`node:test` via `tsx`) já usado no restante
do projeto — nenhuma dependência de teste nova.

**Alternatives considered**: spawnar o processo real (`node --import tsx
src/mcp/server.ts`) e falar stdio de verdade no teste — rejeitado como teste
principal por ser mais lento e frágil (sincronização de processo, mais difícil
de rodar em CI); pode valer como um teste manual de fumaça via
`quickstart.md`, não como parte da suíte automatizada.

## 6. Variáveis de ambiente e script npm

**Decision**: `SqliteOpsStore` já lê `process.env.OPSPILOT_DB` com um default
razoável (`./data/opspilot.db`) diretamente no construtor — nenhuma variável é
estritamente obrigatória para o servidor MCP funcionar (ele não faz chamadas a
LLM, então não depende de `OPENROUTER_API_KEY`/`OPEN_ROUTER_MODEL`). Como o
pedido original já previa esse caso ("se precisar de env, alterar o script"),
e a conclusão da pesquisa é que não precisa, o script fica exatamente como
pedido: `"mcp": "tsx src/mcp/server.ts"`, sem carregamento de env.

**Rationale**: segue literalmente a instrução original — só adicionar
carregamento de env (`--env-file-if-exists=.env`, mesmo mecanismo nativo do
script `dev`, sem `dotenv`, Princípio VI) no dia em que uma env de fato passar
a ser necessária para o servidor MCP; adicionar isso agora, sem necessidade,
seria complexidade especulativa.

**Alternatives considered**: adicionar `--env-file-if-exists=.env` desde já,
por consistência preventiva com o script `dev` — rejeitado por não haver
nenhuma variável hoje que o servidor MCP precise carregar, e por a instrução
original ser explícita: só alterar o script quando uma env de fato for
necessária.

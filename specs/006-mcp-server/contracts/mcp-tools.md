# Contract: Ferramentas MCP do servidor `opspilot`

Interface exposta por `src/mcp/server.ts` a qualquer cliente MCP conectado via
stdio. Os schemas de entrada abaixo são os mesmos definidos em
`src/agents/ops-actions.ts` (ver [data-model.md](../data-model.md)) — este
documento descreve o contrato observável pelo cliente, não redefine validação.

## Identidade do servidor

- **name**: `opspilot`
- **transport**: stdio (`StdioServerTransport`)
- **tools/list** DEVE retornar exatamente 3 ferramentas, nesta forma (ordem não
  é uma garantia do contrato — o cliente não deve depender dela):

| name | description (resumo) |
|---|---|
| `list_alerts` | Lista alertas de monitoramento (ver descrição completa, idêntica à tool LangChain equivalente) |
| `open_incident` | Abre um novo incidente para um serviço monitorado |
| `resolve_incident` | Marca como resolvido um incidente existente, por id |

## `list_alerts`

**Input** (`listAlertsInputSchema`):
```json
{ "status": "firing" }
```
- `status?`: `"firing" | "resolved" | "all"`, default `"firing"`.

**Output em sucesso** (`CallToolResult`, `isError` ausente ou `false`):
- `content`: uma entrada `{ "type": "text", "text": "<JSON.stringify(Alert[])>" }`.

**Não há caminho de erro de domínio** para esta ferramenta (uma lista vazia é
sucesso, não erro) — apenas falha de validação de entrada (schema zod), tratada
pelo próprio SDK antes de o handler ser chamado.

## `open_incident`

**Input** (`openIncidentInputSchema`):
```json
{ "title": "Fila de pagamento travada", "service": "checkout", "severity": "high" }
```

**Output em sucesso**:
- `content`: `{ "type": "text", "text": "<JSON.stringify(Incident)>" }`, com o
  incidente criado (`status: "open"`, `resolvedAt: null`).

**Output em erro de domínio** (serviço não encontrado):
```json
{
  "content": [{ "type": "text", "text": "Serviço não encontrado: <service>" }],
  "isError": true
}
```
O processo do servidor permanece de pé; a conexão MCP não é encerrada.

## `resolve_incident`

**Input** (`resolveIncidentInputSchema`):
```json
{ "id": 42 }
```

**Output em sucesso**:
- `content`: `{ "type": "text", "text": "<JSON.stringify(Incident)>" }`, com o
  incidente atualizado (`status: "resolved"`, `resolvedAt` preenchido).

**Output em erro de domínio** (incidente não encontrado):
```json
{
  "content": [{ "type": "text", "text": "Incidente não encontrado: <id>" }],
  "isError": true
}
```
O processo do servidor permanece de pé; a conexão MCP não é encerrada.

## Regra transversal: stdout

Nenhuma das três ferramentas, nem o processo do servidor como um todo, escreve
qualquer coisa em `process.stdout` fora dos frames do protocolo MCP escritos
pelo próprio `StdioServerTransport` (FR-008). Isto é parte do contrato: um
cliente real depende disso para conseguir fazer o parsing correto das
respostas JSON-RPC.

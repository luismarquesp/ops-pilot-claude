# Quickstart: validar o servidor MCP `opspilot`

Guia de validação manual e automatizada desta feature. Para o contrato
completo de cada ferramenta, ver [contracts/mcp-tools.md](./contracts/mcp-tools.md);
para os schemas/entidades, ver [data-model.md](./data-model.md).

## Pré-requisitos

- Node.js 22 LTS instalado (o SDK aceita >=18, mas o projeto padroniza em 22).
- Dependências instaladas: `npm install` (inclui a nova dependência
  `@modelcontextprotocol/sdk`, adicionada por esta feature).
- Nenhuma variável de ambiente é obrigatória — `OPSPILOT_DB` é opcional (default
  `./data/opspilot.db`, mesmo banco usado por `npm run dev`).

## 1. Rodar a suíte automatizada

```sh
npm run typecheck
npm test
```

Cobre (via `src/agents/ops-actions.test.ts` e `src/mcp/server.test.ts`):
- `tools/list` do servidor MCP retorna exatamente `list_alerts`,
  `open_incident`, `resolve_incident`, com o schema esperado.
- Chamada de sucesso para cada uma das três ferramentas (usando
  `createMockOpsStore()`).
- Chamada de `open_incident`/`resolve_incident` com referência inexistente
  retorna `isError: true` com mensagem legível, sem lançar exceção.
- Nenhuma escrita ocorre em `process.stdout` durante todo o cenário.

## 2. Validação manual de fumaça (processo real via stdio)

Sem um cliente MCP gráfico à mão, o [MCP Inspector](https://github.com/modelcontextprotocol/inspector)
(ferramenta oficial de linha de comando do próprio ecossistema MCP) é a forma
mais direta de conectar de verdade via stdio:

```sh
npx @modelcontextprotocol/inspector npm run mcp
```

Passos esperados:
1. O Inspector reporta conexão bem-sucedida ao servidor `opspilot`.
2. A lista de ferramentas mostra exatamente `list_alerts`, `open_incident`,
   `resolve_incident`.
3. Chamar `list_alerts` sem parâmetros retorna os alertas com `status:
   "firing"` do banco atual (`OPSPILOT_DB`).
4. Chamar `open_incident` com um `service` válido (ver serviços seed em
   `src/store/mercadinho-seed.ts`) retorna o incidente criado; chamar com um
   `service` inexistente retorna um resultado de erro legível (não derruba a
   conexão).
5. Chamar `resolve_incident` com o `id` retornado no passo anterior marca o
   incidente como resolvido; chamar de novo com um `id` inexistente retorna
   erro legível.

## 3. Confirmar a regra de stdout "no mundo real"

```sh
npm run mcp > stdout.log 2> stderr.log &
# fazer as chamadas do passo 2 via Inspector apontando para o mesmo processo,
# ou deixar o Inspector spawnar o processo (passo 2 já cobre isso)
```

Ao encerrar o processo, `stdout.log` deve conter **apenas** frames JSON-RPC do
protocolo MCP (uma linha JSON por mensagem) — nenhuma linha de log “solta”.
Qualquer diagnóstico do servidor aparece em `stderr.log`, nunca em
`stdout.log`.

## Critério de pronto (liga com Success Criteria da spec)

- [ ] `npm test` verde, incluindo os testes novos de `ops-actions` e `mcp/server`.
- [ ] Inspector lista as 3 ferramentas com nome/descrição/schema corretos (SC-001).
- [ ] As 3 ações completam ponta a ponta via Inspector com resultados
      equivalentes aos já produzidos pela API HTTP/LangChain (SC-002).
- [ ] Erros de domínio (serviço/incidente inexistente) voltam como resultado
      de ferramenta, nunca derrubam o processo (SC-003).
- [ ] `stdout.log` livre de qualquer linha fora do protocolo MCP (SC-004).
- [ ] `npm run mcp` é o único comando necessário para subir o servidor (SC-005).

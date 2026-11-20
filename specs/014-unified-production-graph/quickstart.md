# Quickstart: Grafo Unificado de Produção

## Automático

```bash
npm run typecheck
npm test
```

O que os testes cobrem: o roteador dublê escolhe a rota, o override não
chama o roteador, o fallback acontece em falha ou rota inválida, o campo
`node` aparece em todo evento, o `ConversationNotFoundError` atravessa o grafo
e a tabela do prompt é gerada a partir das rotas disponíveis. Ver
[contracts/production-graph.md](./contracts/production-graph.md).

## Manual (API rodando: `npm run dev`)

1. **Roteado** (sem `strategy`):
   ```bash
   curl -s localhost:3000/chat -H 'content-type: application/json' \
     -d '{"message":"Para cada alerta crítico disparando, abra um incidente e me diga o runbook."}' | jq '.trace[] | {type, node, route, source}'
   ```
   Esperado: um evento `route` com `source: "router"`, provavelmente
   `plan-and-execute`, e todos os eventos com `node`.
2. **Override**: o mesmo pedido com `"strategy":"react"` deve trazer
   `route` com `source: "override"` e `metrics.llmCalls` sem a chamada do
   roteador.
3. **Desconhecida**: `"strategy":"xyz"` deve devolver 422 com `available`
   igual a `["react","plan-and-execute","reflection"]`.
4. **Com conversa longa** (`bash scripts/conversa-long.sh`): no turno que gera
   resumo, o rastro deve abrir com `summarize` (`node: "contexto"`) e em seguida
   `route`.

## Qualidade do roteador real (SC-004)

```bash
node --env-file-if-exists=.env --import tsx src/agents/router-eval.ts
```

Esperado: acerto ≥ 80% nas perguntas de referência, com exit 0.

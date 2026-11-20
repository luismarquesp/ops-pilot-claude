# Quickstart: validar o refletor de aprendizado

## Pré-requisitos

- As features specs/008 (memória semântica) implementadas e `npm install` feito.
- `OPENROUTER_API_KEY` e `OPEN_ROUTER_MODEL` no ambiente (via `.env`, carregado pelos
  scripts com `--env-file-if-exists`) para os passos 2 e 3.

## 1. Checagens obrigatórias (sem rede para a lógica nova)

```bash
npm run typecheck
npm test
```

Esperado: tudo verde. A lógica nova (segredos, `toLearnableFact`,
`learnFromMessage`, disparo assíncrono no `runChat` e `forget_preference`) é
coberta com extrator e embedder fakes (research §9).

## 2. Avaliação de qualidade do extrator real (SC-001..SC-003)

```bash
node --env-file-if-exists=.env --import tsx src/memory/learning-eval.ts
```

Esperado: três linhas de taxa com as metas: fatos duradouros ≥ 90%, pedidos
pontuais ≤ 5% e segredos = 0%. O script termina com código ≠ 0 se alguma meta
falhar.

## 3. Ponta a ponta pela API

```bash
npm run dev
```

1. **Aprender sem pedir**:
   ```bash
   curl -s localhost:3000/chat -H 'content-type: application/json' \
     -d '{"userId":"luis","message":"Sou eu que cuido do checkout. Quais alertas estão disparando?"}'
   ```
   Esperado: a resposta chega sem atraso perceptível extra. Em seguida, confira a
   memória (passo 5): deve haver um fato sobre o checkout.
2. **Lembrar em outra conversa**: pergunte "algo pegando fogo no meu serviço?" com
   `"userId":"luis"` e sem `conversationId`. Esperado: `metrics.memoryFacts` ≥ 1.
3. **Pedido pontual não vira fato**: envie `"fecha o incidente 42"`. A memória
   não muda.
4. **Segredo nunca vira fato**: envie `"minha senha do grafana é hunter2, sou do
   time de SRE"`. A memória não muda (nem o fato do SRE).
5. **Inspecionar a memória**:
   ```bash
   node -e "const {DatabaseSync}=require('node:sqlite');console.log(new DatabaseSync('./data/opspilot.db').prepare(\"SELECT fact, created_at FROM memories WHERE user_id='luis'\").all())"
   ```
6. **Esquecer por descrição**: envie `"pode esquecer aquilo de eu cuidar do
   checkout"`. Esperado: o `trace` tem `forget_preference`, a resposta confirma o
   fato removido, e o passo 5 não o mostra mais.

Referências: [contracts/learning.md](./contracts/learning.md),
[contracts/memory-tools.md](./contracts/memory-tools.md), [data-model.md](./data-model.md).

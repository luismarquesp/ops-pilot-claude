# Quickstart: validar a memória semântica

## Pré-requisitos

- Node 22 LTS e `npm install`, que agora traz `@huggingface/transformers`.
- Rede na **primeira** execução que usa o modelo real (download de
  `Xenova/all-MiniLM-L6-v2`, ~90 MB, cacheado depois).

## 1. Checagens obrigatórias

```bash
npm run typecheck
npm test
```

Esperado: tudo verde, incluindo o teste com o modelo real que encontra um fato
por uma pergunta **sem palavra em comum** (research §8). Para rodar offline, use
`OPSPILOT_SKIP_MODEL_TESTS=1 npm test`, que pula só esse teste.

## 2. Ponta a ponta pela API

```bash
npm run dev
```

1. **Registrar um fato** (o agente usa `remember_fact`):
   ```bash
   curl -s localhost:3000/chat -H 'content-type: application/json' \
     -d '{"userId":"luis","message":"Guarde isto: eu sou o responsável pelo serviço de pagamentos."}'
   ```
   Esperado: `trace` com uma `action` `remember_fact` e `metrics.memoryFacts` = 0.
2. **Lembrar em outra conversa** (sem `conversationId`):
   ```bash
   curl -s localhost:3000/chat -H 'content-type: application/json' \
     -d '{"userId":"luis","message":"Quais alertas dizem respeito a mim?"}'
   ```
   Esperado: `metrics.memoryFacts` ≥ 1, e a resposta leva em conta o serviço de pagamentos.
3. **Isolamento**: repita o passo 2 com `"userId":"outra-pessoa"` e confira
   `metrics.memoryFacts` = 0.
4. **Sem usuário**: repita o passo 2 sem `userId` e confira `memoryFacts` = 0,
   sem as tools de memória no `trace`.
5. **Validação**: `"userId": ""` → `400`.
6. **Persistência**: reinicie o `npm run dev` e repita o passo 2; o fato continua sendo lembrado.

## 3. Inspeção direta (opcional)

```bash
node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('./data/opspilot.db');console.log(db.prepare('SELECT id,user_id,fact,length(embedding) AS bytes,created_at FROM memories').all())"
```

Esperado: `bytes` = 1536 em toda linha.

Referências: [data-model.md](./data-model.md), [contracts/](./contracts/).

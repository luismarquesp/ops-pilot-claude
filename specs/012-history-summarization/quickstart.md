# Quickstart: Sumarização de Histórico (Pruning)

## 1. Testes (sem rede, resumidor falso)

```bash
npm run typecheck
npm test
```

Esperado: verde, incluindo os casos de research.md §12 (limiar 15/16,
reutilização, mescla, persistência, falha, evento `summarize`, contrato do
store para SQLite e mock).

## 2. Conversa longa com o resumidor real

Pré-requisito: `.env` configurado (não ler nem commitar) e API rodando
(`npm run dev`).

```bash
TURNS=20 bash scripts/conversa-long.sh
```

Esperado:

- coluna `historico` sobe 0, 2, …, 14; no turno 9 cai para 8 (a coluna
  `resumo` marca `*`) e repete o ciclo nos turnos 13 e 17;
- `promptTokens` deixa de crescer linearmente depois do turno 9 (SC-002);
- no máximo 3 turnos marcados com `*` em 20 (SC-001).

## 3. Persistência

Depois do cenário 2, parar e subir a API de novo e mandar mais um turno na
mesma conversa (`conversationId` impresso pelo script):

```bash
curl -s localhost:3000/chat -H 'content-type: application/json' \
  -d '{"conversationId":"<id>","message":"o que decidimos no começo?"}'
```

Esperado: a resposta menciona decisões dos primeiros turnos (vindas do resumo)
e `metrics.contextBreakdown.summary > 0`, sem evento `summarize`.

## 4. Inspeção do resumo (opcional)

```bash
node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.env.OPSPILOT_DB??'./data/opspilot.db');console.table(db.prepare('SELECT conversation_id, messages_covered, length(summary) AS chars, updated_at FROM conversation_summaries').all())"
```

Esperado: uma linha por conversa resumida; `chars` em torno de 600 (~150
tokens, SC-005).

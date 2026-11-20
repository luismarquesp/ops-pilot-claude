# Quickstart: validar a persistência real de operações

Pré-requisitos: Node.js 22+ (validado em 24.16), dependências instaladas
(`npm install`), rodando a partir da raiz do repo.

## 1. Rodar os testes de contrato da store

```sh
npm test
```

Espera-se, entre outros:
- `src/store/sqlite-ops-store.test.ts` verde — seed idempotente, abrir/listar/
  resolver incidentes, filtros de `listAlerts`/`listIncidents`, `CHECK` rejeitando
  valor fora do enum, tudo sobre `":memory:"` (sem tocar disco).
- `src/store/mock-ops-store.test.ts` verde — mesmos casos de contrato, agora
  contra o `MockOpsStore`.
- `src/agents/tools.test.ts` verde, sem depender de nenhum arquivo `.db` real.

## 2. Ver a persistência sobreviver a um restart (SC-001)

```sh
rm -f ./data/opspilot.db   # ambiente limpo
npm run arena -- --question "Como está o plantão? Liste os incidentes em aberto." --strategies react
```

Primeira execução: nenhum incidente aberto ainda (só os 6 alerts do seed). Peça
para abrir um:

```sh
npm run arena -- --question "Abra um incidente para o serviço checkout, severidade high, título 'Fila travada'." --strategies react
```

Rode de novo a pergunta original — o incidente aberto na chamada anterior
continua aparecendo, mesmo sendo um processo novo do zero:

```sh
npm run arena -- --question "Liste os incidentes em aberto." --strategies react
```

## 3. Ver o seed não duplicar (SC-003)

```sh
npm run arena -- --question "Liste todos os alertas." --strategies react
```

Rode o mesmo comando de novo — a contagem de alerts continua 6, nunca 12.

## 4. Consultar um runbook (User Story 3 / SC-005)

```sh
npm run arena -- --question "Qual o runbook para o serviço payments?" --strategies react
npm run arena -- --question "Qual o runbook para o serviço search?" --strategies react
```

O primeiro retorna o procedimento cadastrado; o segundo (serviço sem runbook)
retorna uma mensagem de erro clara, sem o processo travar ou lançar uma exceção
não tratada.

## 5. Conferir que `bench` continua isolado/reprodutível (FR-014)

```sh
npm run bench
```

Roda os 3 cenários (C1/C2/C3) × 2 estratégias sobre o `MockOpsStore` — nunca toca
`./data/opspilot.db`. Rodar duas vezes seguidas deve produzir a mesma tabela de
acerto/erro por combinação (dentro da variação normal do LLM), nunca dados
"vazando" de uma combinação para a próxima.

## 6. Conferir o arquivo em disco e o `.gitignore`

```sh
ls data/opspilot.db      # existe depois do passo 2
git status --short       # data/ não aparece como untracked
```

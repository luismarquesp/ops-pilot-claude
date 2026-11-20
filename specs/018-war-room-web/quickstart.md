# Quickstart: validar a war room

Contratos: [chat-approvals-api](./contracts/chat-approvals-api.md),
[cors](./contracts/cors.md) e [web-ui](./contracts/web-ui.md).

## Pré-requisitos

- Node 22.
- `npm install` na raiz e em `web/`.
- API com `OPENROUTER_API_KEY` configurada no `.env` local. O agente não lê
  esse arquivo.
- Banco descartável, por exemplo `OPSPILOT_DB=./data/quickstart.db`.

## 1. Verificações automáticas

```bash
npm run typecheck && npm test                     # API, inclui portão, aprovações e CORS
npm --prefix web run typecheck && npm --prefix web test   # web, inclui axe nos dois temas
npm --prefix web run build                        # gera web/dist com base /opspilot/
```

Esperado: tudo verde. `web/dist/index.html` referencia `/opspilot/assets/…`.

## 2. API: CORS e saúde

```bash
CORS_ORIGINS=http://localhost:5173 OPSPILOT_DB=./data/quickstart.db npm run dev
curl -i http://localhost:3000/health                                          # 200 {"status":"ok"}
curl -i -X OPTIONS http://localhost:3000/chat -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: POST"                                    # 204 + Allow-Origin
curl -i http://localhost:3000/health -H "Origin: http://evil.test"            # 200 sem Allow-Origin
```

## 3. API: aprovação ponta a ponta

```bash
curl -s -X POST localhost:3000/chat -H 'content-type: application/json' \
  -d '{"message":"resolva o incidente 1","strategy":"react"}'
```

Esperado: 202 com `approval.summary` "Resolver o incidente #1". Neste ponto o
incidente continua aberto (`list_incidents`).

- `POST /chat/approvals/<id>` `{"decision":"deny"}` → 200. A resposta diz que
  não executou, e o incidente continua aberto.
- Repetir a pergunta e aprovar com `{"decision":"approve"}` → 200. O incidente
  é resolvido e o rastro começa com `decision`.
- Mandar o mesmo `approve` de novo → 409 `approval_already_decided`.
- `GET /chat/approvals?conversationId=<id>` com um cartão pendente → lista com 1
  item.
- `GET /requests/<requestId do 202>` → `status 202` com o rastro até o
  `approval`.

## 4. Web em desenvolvimento

```bash
npm --prefix web run dev          # http://localhost:5173/opspilot/
```

1. **Estado vazio**: clicar num exemplo, ver o progresso e depois a resposta.
2. **Ver raciocínio**: os passos aparecem com ícone e rótulo; `Esc` fecha e
   devolve o foco ao botão.
3. **Aprovação**:
   - pedir "resolva o incidente 2" → aparece o cartão e o composer é
     bloqueado;
   - **Negar** → resposta final;
   - repetir e **Aprovar** → resposta final;
   - repetir, recarregar a página com o cartão pendente → o cartão volta.
4. **⚙ Configurações**:
   - apontar para `http://localhost:3001` (porta errada) → **Testar conexão**
     diz "API inacessível";
   - subir a API **sem** `CORS_ORIGINS` → "origem não autorizada";
   - voltar para `:3000` → "conectado".
5. **Teclado e temas**: fazer o fluxo inteiro só com teclado, em tema claro e
   escuro, com 200% de zoom e em 360px de largura.

## 5. Publicado sob /opspilot/

```bash
npm --prefix web run preview      # serve web/dist em /opspilot/
```

Abrir `http://localhost:4173/opspilot/` e recarregar. Esperado: nenhum 404 na
aba de rede.

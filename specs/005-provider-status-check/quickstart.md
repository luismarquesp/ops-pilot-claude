# Quickstart: validar a tool de status de provedores externos

Pré-requisitos: dependências instaladas (`npm install`), rodando a partir da
raiz do repo. Estes passos fazem chamadas de rede reais (GitHub/Cloudflare
statuspage.io) — os testes automatizados (`npm test`) não precisam de rede.

## 1. Rodar os testes da tool (sem rede)

```sh
npm test
```

Espera-se `src/agents/provider-status-tool.test.ts` verde — os 9 casos de
`contracts/provider-status-tool.md`, todos com `fetch` fake.

## 2. Consultar o status do GitHub (default) via `arena`

```sh
npm run arena -- --question "O GitHub está com algum problema?" --strategies react
```

Esperado: a tool `check_provider_status` é chamada com `provider: "github"`
(default), e a resposta cita o indicador atual (ex.: "none — All Systems
Operational", ou o que estiver acontecendo de fato no momento do teste).

## 3. Consultar o status do Cloudflare

```sh
npm run arena -- --question "Verifique se é o Cloudflare que está fora do ar." --strategies react
```

Esperado: a tool é chamada com `provider: "cloudflare"`, resposta específica
desse provedor.

## 4. Provedor não suportado

```sh
npm run arena -- --question "Qual o status do provedor AWS?" --strategies react
```

Esperado: como `"aws"` não é um valor do enum, o modelo não consegue chamar a
tool com esse valor — a resposta deve deixar claro que só GitHub e Cloudflare
são suportados nesta versão, sem nenhuma chamada de rede acontecer para um
provedor inválido.

## 5. Conferir que a resposta nunca quebra a conversa

Não há um jeito determinístico de forçar uma falha real de rede via `arena`
sem desconectar a máquina — essa garantia (timeout, retry, erro legível) já
está coberta pelos testes automatizados do passo 1 (casos 5-9 de
`contracts/provider-status-tool.md`), que simulam exatamente esses cenários
sem depender de rede instável de verdade.

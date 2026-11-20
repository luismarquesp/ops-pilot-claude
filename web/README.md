# OpsPilot · War room

A interface web do OpsPilot ([specs/018](../specs/018-war-room-web/spec.md)). Nela, o
plantonista:

- conversa com o copiloto;
- vê o raciocínio de cada resposta;
- aprova ou nega as ações que mudam a produção.

A war room é publicada automaticamente no GitHub Pages
([specs/019](../specs/019-pages-deploy/spec.md)). Fora do Pages, o caminho
padrão é `/opspilot/`.

As regras de design ficam em
[.github/instructions/design.instructions.md](../.github/instructions/design.instructions.md).

## Comandos

Os comandos rodam a partir da raiz do repositório. De dentro de `web/`, use só
`npm run …`.

| Comando | O que faz |
|---------|-----------|
| `npm --prefix web install` | instala as dependências (pacote isolado da API) |
| `npm --prefix web run dev` | servidor de desenvolvimento em `http://localhost:5173/opspilot/` |
| `npm --prefix web test` | testes (Vitest + Testing Library + axe), incluindo o contrato do workflow de publicação |
| `npm --prefix web run typecheck` | checagem de tipos |
| `npm --prefix web run build` | gera `web/dist/`, com todos os recursos sob `/opspilot/` e um `404.html` |
| `OPSPILOT_WEB_BASE=/x/ npm --prefix web run build` | o mesmo, sob outro caminho |
| `npm --prefix web run preview` | serve `web/dist/` em `http://localhost:4173/opspilot/` |

As fixtures de contrato em `src/test/fixtures/` são geradas pela API. Depois de
mudar o formato de uma resposta, rode na raiz:

```bash
OPSPILOT_WRITE_FIXTURES=1 npx tsx --test src/http/fixtures.export.test.ts
```

## Configuração do build

As duas variáveis estão documentadas em [.env.example](./.env.example). Nenhuma
das duas é segredo: o valor fica visível no JS publicado.

| Variável | Para quê | Vazia |
|----------|----------|-------|
| `VITE_OPSPILOT_API_URL` | endereço padrão da API | regra abaixo |
| `OPSPILOT_WEB_BASE` | caminho de publicação | `/opspilot/` |

No Git Bash (Windows), prefixe com `MSYS_NO_PATHCONV=1` (`MSYS_NO_PATHCONV=1
OPSPILOT_WEB_BASE=/x/ npm --prefix web run build`). Sem isso, o MSYS reescreve
o caminho para `C:/Program Files/Git/x/`.

Um valor inválido faz o build falhar com `Configuração inválida: <variável>`. A
mensagem cita só o nome da variável, nunca o valor.

## Endereço da API

O endereço da API vem da primeira opção disponível:

1. O endereço salvo na ⚙ **Configurações**, guardado neste navegador.
2. `VITE_OPSPILOT_API_URL`, definida no momento do build. No GitHub Pages, ela
   vem da variável de repositório `OPSPILOT_API_URL` (ver abaixo).
3. Se nenhum dos dois existir:
   - em desenvolvimento, `http://localhost:3000`;
   - na versão publicada, a própria origem da página.

No GitHub Pages sem `OPSPILOT_API_URL`, a regra 3 aponta para o próprio Pages,
onde não há API. O plantonista vê o erro de conexão e informa o endereço na ⚙.

## Publicar no GitHub Pages

O workflow [`.github/workflows/pages.yml`](../.github/workflows/pages.yml) publica a
war room sozinho.

### Ativar (uma vez por repositório)

1. Em **Settings → Pages → Build and deployment → Source**, escolha
   **GitHub Actions**. Sem esse passo, a primeira execução falha.
2. Opcional: em **Settings → Secrets and variables → Actions → Variables**, crie
   `OPSPILOT_API_URL` com o endereço da API, por exemplo
   `https://api.example.com`. É uma *variable*, não um *secret*: o valor fica
   no JS publicado e qualquer visitante consegue lê-lo.
3. Na API, inclua a origem do site em `CORS_ORIGINS` (ver [CORS](#cors)).

### Quando publica

- A cada push em `main` que mude algo em `web/**` ou no próprio workflow.
  Mudanças só na API não publicam nada.
- Manualmente: **Actions → Pages → Run workflow**. Use depois de mudar
  `OPSPILOT_API_URL`, porque mudar a variável não dispara a publicação.

### Onde fica

Em `https://<usuário>.github.io/<repositório>/`. O endereço exato aparece no job
`deploy` da execução, no ambiente `github-pages`.

O caminho segue o site real e não precisa de configuração. Com domínio próprio,
a war room fica na raiz do domínio.

### O que garante

- **Nunca publica uma versão quebrada.** O job `build` roda `npm ci`, checagem
  de tipos, testes e build, nessa ordem. Qualquer falha impede o envio, e o site
  segue com a versão anterior.
- **Permissões mínimas por job.** O workflow não concede nada por padrão.
  - `build`: só `contents: read` e `pages: read`. É o job que roda `npm ci` e os
    testes, então não pode publicar.
  - `deploy`: só `pages: write` e `id-token: write`. O `id-token` é a prova de
    identidade (OIDC) que o Pages exige. Esse job não faz checkout nem roda
    código do repositório.
  - Não há `contents: write` nem segredos.
- **Uma publicação por vez.** A que está rodando nunca é cancelada. Das que
  esperam, o GitHub mantém só a mais nova.
- **Recarregar funciona.** O build gera um `404.html` igual ao `index.html`,
  então recarregar a página ou abrir um caminho desconhecido mostra a war room.
  Esses caminhos respondem com status HTTP 404.

As regras acima são verificadas por
[src/deploy.test.ts](./src/deploy.test.ts), que roda junto com `npm test`.

Para mais rigor, você pode fixar as actions pelo SHA do commit em vez da tag
(`actions/checkout@<sha> # v7`).

## CORS

Se a war room e a API estão em origens diferentes, a origem da war room
precisa estar em `CORS_ORIGINS` na API. Por exemplo:

```bash
CORS_ORIGINS=http://localhost:5173,https://<usuário>.github.io npm run dev
```

- A origem do GitHub Pages é só `https://<usuário>.github.io`, sem o
  `/<repositório>/` e sem barra no fim.
- A API aceita só as origens dessa lista. Ela nunca usa `*`.
- O Pages serve em `https://`, então a API também precisa estar em `https://`.
  O navegador bloqueia chamadas de uma página HTTPS para uma API `http://`. A
  exceção é `http://localhost`, que a maioria dos navegadores aceita, mas não
  todos.

Para descobrir se uma origem está bloqueada, use o botão **Testar conexão** na
⚙. Ele diferencia "API inacessível" de "origem não autorizada".

## Publicar em outro servidor

Gere o build com o caminho desejado em `OPSPILOT_WEB_BASE`. Sem a variável, o
caminho é `/opspilot/`. Copie `web/dist/` para o servidor e sirva o conteúdo sob
esse caminho. Qualquer caminho desconhecido dentro dele deve cair no
`index.html`. Exemplo com nginx:

```nginx
location /opspilot/ {
    alias /var/www/opspilot/;
    try_files $uri $uri/ /opspilot/index.html;
}
```

## O que fica guardado no navegador

A war room guarda só três chaves no `localStorage`:

- `opspilot.apiUrl`
- `opspilot.theme`
- `opspilot.conversationId`

O conteúdo das conversas nunca é guardado (FR-021).

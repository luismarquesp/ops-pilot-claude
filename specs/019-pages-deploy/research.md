# Research: Publicação automática da war room

## 1. Mecanismo de publicação

- **Decision**: GitHub Pages com fonte "GitHub Actions". Um workflow
  `.github/workflows/pages.yml` com dois jobs. O job `build` verifica, gera e envia
  o artefato com `actions/upload-pages-artifact`. O job `deploy` publica com
  `actions/deploy-pages`.
- **Rationale**: é o caminho oficial. Ele não precisa de branch `gh-pages`, não
  grava no repositório e não usa token pessoal. A identidade vem de OIDC
  (`id-token`).
- **Alternatives considered**:
  - Branch `gh-pages` com uma action de terceiros: exige `contents: write`, que
    fere o FR-008, e suja o histórico.
  - Job único: misturaria as permissões de build e de deploy.

## 2. Permissões (FR-008)

- **Decision**: workflow com `permissions: {}`, e cada job declara o próprio
  mínimo.
  - `build`: `contents: read`, para o checkout, e `pages: read`, para o
    `configure-pages` ler o endereço do site sem tentar ativá-lo.
  - `deploy`: `pages: write` e `id-token: write`.
- **Rationale**: o job que roda código de terceiros (`npm ci`, testes) nunca tem
  permissão de publicar.
- **Risco**: se o `configure-pages` pedir mais que `pages: read` sem
  `enablement`, a primeira execução falha cedo, no build, sem publicar nada. O
  plano B é calcular a base por `/${{ github.event.repository.name }}/` e
  documentar que domínio próprio exige `OPSPILOT_WEB_BASE=/`.

## 3. Caminho de publicação configurável (FR-005, clarificação)

- **Decision**: `vite.config.ts` lê `OPSPILOT_WEB_BASE` por uma função pura
  `resolveBuildConfig(env)` em `web/src/build-config.ts`, que fica dentro do
  `include` do tsconfig e da coleta do Vitest.
  - Vazio ou ausente → `/opspilot/`.
  - A barra inicial e a final são normalizadas: `/repo` vira `/repo/`.
  - Valor inválido → o build falha, citando só o nome da variável.
  - O workflow passa `steps.pages.outputs.base_path` do `configure-pages` (vem
    como `/repo`, ou vazio com domínio próprio, que vira `/`).
- **Rationale**:
  - O padrão preserva o FR-017 da 018 e o `build.test.ts` existente.
  - O `base_path` do `configure-pages` já considera domínio próprio.
- **Alternatives considered**:
  - Base relativa (`./`): quebra os caminhos profundos no fallback do 404.
  - Base fixa: rejeitada na clarificação.

## 4. Endereço padrão da API (FR-007)

- **Decision**: a variável de repositório `OPSPILOT_API_URL` chega ao job como
  `VITE_OPSPILOT_API_URL`.
  - `resolveBuildConfig` valida o valor com o mesmo `apiUrlSchema` de
    `web/src/config.ts`, numa única regra.
  - Inválido → o build falha (edge case da spec). Vazio → regra da 018.
- **Rationale**: o valor não é segredo, porque fica embutido no JS publicado.
  `vars` deixa isso explícito, e `secrets` daria uma falsa sensação de sigilo.
- **Nota**: sem a variável, o padrão publicado é a origem do próprio Pages, onde
  não há API. O plantonista vê o erro de conexão e usa a ⚙. Isso já é coberto
  pela 018 e fica documentado no README.

## 5. Fallback de rotas (FR-006)

- **Decision**: um plugin Vite mínimo (`spaFallback`, `enforce: "post"`), no
  `generateBundle`, emite `404.html` com o mesmo conteúdo do `index.html`.
- **Rationale**:
  - O Pages serve `404.html` para qualquer caminho desconhecido.
  - A war room não tem roteador, então qualquer caminho mostra a mesma tela.
  - Fazer isso no build, e não num `cp` no workflow, deixa o resultado coberto
    pelo `build.test.ts` e igual em qualquer hospedagem.
- **Trade-off**: o status HTTP desses caminhos é 404, embora a página funcione.
  Para uma SPA sem rotas isso é aceitável.

## 6. Gatilhos e concorrência (FR-001..003, FR-009)

- **Decision**:
  - Gatilhos: `push` em `main` com `paths: [web/**, .github/workflows/pages.yml]`,
    mais `workflow_dispatch`.
  - Concorrência: `concurrency: { group: pages, cancel-in-progress: false }`.
- **Rationale**:
  - Com `cancel-in-progress: false`, a execução em andamento termina.
  - O GitHub mantém só a pendente mais nova e descarta as intermediárias, e é
    exatamente isso que o FR-009 pede.

## 7. Verificação antes de publicar (FR-004)

- **Decision**: o job `build` roda `npm ci`, `typecheck`, `test` e `build`, nesta
  ordem, todos sob `--prefix web`. O `deploy` depende do `build` (`needs`).
- **Node**: `actions/setup-node` com `node-version: 22` e cache npm em
  `web/package-lock.json`.
- **Rationale**:
  - São os mesmos comandos do README.
  - Qualquer falha impede que o artefato exista, então o `deploy` nunca roda.

## 8. Versões das actions

- **Decision**: fixar pela tag de versão maior, todas publicadas há bem mais de
  duas semanas:
  - `actions/checkout@v7`
  - `actions/setup-node@v7`
  - `actions/configure-pages@v6`
  - `actions/upload-pages-artifact@v5`
  - `actions/deploy-pages@v5`
- **Verificado em 2026-11-20** (T001, API pública de releases): checkout v7.0.1
  (2026-07-20), setup-node v7.1.0 (2026-10-08), configure-pages v6.0.0
  (2026-03-25), upload-pages-artifact v5.0.0 (2026-04-10), deploy-pages v5.0.1
  (2026-09-01). As versões do plano original (v5/v4) estavam desatualizadas.
- **Rationale**: as actions são oficiais da organização `actions`. Fixar por SHA
  fica como recomendação no README; não é obrigatório aqui.

## 9. Como testar o workflow

- **Decision**: um teste de contrato textual, `web/src/deploy.test.ts`
  (ambiente node), lê `.github/workflows/pages.yml` e verifica:
  - os gatilhos e `paths`;
  - `permissions: {}` e o mínimo de cada job;
  - `cancel-in-progress: false`;
  - as duas actions obrigatórias;
  - a ordem `typecheck` → `test` → `build`;
  - a ausência de `secrets.`.
- **Rationale**:
  - Sem dependência nova de YAML: a checagem é por linha.
  - O teste protege o FR-008 contra regressão.
  - A execução real só é verificável no GitHub (ver quickstart).
- **Alternatives considered**: `actionlint` não está instalado e seria
  dependência externa; fica como opcional.

## 10. README e `.env.example` (FR-012)

- **Decision**: criar `web/.env.example`, com `VITE_OPSPILOT_API_URL=` e
  `OPSPILOT_WEB_BASE=` comentados. A raiz do `.gitignore` já libera
  `!.env.example`.
- **README**: trocar "Publicar sob `/opspilot/`" por "Publicar no GitHub Pages",
  e manter o exemplo nginx como alternativa.

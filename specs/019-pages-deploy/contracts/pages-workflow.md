# Contrato: `.github/workflows/pages.yml`

O teste `web/src/deploy.test.ts` verifica este contrato por texto.

## Gatilhos

```yaml
on:
  push:
    branches: [main]
    paths: ["web/**", ".github/workflows/pages.yml"]
  workflow_dispatch:
```

## Permissões (FR-008)

```yaml
permissions: {}        # nível do workflow: nada
jobs:
  build:
    permissions: { contents: read, pages: read }
  deploy:
    permissions: { pages: write, id-token: write }
```

- Nenhum job tem `contents: write`.
- Nenhum `secrets.*` aparece no arquivo (FR-011).

## Concorrência (FR-009)

```yaml
concurrency:
  group: pages
  cancel-in-progress: false
```

## Job `build` (FR-004, FR-005, FR-007)

As etapas rodam nesta ordem:

1. `actions/checkout@v7`
2. `actions/setup-node@v7`, com `node-version: 22`, `cache: npm` e
   `cache-dependency-path: web/package-lock.json`
3. `actions/configure-pages@v6`, com `id: pages` e sem `enablement`
4. `npm ci --prefix web`
5. `npm --prefix web run typecheck`
6. `npm --prefix web test`
7. `npm --prefix web run build`, com o env:
   - `OPSPILOT_WEB_BASE: ${{ steps.pages.outputs.base_path }}/`
   - `VITE_OPSPILOT_API_URL: ${{ vars.OPSPILOT_API_URL }}`
8. `actions/upload-pages-artifact@v5`, com `path: web/dist`

## Job `deploy` (FR-010)

```yaml
deploy:
  needs: build
  environment:
    name: github-pages
    url: ${{ steps.deployment.outputs.page_url }}
  steps:
    - id: deployment
      uses: actions/deploy-pages@v5
```

## Configuração do repositório (passos manuais únicos, documentados no README)

- Em *Settings → Pages → Source*, escolher **GitHub Actions**.
- Opcional: em *Settings → Secrets and variables → Actions → Variables*, criar
  `OPSPILOT_API_URL`, por exemplo `https://api.example.com`.
- Na API, `CORS_ORIGINS` precisa incluir a **origem** do site, por exemplo
  `https://<usuário>.github.io`. A origem não tem caminho nem barra final.

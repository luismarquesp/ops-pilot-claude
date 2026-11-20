# Implementation Plan: Publicação automática da war room

**Branch**: `019-pages-deploy` | **Date**: 2026-11-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/019-pages-deploy/spec.md`

## Summary

A war room (`web/`) passa a ser publicada no GitHub Pages por um workflow do
GitHub Actions, `.github/workflows/pages.yml`, com dois jobs:

- **`build`**: só leitura. Roda typecheck, test e build, depois
  `upload-pages-artifact`.
- **`deploy`**: só `pages: write` e `id-token: write`. Roda `deploy-pages`.

Duas mudanças no build da web acompanham o workflow:

- A base deixa de ser fixa e passa por uma função pura, `resolveBuildConfig`,
  validada com zod. O padrão continua `/opspilot/`, e o workflow passa o
  `base_path` real do site.
- O build emite um `404.html` igual ao `index.html`, que serve de fallback para
  os caminhos desconhecidos.

O endereço padrão da API vem da variável de repositório `OPSPILOT_API_URL`. O
README é atualizado e o `web/.env.example` que ele já citava passa a existir.

## Technical Context

**Language/Version**: TypeScript strict (web: TS 7.0.2), Node 22 LTS no runner;
YAML do GitHub Actions

**Primary Dependencies**:
- Já usadas: Vite 8.3.6 e zod 4.6.7.
- Actions oficiais:
  - `actions/checkout@v7`
  - `actions/setup-node@v7`
  - `actions/configure-pages@v6`
  - `actions/upload-pages-artifact@v5`
  - `actions/deploy-pages@v5`
- Nenhuma dependência npm nova.

**Storage**: N/A

**Testing**: Vitest no pacote `web/`, como na 018. Testes novos:
- `build-config.test.ts`, unitário e puro;
- `build.test.ts`, ampliado com base customizada e `404.html`;
- `deploy.test.ts`, contrato textual do workflow.

**Target Platform**: GitHub Pages (estático, HTTPS) e `ubuntu-latest` no Actions

**Project Type**: SPA estática + pipeline de CI/CD

**Performance Goals**: publicação em ≤ 10 min (SC-001). O job atual leva cerca de
2 min (install, test 189, build).

**Constraints**:
- Permissões mínimas por job.
- Sem segredos.
- Sem mudanças na API nem no `npm test` da raiz.
- O `web/.env` nunca é lido.

**Scale/Scope**:
- Arquivos novos: 1 workflow, 1 módulo puro, 2 testes novos e 1 ampliado,
  `web/.env.example`.
- Arquivos alterados: `vite.config.ts`, README e AGENTS.md.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Status | Nota |
|---|---|---|
| I. Validação na fronteira (zod) | ✅ | as variáveis de build são entrada externa e passam por `resolveBuildConfig`, que usa zod e reutiliza o `apiUrlSchema` |
| II. Test-First | ✅ (com desvio herdado) | testes antes da implementação. Vitest em `web/`, desvio já justificado na 018; o workflow é coberto por contrato textual e pelo quickstart no GitHub |
| III. MVC | N/A | não há camadas de servidor |
| IV. Erros de domínio | ✅ | a falha de configuração é um resultado tipado, e só a borda (`vite.config.ts`) lança |
| V. Funções puras | ✅ | `resolveBuildConfig` é pura; o plugin `spaFallback` só copia um asset do bundle |
| VI. Segredos | ✅ | sem `secrets.*`. `OPSPILOT_API_URL` é `vars` porque fica público no JS, e o `web/.env` nunca é lido |
| Fluxo / commits | ✅ | nada é commitado nem empurrado. A ativação do Pages e o push para `main` ficam com o mantenedor |

Re-check pós-design: sem violações novas. Continua pendente a emenda MINOR à
constituição para incluir `web/` (React/Vite/Vitest) e agora o GitHub Actions na
Stack. Ela já tinha sido recomendada na 018 e não é aplicada aqui.

## Project Structure

### Documentation (this feature)

```text
specs/019-pages-deploy/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── pages-workflow.md
│   └── build-config.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
.github/workflows/
└── pages.yml                 # novo: build (read) → deploy (pages/id-token)

web/
├── .env.example              # novo: VITE_OPSPILOT_API_URL, OPSPILOT_WEB_BASE
├── README.md                 # atualizado: Publicar no GitHub Pages
├── vite.config.ts            # base via resolveBuildConfig + plugin spaFallback
└── src/
    ├── build-config.ts       # novo, puro
    ├── build-config.test.ts  # novo
    ├── build.test.ts         # ampliado: base custom + 404.html
    └── deploy.test.ts        # novo: contrato do workflow

AGENTS.md                     # nota curta em "War room web"
```

**Structure Decision**: tudo o que é de build fica no pacote `web/`, e o workflow
fica no lugar padrão do GitHub. A API não muda.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Workflow coberto só por contrato textual, sem execução local | O Pages só existe no GitHub | `act`/`actionlint` exigiriam ferramentas externas e não simulam o `deploy-pages` (OIDC) |

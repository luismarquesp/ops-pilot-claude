---

description: "Task list for 019-pages-deploy"
---

# Tasks: Publicação automática da war room

**Input**: Design documents from `/specs/019-pages-deploy/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: obrigatórios (constituição, Princípio II). Escreva cada teste antes da implementação correspondente e confirme que ele falha **por asserção**, não por módulo inexistente. Quando o arquivo de teste depende de um módulo novo, crie primeiro um stub que exporte a função e lance `Error("not implemented")`.

**Organization**: tarefas agrupadas por user story. Todos os caminhos são relativos à raiz do repositório.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência pendente)
- **[Story]**: US1, US2 ou US3, conforme a [spec.md](./spec.md)

## Regras gerais

- **Nunca** ler `web/.env` nem `.env`. Também nunca commitar ou empurrar.
- Os comandos da web rodam da raiz: `npm --prefix web test`, `npm --prefix web run typecheck`.
- O workflow fica em `.github/workflows/pages.yml`. Contrato: [contracts/pages-workflow.md](./contracts/pages-workflow.md).
- A regra do build fica em `web/src/build-config.ts`. Contrato: [contracts/build-config.md](./contracts/build-config.md).
- O teste de contrato do workflow lê o YAML como texto (linha a linha, sem dependência nova) a partir de `path.resolve(process.cwd(), "..", ".github/workflows/pages.yml")`, já que o Vitest roda com `cwd = web/`.

---

## Phase 1: Setup

- [X] T001 Confirmar que as versões das actions existem e foram publicadas há pelo menos duas semanas. As versões são `actions/checkout@v7`, `actions/setup-node@v7`, `actions/configure-pages@v6`, `actions/upload-pages-artifact@v5` e `actions/deploy-pages@v5`. Use `gh api repos/actions/<nome>/releases/latest` ou uma busca na web, e anote o resultado em `specs/019-pages-deploy/research.md` §8. Se uma versão maior mais nova e estável existir há pelo menos duas semanas, atualize research §8 e `contracts/pages-workflow.md` antes de seguir.
- [X] T002 Registrar a linha de base: rodar `npm --prefix web run typecheck` e `npm --prefix web test` (devem dar 189/189), e `npm run typecheck` e `npm test` na raiz (500/500). Anote os números para a validação final em `specs/019-pages-deploy/tasks.md`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: a configuração de build validada. US1 precisa da base, e US3 precisa do endereço da API.

- [X] T003 Criar o stub `web/src/build-config.ts`. Ele exporta os tipos `BuildConfig { base: string; apiUrl: string | undefined }` e `BuildConfigResult = { ok: true; config: BuildConfig } | { ok: false; invalid: string[] }`, a constante `DEFAULT_BASE = "/opspilot/"` e a função `resolveBuildConfig(env: Record<string, string | undefined>): BuildConfigResult`, que por enquanto lança `not implemented`.
- [X] T004 Escrever `web/src/build-config.test.ts` (`// @vitest-environment node`), com casos tabelados (`test.each`) a partir das duas tabelas de [contracts/build-config.md](./contracts/build-config.md):
  - `OPSPILOT_WEB_BASE`:
    - ausente ou `""` → `/opspilot/`;
    - `/` e `//` → `/`;
    - `/ops-pilot-claude` e `/ops-pilot-claude/` → `/ops-pilot-claude/`;
    - `ops`, `/a/../b/`, `https://x/`, `/a?b`, `/a b/` → inválido.
  - `VITE_OPSPILOT_API_URL`:
    - ausente ou `""` → `undefined`;
    - `https://api.example.com/` → `https://api.example.com`;
    - `ftp://x` e `nada` → inválido.
  - Com as duas variáveis inválidas, `invalid` traz exatamente os dois nomes.
  - O resultado nunca contém o valor recebido (verificar com `JSON.stringify(result)` sem o valor).

  Rodar o teste e confirmar que falha.
- [X] T005 Implementar `resolveBuildConfig` em `web/src/build-config.ts`. A função é pura e usa zod.
  - Para a base:
    - colapsar `//` repetidos;
    - exigir `/` inicial;
    - garantir `/` final;
    - aceitar segmentos `[A-Za-z0-9._~-]+`, exceto `.` e `..`.
  - Para a URL, reaproveitar `apiUrlSchema` de `web/src/config.ts`.

  O teste T004 deve ficar verde.
- [X] T006 Em `web/vite.config.ts`:
  - trocar o export por `defineConfig(({ mode }) => { … })`;
  - obter o env com `loadEnv(mode, process.cwd(), "")` (o Vite lê `web/.env` sozinho; o agente nunca abre esse arquivo);
  - chamar `resolveBuildConfig`;
  - com `ok: false`, lançar `new Error(\`Configuração inválida: ${invalid.join(", ")}\`)`;
  - usar `config.base` como `base`.

  Manter `preview.port` e o bloco `test` intactos. O `web/src/build.test.ts` existente deve continuar verde sem mudança, porque sem a variável a base é `/opspilot/`.

**Checkpoint**: `npm --prefix web test` e `npm --prefix web run typecheck` verdes, e o build padrão igual ao da 018.

---

## Phase 3: User Story 1 - Publicar a war room a cada mudança aprovada (Priority: P1) 🎯 MVP

**Goal**: um push em `main` que toque `web/` publica a war room no Pages, sob o caminho real do site, com fallback para caminhos desconhecidos.

**Independent Test**: `OPSPILOT_WEB_BASE=/ops-pilot-claude/ npm --prefix web run build` gera recursos sob `/ops-pilot-claude/` e um `404.html` idêntico ao `index.html`. Fora isso, o workflow passa no contrato de gatilhos e publicação. No GitHub, valide com o quickstart §2.

### Tests for User Story 1

- [X] T007 [P] [US1] Ampliar `web/src/build.test.ts`, mantendo o teste existente:
  - **(a)** depois do build padrão, `404.html` existe e é idêntico ao `index.html`;
  - **(b)** um build com base customizada gera todo `src`/`href` sob `/ops-pilot-claude/`, e o `404.html` também é idêntico.

  Para o build customizado, o caminho mais simples é chamar `build({ root, base: "/ops-pilot-claude/", … })`, porque o `base` inline prevalece sobre o do config. Use `timeout: 120_000`. Os testes devem falhar porque o `404.html` ainda não existe.
- [X] T008 [P] [US1] Criar `web/src/deploy.test.ts` (`// @vitest-environment node`), que lê `.github/workflows/pages.yml` como texto. Os testes de US1 verificam:
  - o gatilho `push` com `branches: [main]` e com `paths` contendo `web/**` e `.github/workflows/pages.yml`;
  - os usos `actions/checkout@`, `actions/setup-node@` (com `node-version: 22`), `actions/configure-pages@` (com `id: pages`), `actions/upload-pages-artifact@` (com `path: web/dist`) e `actions/deploy-pages@` (com `id: deployment`);
  - `OPSPILOT_WEB_BASE: ${{ steps.pages.outputs.base_path }}/`;
  - `needs: build`;
  - `environment` com `name: github-pages` e `url: ${{ steps.deployment.outputs.page_url }}`;
  - `permissions: {}` no topo, `contents: read` e `pages: read` no `build`, `pages: write` e `id-token: write` no `deploy`, e nenhum `contents: write`.

  Para separar as permissões por job, recorte o texto entre `build:` e `deploy:`. O teste falha enquanto o arquivo não existe; isso conta como "red" para um arquivo de configuração e deve ser registrado.

### Implementation for User Story 1

- [X] T009 [US1] Em `web/vite.config.ts`, adicionar o plugin `spaFallback()`, com `name: "opspilot-spa-fallback"` e `enforce: "post"`. No `generateBundle(_, bundle)`, ele pega o asset `index.html` do bundle e chama `this.emitFile({ type: "asset", fileName: "404.html", source })` com o mesmo conteúdo. Se o `index.html` não estiver no bundle, deve lançar erro explícito. Registrar o plugin depois de `react()`. O T007 deve ficar verde.
- [X] T010 [US1] Criar `.github/workflows/pages.yml` seguindo [contracts/pages-workflow.md](./contracts/pages-workflow.md):
  - `name: Pages`, com os gatilhos `push`/`paths`;
  - `permissions: {}`;
  - job `build` (`runs-on: ubuntu-latest`, com as permissões do contrato) com as etapas checkout → setup-node → configure-pages (`id: pages`) → `npm ci --prefix web` → `npm --prefix web run build` (com `env.OPSPILOT_WEB_BASE`) → upload-pages-artifact;
  - job `deploy` (`needs: build`, `environment`, `deploy-pages` com `id: deployment`).

  Os comentários no arquivo ficam em pt-BR. O T008 deve ficar verde.

**Checkpoint**: US1 é publicável. O build com base customizada sai correto, e o contrato do workflow passa.

---

## Phase 4: User Story 2 - Nunca publicar uma versão quebrada (Priority: P1)

**Goal**: typecheck e testes barram a publicação; as execuções não rodam em paralelo; a publicação não usa nenhum segredo.

**Independent Test**: o contrato garante a ordem `typecheck` → `test` → `build` antes do upload, `concurrency` com `cancel-in-progress: false` e ausência de `secrets.`. No GitHub, valide com o quickstart §3: um push que quebra um teste faz o `build` falhar e o `deploy` não roda.

### Tests for User Story 2

- [X] T011 [US2] Acrescentar a `web/src/deploy.test.ts`:
  - **(a)** as linhas `npm ci --prefix web`, `npm --prefix web run typecheck`, `npm --prefix web test`, `npm --prefix web run build` e `actions/upload-pages-artifact@` aparecem nessa ordem (índices crescentes no texto);
  - **(b)** há um bloco `concurrency:` com `group: pages` e `cancel-in-progress: false`;
  - **(c)** a string `secrets.` não aparece em nenhum lugar;
  - **(d)** nenhuma etapa tem `continue-on-error: true`.

  Rodar e confirmar que falha nos itens (a) e (b).

### Implementation for User Story 2

- [X] T012 [US2] Em `.github/workflows/pages.yml`, inserir `npm --prefix web run typecheck` e `npm --prefix web test` entre `npm ci` e o build, e adicionar `concurrency: { group: pages, cancel-in-progress: false }` no nível do workflow, com um comentário explicando o FR-009. O T011 deve ficar verde.

**Checkpoint**: US1 + US2 entregam o MVP seguro.

---

## Phase 5: User Story 3 - Publicar sob demanda e saber configurar (Priority: P2)

**Goal**: disparo manual; endereço padrão da API por variável de repositório; README e `.env.example` completos.

**Independent Test**: o contrato encontra `workflow_dispatch` e `VITE_OPSPILOT_API_URL: ${{ vars.OPSPILOT_API_URL }}` no passo de build. Seguindo só o README, num repositório novo, chega-se ao site no ar falando com uma API (quickstart §2).

### Tests for User Story 3

- [X] T013 [US3] Acrescentar a `web/src/deploy.test.ts`:
  - **(a)** `workflow_dispatch:` está presente em `on:`;
  - **(b)** `VITE_OPSPILOT_API_URL: ${{ vars.OPSPILOT_API_URL }}` está presente e aparece depois de `npm --prefix web run build`, antes do upload.

  Rodar e confirmar que falha.

### Implementation for User Story 3

- [X] T014 [US3] Em `.github/workflows/pages.yml`, adicionar `workflow_dispatch:` aos gatilhos e `VITE_OPSPILOT_API_URL: ${{ vars.OPSPILOT_API_URL }}` ao `env` do passo de build. O T013 deve ficar verde.
- [X] T015 [P] [US3] Criar `web/.env.example` só com chaves vazias e comentários em pt-BR:
  - `VITE_OPSPILOT_API_URL=`: endereço padrão da API no build. É público, porque fica no JS publicado.
  - `OPSPILOT_WEB_BASE=`: caminho de publicação. O padrão é `/opspilot/`; no Pages, o workflow preenche.

  Conferir com `git check-ignore web/.env.example`, que **não** deve listar o arquivo.
- [X] T016 [US3] Atualizar `web/README.md`, mantendo as seções atuais que continuam válidas:
  - **Comandos**: acrescentar `OPSPILOT_WEB_BASE=/x/ npm --prefix web run build`.
  - **Endereço da API**: o item 2 cita o `.env.example`, agora existente, e a variável de repositório `OPSPILOT_API_URL`. Avisar que, sem endereço configurado na versão publicada no Pages, o padrão é a origem do Pages, onde não há API; o plantonista usa a ⚙.
  - **Nova seção "Publicar no GitHub Pages"**:
    1. *Settings → Pages → Source → GitHub Actions*.
    2. Variável opcional `OPSPILOT_API_URL` em *Settings → Secrets and variables → Actions → Variables*, explicando por que é `vars` e não `secrets`.
    3. Gatilhos: push em `main` que toque `web/**` ou o workflow, e *Run workflow* manual.
    4. Endereço público: `https://<usuário>.github.io/<repo>/`, ou domínio próprio. O caminho de publicação é ajustado sozinho.
    5. As verificações que barram a publicação, e por que a versão no ar não muda quando algo falha.
    6. Permissões por job e o porquê.
    7. Concorrência.
    8. Fallback `404.html`. Recarregar e abrir caminhos desconhecidos funciona, mas o status HTTP desses caminhos é 404.
    9. Recomendação opcional de fixar as actions por SHA.
  - **CORS**: incluir a origem do Pages, `https://<usuário>.github.io`, sem caminho nem barra final. Avisar sobre `https://` × `http://`: o site em HTTPS precisa de API em HTTPS; `localhost` costuma ser aceito, mas não por todos os navegadores.
  - Renomear "Publicar sob `/opspilot/`" para "Publicar em outro servidor", mantendo o exemplo nginx e citando `OPSPILOT_WEB_BASE`.

**Checkpoint**: as três histórias estão completas.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T017 [P] Em `AGENTS.md` (arquivo CRLF; preserve os finais de linha), acrescentar à seção "War room web" uma linha sobre o specs/019. Ela deve citar:
  - o `.github/workflows/pages.yml` (build só com leitura → `upload-pages-artifact`; deploy com `pages: write` + `id-token: write` → `deploy-pages`);
  - os gatilhos `web/**` e manual;
  - a base via `OPSPILOT_WEB_BASE` (`resolveBuildConfig`, `web/src/build-config.ts`, padrão `/opspilot/`);
  - a variável de repositório `OPSPILOT_API_URL`;
  - o `404.html`.

  Na linha "Comandos", não acrescentar nada além do que for necessário.
- [X] T018 Rodar a validação local do [quickstart.md](./quickstart.md) §1:
  - o typecheck e os testes da web, e o typecheck e os testes da raiz, que devem continuar 500/500 (FR-013);
  - o build com `OPSPILOT_WEB_BASE=/ops-pilot-claude/`, seguido de `preview` em `http://localhost:4173/ops-pilot-claude/`, conferindo o HTTP 200 da página, do JS e do CSS e um caminho desconhecido que devolve a war room;
  - os builds com `OPSPILOT_WEB_BASE=ops` e com `VITE_OPSPILOT_API_URL=nada`, que devem falhar citando só o nome da variável.

  Parar o `preview` no fim.
- [X] T019 Confirmar que nenhum arquivo da API (`src/`, `package.json` da raiz) mudou. Depois, acrescentar ao fim deste `tasks.md` a seção "Resultado da validação", com:
  - os números antes e depois;
  - o que foi verificado localmente;
  - o que fica para o GitHub (quickstart §2–§3: ativação do Pages, push para `main`, primeira execução, risco do `pages: read` no `configure-pages` com o plano B do research §2).

  Marcar todas as tarefas `[X]`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001–T002)**: sem dependências. O T001 pode ajustar as versões usadas em T010.
- **Foundational (T003–T006)**: depende do Setup e bloqueia todas as histórias.
- **US1 (T007–T010)**: depende do Foundational.
- **US2 (T011–T012)**: depende do T010, que cria o workflow.
- **US3 (T013–T016)**: T013/T014 dependem do T010. T015 e T016 só dependem do Foundational.
- **Polish (T017–T019)**: depende de todas as histórias.

### Within Each User Story

- Teste → confirmar falha → implementação → confirmar verde.
- `web/src/deploy.test.ts` é editado em T008, T011 e T013, sempre em sequência. O mesmo vale para `.github/workflows/pages.yml` em T010, T012 e T014, e para `web/vite.config.ts` em T006 e T009.

### Parallel Opportunities

- T007 ∥ T008: arquivos diferentes.
- T015 ∥ T016 ∥ T017: arquivos diferentes, sem dependência entre si.

## Parallel Example: User Story 1

```text
Juntas: T007 (web/src/build.test.ts) e T008 (web/src/deploy.test.ts)
Depois: T009 (vite.config.ts → 404.html) e T010 (pages.yml), também em arquivos diferentes
```

## Implementation Strategy

### MVP First (US1 + US2)

1. Setup → Foundational.
2. US1: a publicação já funciona.
3. US2, logo em seguida: nunca publicar quebrado. As duas histórias são P1, e só publique de verdade com as duas prontas.
4. **Parar e validar** com quickstart §1 local e, se houver repositório, §2–§3.

### Incremental Delivery

- US3 acrescenta o disparo manual, o endereço da API por variável e a documentação. Sem US3, a war room publicada funciona, mas o plantonista precisa informar o endereço da API na ⚙.

## Notes

- Nada é commitado nem empurrado. A ativação do Pages e o push para `main` ficam com o mantenedor.
- `web/.env` existe localmente e nunca é aberto. O `loadEnv` do Vite o lê sozinho no build local.

---

## Resultado da validação (2026-11-20)

### Números

| Suíte | Antes | Depois |
|---|---|---|
| Web: typecheck | limpo | limpo |
| Web: testes | 189 (2 falhando, ver abaixo) → 189/189 | 223/223 (17 arquivos) |
| Raiz: typecheck | limpo | limpo |
| Raiz: testes | 500/500 | 500/500, API intocada (FR-013) |

Os 34 testes novos:
- 24 em `build-config.test.ts`;
- 1 a mais em `build.test.ts` (base customizada), e o teste existente também
  passou a conferir o `404.html`;
- 9 em `deploy.test.ts`, o contrato do workflow.

### Achado da linha de base: bomba-relógio nos testes da 018

No T002, 2 testes da web falharam, `App.test.tsx` (aprovação) e
`keyboard.test.tsx`.

- **Causa**: as fixtures geradas pela API têm relógio fixo (`createdAt`
  12:00Z, `expiresAt` 12:15Z). Depois das 12:15Z de qualquer dia, o cartão nasce
  expirado e os botões somem. Os testes só passaram na 018 porque rodaram antes
  desse horário.
- **Correção, nos testes**: `freshFixture` em `web/src/test/http.ts` traz
  `createdAt`/`expiresAt` para agora e mantém o TTL. Ela é usada em
  `App.test.tsx`, `keyboard.test.tsx` e `a11y.test.tsx`.
- As fixtures, que são o contrato gerado pela API, não mudaram. Os testes que
  injetam `now` (`ApprovalCard.test.tsx`, `state/chat.test.ts`) não precisavam da
  correção.

### Verificado localmente (quickstart §1)

- **Versões das actions (T001)**, na API pública de releases:
  - `checkout@v7`
  - `setup-node@v7`
  - `configure-pages@v6`
  - `upload-pages-artifact@v5`
  - `deploy-pages@v5`

  O plano tinha `v5/v4`, que estavam desatualizadas. Todas as cinco foram
  publicadas há mais de 2 semanas.
- **Red antes do green**: todos os testes falharam por asserção antes da
  implementação.
  - `build-config`: 23 falhas, com stub.
  - `build.test`: `404.html` ausente.
  - `deploy.test`: arquivo ausente (T008), etapas e concorrência ausentes
    (T011), `workflow_dispatch` e `vars` ausentes (T013).
- **Build com `OPSPILOT_WEB_BASE=/ops-pilot-claude/`**:
  - `src`/`href` sob `/ops-pilot-claude/`;
  - `404.html` idêntico (`cmp`);
  - no `preview`, a página, o JS, o CSS e `/ops-pilot-claude/qualquer-coisa/profunda` responderam 200 e serviram a war room.
- **Configuração inválida**:
  - `OPSPILOT_WEB_BASE=ops` falha com `Configuração inválida: OPSPILOT_WEB_BASE`.
  - `VITE_OPSPILOT_API_URL=nada` falha com `Configuração inválida: VITE_OPSPILOT_API_URL`.
- **Build padrão**: continua sob `/opspilot/`, e o `web/dist` foi regerado assim
  no fim.
- **`web/.env.example`**: não é ignorado pelo git (`git check-ignore` → exit 1).
- **Arquivos da API**: nenhum arquivo em `src/` ou `package.json` da raiz mudou
  depois da spec.

### Desvios do tasks.md

- **`deploy.test.ts`**: resolve o workflow a partir do próprio arquivo
  (`import.meta.url`), e não do `process.cwd()`. Pelo `cwd`, ele falhava quando o
  Vitest rodava a partir da raiz.
- **Plugin `spaFallback`**: também tem `apply: "build"`, para não atuar no
  `dev`.
- **Windows/Git Bash**: um `OPSPILOT_WEB_BASE=/x/` na linha de comando é
  reescrito pelo MSYS para `C:/Program Files/Git/x/`, e a validação o rejeita
  corretamente. Localmente, use `MSYS_NO_PATHCONV=1`. No runner Linux isso não
  acontece. A nota está no quickstart e no README.

### Fica para o GitHub (quickstart §2–§3)

- Criar o repositório remoto e empurrar para `main`. Hoje o trabalho local está
  em `master`, sem remoto.
- Ativar *Settings → Pages → Source → GitHub Actions*. Opcionalmente, criar
  `OPSPILOT_API_URL`.
- Primeira execução: confirmar que o `configure-pages@v6` funciona só com
  `pages: read`. Se não funcionar, o plano B está no research §2.
- SC-001/SC-002/SC-005 e FR-009 em execuções reais:
  - o tempo até ficar no ar;
  - um push com teste quebrado não publica;
  - um push só na API não dispara;
  - duas publicações seguidas não rodam juntas.

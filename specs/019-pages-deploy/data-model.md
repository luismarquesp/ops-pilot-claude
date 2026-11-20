# Data Model: Publicação automática da war room

Não há dados persistidos. As "entidades" são as configurações que entram no build
e a execução do workflow.

## BuildConfig (saída de `resolveBuildConfig`, pura)

| Campo | Origem | Regra | Padrão |
|-------|--------|-------|--------|
| `base` | `OPSPILOT_WEB_BASE` | caminho absoluto. A barra inicial e a final são normalizadas (`/repo` vira `/repo/`, vazio com domínio próprio vira `/`). Não aceita `..`, `//`, esquema nem query | `/opspilot/` |
| `apiUrl` | `VITE_OPSPILOT_API_URL` | o mesmo `apiUrlSchema` de `web/src/config.ts` (http/https, sem barra final) | `undefined`, que mantém a regra da 018 |

- **Entrada**: um registro `env` (`Record<string, string | undefined>`).
- **Saída**: `{ ok: true, config }` ou `{ ok: false, invalid: string[] }`. Na
  falha, `invalid` traz só os **nomes** das variáveis, nunca os valores.
- O `vite.config.ts` lança erro com esses nomes quando recebe `ok: false`, e o
  build falha.

### Distinção vazio × ausente para `base`

- Variável ausente, ou build local → `/opspilot/`.
- No workflow, a variável é sempre definida a partir do `base_path`. Para não
  confundir "vazio = domínio próprio" com "vazio = não configurado", o workflow
  passa `${{ steps.pages.outputs.base_path }}/`. Assim, domínio próprio vira `/`
  e repositório de projeto vira `/repo/`.

## Publicação (execução do workflow)

```text
gatilho (push em main com paths | manual)
  └─ build: checkout → setup-node 22 → configure-pages → npm ci
            → typecheck → test → build (base, apiUrl) → upload-pages-artifact
       └─ falha em qualquer etapa → fim; o site segue com a versão anterior
  └─ deploy (needs: build): deploy-pages → page_url no environment github-pages
```

- **Concorrência**: um grupo `pages`, no máximo uma execução rodando e uma
  pendente (a mais nova).

## Artefato publicado

- Exatamente o conteúdo de `web/dist/`: `index.html`, `404.html` (idêntico ao
  `index.html`) e `assets/*`.
- Nada fora de `web/dist/` entra no artefato.

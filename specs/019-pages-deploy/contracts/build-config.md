# Contrato: configuração do build da war room

## `resolveBuildConfig(env)` (`web/src/build-config.ts`, pura)

| `OPSPILOT_WEB_BASE` | `base` |
|---|---|
| ausente ou `""` | `/opspilot/` |
| `/` | `/` |
| `/ops-pilot-claude` | `/ops-pilot-claude/` |
| `/ops-pilot-claude/` | `/ops-pilot-claude/` |
| `//` (domínio próprio: `""` + `/` no workflow) | `/` |
| `ops`, `/a/../b/`, `https://x/`, `/a?b`, `/a b/` | inválido |

| `VITE_OPSPILOT_API_URL` | `apiUrl` |
|---|---|
| ausente ou `""` | `undefined` (regra da 018) |
| `https://api.example.com/` | `https://api.example.com` |
| `ftp://x`, `nada` | inválido |

- Em caso de falha, o resultado é `{ ok: false, invalid: ["OPSPILOT_WEB_BASE", ...] }`,
  só com os nomes das variáveis. O `vite.config.ts` lança
  `Error("Configuração inválida: <nomes>")`.

## Saída do build (`web/dist/`)

- Todo `src`/`href` do `index.html` começa com o `base` resolvido.
- `404.html` existe e tem o mesmo conteúdo do `index.html`.
- Sem `OPSPILOT_WEB_BASE`, a saída é igual à da 018: o `build.test.ts` atual
  continua passando sem mudança.

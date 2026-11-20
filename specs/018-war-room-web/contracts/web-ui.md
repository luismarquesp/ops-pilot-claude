# Contract: interface da war room (web)

Regras visuais: [.github/instructions/design.instructions.md](../../../.github/instructions/design.instructions.md).
Este contrato fixa a estrutura, os estados e a acessibilidade que os testes
verificam.

## Layout (uma página, `/opspilot/`)

```text
┌ header ─────────────────────────────────────────────┐
│ OpsPilot · War room        [Nova conversa] [⚙]      │
├ main (aria-live="polite" na lista) ────────────────┤
│  mensagens…                                         │
│  ┌ cartão de aprovação (role="region") ──────────┐  │
│  │ ⚠ Aprovação necessária                        │  │
│  │ Resolver o incidente #3                       │  │
│  │ ▸ Detalhes técnicos                           │  │
│  │ [Aprovar]  [Negar]          expira em 14:32   │  │
│  └───────────────────────────────────────────────┘  │
├ composer ───────────────────────────────────────────┤
│ [ textarea com <label> ]                 [Enviar]   │
└─────────────────────────────────────────────────────┘
```

## Componentes e estados

| Componente | Estados obrigatórios | Notas |
|------------|---------------------|-------|
| `MessageList` | vazio (exemplos clicáveis), com dados, "conversa retomada" | `role="log"` + `aria-live="polite"` |
| `AssistantMessage` | respondida, com erro (`ErrorNotice`), cancelada | Markdown sem HTML cru; botão **Ver raciocínio** |
| `PendingIndicator` | só depois de 300ms; "Pensando… 12s" + **Cancelar** | `aria-busy` na lista |
| `TraceDrawer` | com passos, sem passos, passo desconhecido | `role="dialog"` + `aria-modal`, foco preso, `Esc` fecha e devolve o foco ao botão; métricas no topo |
| `TraceStep` | um por `type`: `route`, `plan`, `thought`, `action`, `observation`, `critique`, `fallback` (aviso), `summarize`, `approval`, `decision`, `answer`, `unknown` | ícone + rótulo de texto + `node`; conteúdo longo recolhível |
| `ApprovalCard` | `pending`, `deciding`, `approved`, `denied`, `expired`, falha (volta a `pending` com erro) | **Aprovar** é a ação primária, **Negar** a secundária. Os botões ficam desativados fora de `pending`. Mostra o tempo até expirar |
| `Composer` | pronto, enviando, bloqueado por aprovação (com motivo) | envio desativado com texto vazio; `Enter` envia, `Shift+Enter` quebra linha; o texto é mantido em erro |
| `SettingsDialog` | editar, URL inválida (erro no campo), testando, conectado, origem não autorizada, inacessível | o endereço padrão aparece; salvar uma URL diferente inicia nova conversa |
| `ErrorNotice` | um por código (tabela das design instructions) + rede | `requestId` copiável; ação "Tentar de novo" ou "Nova conversa" conforme o caso |

## Mapa de respostas da API → UI

| Resposta | UI |
|----------|----|
| 200 `/chat` ou decisão | `AssistantMessage` com rastro e métricas |
| 202 | `ApprovalCard` `pending`; `Composer` bloqueado |
| 404 `conversation_not_found` | `ErrorNotice` + "Começar nova conversa" |
| 409 / 410 na decisão | cartão vai para o estado `status` devolvido / `expired` |
| 503 / 504 / 500 | `ErrorNotice` + "Tentar de novo". Na decisão, o cartão mostra "decidida; resposta não veio" |
| `TypeError` (rede) | `ErrorNotice` "Não foi possível falar com a API em {url}" + link para ⚙ |
| corpo fora do schema zod | `ErrorNotice` "Resposta inesperada da API" + `requestId` do cabeçalho, se houver |

## Build

- `vite build` com `base: "/opspilot/"`: todos os recursos saem com URL
  relativa a esse caminho.
- `VITE_OPSPILOT_API_URL` é opcional, no momento do build.

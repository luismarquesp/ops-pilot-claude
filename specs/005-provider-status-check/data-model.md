# Data Model: Status de Provedores Externos

Esta feature não introduz nenhuma entidade persistida (sem tabela, sem
`OpsStore`). Os "dados" aqui são tipos de request/response de uma integração
HTTP somente leitura.

## Enum fechado

| Enum | Valores | Onde |
|---|---|---|
| `Provider` | `github` \| `cloudflare` | parâmetro `provider` da tool |
| `StatusIndicator` | `none` \| `minor` \| `major` \| `critical` | campo `status.indicator` da resposta da statuspage.io (mesmo vocabulário para qualquer provedor) |

## Mapeamento provedor → URL

| Provider | URL |
|---|---|
| `github` (default) | `https://www.githubstatus.com/api/v2/status.json` |
| `cloudflare` | `https://www.cloudflarestatus.com/api/v2/status.json` |

Nenhuma chave/autenticação — endpoint público da statuspage.io.

## Shape da resposta (validado com Zod antes de qualquer uso)

```ts
interface StatusPageResponse {
	status: {
		indicator: "none" | "minor" | "major" | "critical";
		description: string;
	};
}
```

Campos fora de `status` (ex.: `page`, incidentes ativos, componentes) existem
na resposta real da statuspage.io mas são ignorados de propósito — a spec
pede um retorno compacto (FR-008), e `.parse()` do Zod só valida os campos
declarados no schema, sem exigir os demais.

## Resultado devolvido pela tool (texto, não objeto)

```text
${provider}: ${indicator} — ${description}
```

Exemplo: `"github: none — All Systems Operational"`.

Em caso de falha final (depois de qualquer retentativa aplicável):

```text
Erro: não foi possível consultar o status do ${provider} (${motivo}).
```

`motivo` é uma descrição curta e legível da causa (timeout, HTTP `4xx/5xx`,
resposta em formato inesperado) — nunca o stack trace bruto do erro original.

## Sem transições de estado

Não há entidade com ciclo de vida aqui — cada chamada da tool é uma consulta
pontual e sem efeito colateral (não abre, resolve, nem persiste nada).

# Phase 0 Research: Status de Provedores Externos

Nenhum item ficou marcado `NEEDS CLARIFICATION` no Technical Context. Abaixo,
as decisões técnicas necessárias para fechar o design.

## 1. Cliente HTTP: `fetch` nativo do Node, sem dependência nova

**Decision**: usar o `fetch` global do Node 22 (nenhum pacote `axios`/`node-fetch`
adicionado ao `package.json`), injetado como parâmetro opcional de
`createProviderStatusTool(fetchImpl = fetch)` para os testes substituírem por
um fake determinístico.

**Rationale**: `fetch`/`Response`/`AbortSignal.timeout` já tipam corretamente
com o `tsconfig.json` atual (validado nesta sessão) — não há necessidade de
lib `"DOM"` nem de pacote de terceiros. Mesma filosofia já aplicada ao projeto
(SQLite via `node:sqlite` nativo, sem driver externo): preferir a API nativa
do runtime a uma dependência.

**Alternatives considered**: `axios` — rejeitado, dependência nova sem
necessidade real; o projeto já não usa nenhum cliente HTTP de terceiros em
lugar nenhum do código atual.

## 2. Classificação de retry: o que é "passageiro" vs. falha final

**Decision**: dois passos distintos, só o primeiro é retentado:

1. **Transporte** (`fetch` + status HTTP): erro de rede/timeout do próprio
   `fetch` (inclui abort por `AbortSignal.timeout`), OU resposta HTTP `5xx` →
   tratado como falha passageira, uma nova tentativa automática.
2. **Interpretação** (parse do JSON + validação Zod): resposta HTTP `4xx`, OU
   corpo que não é JSON válido, OU JSON que não bate com o schema esperado →
   tratado como falha final, sem nova tentativa.

**Rationale**: é exatamente a regra da spec (FR-006/FR-007, Assumptions) —
"falha de rede ou 5xx, uma nova tentativa"; um `4xx` (ex.: URL mudou, endpoint
não existe mais) ou um corpo em formato inesperado não se resolve tentando de
novo imediatamente — retentar não muda o resultado e só atrasa a resposta ao
plantonista.

**Alternatives considered**: retentar qualquer falha (incluindo 4xx/parse
inválido) — rejeitado, spec explicitamente limita a nova tentativa a
rede/5xx; retentar indefinidamente com backoff — rejeitado, spec pede
"exatamente uma", e o teto de 5s por tentativa já é o suficiente para o caso
de uso (uma pergunta de plantão, não um job em background).

## 3. Timeout: `AbortSignal.timeout(5000)`

**Decision**: cada tentativa de `fetch` recebe `{ signal: AbortSignal.timeout(5000) }`
— API nativa do Node, sem `setTimeout`/`clearTimeout` manual.

**Rationale**: é a forma padrão e menos propensa a erro de implementar um
teto de tempo com `fetch` nativo — o próprio `fetch` aborta a requisição e
rejeita a promise quando o timeout vence, sem vazar timers.

**Alternatives considered**: `Promise.race` com um `setTimeout` manual —
rejeitado, mais código para o mesmo resultado, e não cancela de fato a
requisição de rede subjacente (`AbortSignal` cancela; `Promise.race` sozinho
não).

## 4. Validação da resposta: schema Zod fiel ao formato da statuspage.io

**Decision**:

```ts
const statusPageResponseSchema = z.object({
	status: z.object({
		indicator: z.enum(["none", "minor", "major", "critical"]),
		description: z.string(),
	}),
});
```

Os 4 valores de `indicator` são o conjunto fechado documentado pela própria
API v2 da statuspage.io (`none` = tudo operacional; `minor`/`major`/`critical`
= graus crescentes de degradação) — mesmo formato para qualquer página
statuspage.io, incluindo GitHub e Cloudflare.

**Rationale**: Constitution Princípio I (validação na fronteira) — uma
resposta de rede de terceiros é uma fronteira tão não confiável quanto um
body HTTP de entrada; falha de validação vira o mesmo tipo de erro final
tratado (não retentado) descrito na decisão #2.

**Alternatives considered**: validar só `typeof` manualmente sem Zod —
rejeitado, inconsistente com o padrão já usado no resto do projeto (toda
validação de fronteira passa por Zod).

## 5. Formato do retorno: uma linha de texto simples, não JSON

**Decision**: a tool retorna uma string simples de uma linha, ex.:
`"github: major — Partial System Outage"` (formato `${provider}: ${indicator} — ${description}`),
em vez do `JSON.stringify(...)` que as tools do `OpsStore` usam.

**Rationale**: pedido explícito da spec (FR-008: resposta cabe em uma frase
objetiva, "para não inflar o contexto") — o valor aqui é a resposta caber
diretamente na conversa; uma tool de leitura sem estrutura para outra tool
consumir depois não precisa do overhead de chaves JSON.

**Alternatives considered**: manter o padrão `JSON.stringify({ provider,
indicator, description })` das outras tools — rejeitado para esta tool
especificamente; a spec já pede um formato mais compacto que o dos objetos
`Alert`/`Incident`, que têm mais campos e são consumidos por múltiplas
tools/telas.

## 6. Onde a tool vive: módulo próprio, sem tocar `OpsStore`

**Decision**: `src/agents/provider-status-tool.ts`, exportando
`createProviderStatusTool(fetchImpl?: typeof fetch): StructuredToolInterface`
— função isolada, sem receber `OpsStore`. Composição (`index.ts`, `arena.ts`,
`bench.ts`) concatena `[...createOpsTools(store), createProviderStatusTool()]`.

**Rationale**: o texto original do usuário citava `src/agents/tool.ts`
(singular) — provavelmente um typo do `tools.ts` já existente; em vez de
sobrescrever/colidir com esse nome, ou misturar uma integração HTTP externa
dentro de `createOpsTools` (que hoje só conhece `OpsStore`), um módulo
dedicado mantém `tools.ts` focado em uma responsabilidade (Constitution
Princípio III: camadas com responsabilidade única) e deixa a tool nova
trivialmente testável isolada, sem precisar de um `OpsStore` fake para os
testes.

**Alternatives considered**: adicionar `check_provider_status` dentro de
`createOpsTools` em `tools.ts` — rejeitado, misturaria uma dependência HTTP
externa (com sua própria lógica de retry/timeout) na função que hoje só
depende do `OpsStore`, tornando os testes de `tools.ts` dependentes de mockar
`fetch` mesmo quando o teste é só sobre incidentes.

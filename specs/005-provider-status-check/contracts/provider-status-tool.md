# Contract: `check_provider_status`

```ts
export function createProviderStatusTool(
	fetchImpl: typeof fetch = fetch,
): StructuredToolInterface;
```

Sem dependência de `OpsStore` — pode ser testada e usada isoladamente.

## Schema (Zod, validado na fronteira — Constitution Princípio I)

```ts
schema: z.object({
	provider: z
		.enum(["github", "cloudflare"])
		.default("github")
		.describe(
			"Provedor externo a consultar. Default: github. Use quando houver " +
			"suspeita de problema externo/upstream (\"é o nosso ou do provedor?\"), " +
			"uma dependência aparentemente fora do ar.",
		),
});
```

`provider` fora do enum → chamada da tool rejeitada pelo Zod antes de
qualquer `fetch` (spec.md FR-004/Acceptance Scenario 4 da US1) — mesmo padrão
já usado por `severity`/`status` nas tools do `OpsStore`.

## Descrição da tool (checklist de 6 regras, research.md-004 §7 do projeto)

1. O que faz: consulta o status público de um provedor externo.
2. Quando usar: suspeita de causa externa durante um incidente — "é o nosso
   ou é do provedor?", dependência aparentemente fora do ar.
3. Quando NÃO usar: para abrir/rastrear um incidente do próprio time — isso é
   `open_incident`/`list_incidents`; esta tool nunca toca o `OpsStore`.
4. Todo campo do schema tem `.describe()` (só há um campo: `provider`).
5. `provider` é `z.enum(...)`, nunca string livre; default explícito (`github`)
   citado na própria descrição do campo.
6. Descrição curta, sem sobrepor frase-gatilho com as tools de incidente.

## Comportamento

### Sucesso

- `provider` válido (ou omitido → `github`) → uma tentativa de `fetch` à URL
  correspondente (`AbortSignal.timeout(5000)`).
- HTTP `2xx` com corpo que bate com o schema Zod (`data-model.md`) → retorna
  `"${provider}: ${indicator} — ${description}"`, uma linha, sem lançar.

### Falha passageira → uma nova tentativa automática

- `fetch` rejeita (erro de rede, DNS, ou abort por timeout), OU resposta HTTP
  `5xx` → repete a mesma requisição exatamente mais uma vez.
- Se a segunda tentativa tiver sucesso → retorna normalmente, como acima.

### Falha final → string de erro legível, nunca uma exceção

- Segunda tentativa (quando aplicável) também falha por rede/timeout/5xx, OU
- Resposta HTTP `4xx` (não retentado), OU
- Corpo não é JSON válido, ou não bate com o schema Zod (não retentado)

→ em todos os casos acima, a tool retorna
`"Erro: não foi possível consultar o status do ${provider} (${motivo})."`
como resultado da chamada — nunca lança uma exceção para fora da tool
(Constitution Princípio IV; spec.md FR-007/User Story 2).

## Casos de teste obrigatórios (fetch fake — sem rede real, spec.md FR-010)

1. `provider` omitido → consulta a URL do GitHub (default).
2. `provider: "cloudflare"` → consulta a URL do Cloudflare, não a do GitHub.
3. `provider` fora do enum → tool rejeita antes de qualquer chamada ao
   `fetchImpl` (fake nunca é invocado).
4. Sucesso na 1ª tentativa → retorna a linha compacta com indicator/description
   do fake.
5. 1ª tentativa falha por rede (fake rejeita a promise) e a 2ª tem sucesso →
   retorna normalmente (prova a retentativa).
6. 1ª tentativa retorna HTTP `500` e a 2ª também falha → retorna a string de
   erro, `fetchImpl` foi chamado exatamente 2 vezes.
7. 1ª tentativa "demora" (fake nunca resolve / respeita o abort do
   `AbortSignal`) → tool retorna a string de erro em vez de travar o teste.
8. HTTP `404` → retorna a string de erro imediatamente, `fetchImpl` foi
   chamado exatamente 1 vez (sem retentativa).
9. Corpo da resposta não bate com o schema Zod (ex.: `status.indicator` fora
   do enum, ou `status` ausente) → retorna a string de erro imediatamente,
   `fetchImpl` foi chamado exatamente 1 vez (sem retentativa).

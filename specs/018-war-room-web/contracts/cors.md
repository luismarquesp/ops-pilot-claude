# Contract: CORS (API)

O middleware `src/http/cors.ts` é montado antes de todas as rotas. As origens
vêm de `CORS_ORIGINS`:

```text
CORS_ORIGINS=http://localhost:5173,https://ops.example.com
```

- Cada item tem o formato `http(s)://host[:port]`, sem caminho nem barra
  final.
- Itens inválidos são ignorados, com o aviso
  `Origem inválida em CORS_ORIGINS; entrada ignorada.`
- Vazio ou ausente → nenhuma origem é aceita.

| Requisição | Origem | Resposta |
|------------|--------|----------|
| qualquer, sem `Origin` | — | inalterada (curl, scripts) |
| simples ou real | na lista | `Access-Control-Allow-Origin: <origem>`, `Vary: Origin`, `Access-Control-Expose-Headers: X-Request-Id` |
| `OPTIONS` (preflight) | na lista | 204, `Allow-Origin`, `Allow-Methods: GET, POST, DELETE, OPTIONS`, `Allow-Headers: Content-Type`, `Max-Age: 600`, `Vary: Origin` |
| qualquer | fora da lista | sem cabeçalhos CORS. O navegador bloqueia; a resposta em si não muda |
| `OPTIONS` | fora da lista | 204 sem cabeçalhos CORS |

O CORS nunca usa `*` nem `Access-Control-Allow-Credentials`.

A comparação de origens é exata, depois de normalizar o texto para minúsculas.

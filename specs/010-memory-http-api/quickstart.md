# Quickstart: validar a API HTTP de memória

## 1. Checagens obrigatórias

```bash
npm run typecheck
npm test
```

Esperado: tudo verde, incluindo `memory-routes.test.ts` (sem rede: memória
`:memory:` + embedder fake).

## 2. Ponta a ponta (PowerShell)

```powershell
npm run dev
```

Em outro terminal:

```powershell
$base = "http://localhost:3000/memories"
$json = "application/json; charset=utf-8"

# 1. Criar → 201
$body = @{ userId = "luis"; fact = "É responsável pelo checkout." } | ConvertTo-Json
$created = Invoke-RestMethod -Uri $base -Method POST -ContentType $json -Body $body
$created.memory

# 2. Repetir → 200 com o mesmo id (dedup)
(Invoke-WebRequest -Uri $base -Method POST -ContentType $json -Body $body).StatusCode

# 3. Segredo → 422 secret_detected
$bad = @{ userId = "luis"; fact = "minha senha: hunter2" } | ConvertTo-Json
try { Invoke-RestMethod -Uri $base -Method POST -ContentType $json -Body $bad } catch { $_.Exception.Response.StatusCode.value__ }

# 4. Listar → o fato aparece
(Invoke-RestMethod -Uri "$base?userId=luis").memories

# 5. Lembrado no chat (SC-005) → metrics.memoryFacts >= 1
$chat = @{ userId = "luis"; message = "Tem algo pegando no meu serviço?" } | ConvertTo-Json
(Invoke-RestMethod -Uri http://localhost:3000/chat -Method POST -ContentType $json -Body $chat).metrics

# 6. Remover com outro usuário → 404; com o dono → 204
$id = $created.memory.id
try { Invoke-RestMethod -Uri "$base/$id?userId=outra" -Method DELETE } catch { $_.Exception.Response.StatusCode.value__ }
(Invoke-WebRequest -Uri "$base/$id?userId=luis" -Method DELETE).StatusCode
```

Os passos 1–4 e 6 não chamam o LLM. O passo 5 chama, e precisa de
`OPENROUTER_API_KEY` configurada.

Referências: [contracts/memories-api.md](./contracts/memories-api.md), [data-model.md](./data-model.md).

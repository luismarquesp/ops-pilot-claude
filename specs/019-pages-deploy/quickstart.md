# Quickstart: validar a publicação automática

## 1. Local (sem GitHub)

```bash
npm --prefix web run typecheck
npm --prefix web test              # inclui build-config, build e o contrato do workflow
npm test && npm run typecheck      # a raiz não muda (FR-013)
```

Gere o build com a base de um site de projeto e confira a saída. No Git Bash
(Windows), prefixe com `MSYS_NO_PATHCONV=1`, senão o MSYS reescreve `/x/` para
`C:/Program Files/Git/x/` e a validação rejeita o valor:

```bash
OPSPILOT_WEB_BASE=/ops-pilot-claude/ npm --prefix web run build
OPSPILOT_WEB_BASE=/ops-pilot-claude/ npm --prefix web run preview
```

- `http://localhost:4173/ops-pilot-claude/` carrega sem erro no console.
- `web/dist/404.html` é idêntico a `web/dist/index.html`.

Uma configuração inválida faz o build falhar e citar só o nome da variável:

```bash
OPSPILOT_WEB_BASE=ops npm --prefix web run build
```

O build falha com "Configuração inválida: OPSPILOT_WEB_BASE". Teste também
`VITE_OPSPILOT_API_URL=nada`, que deve falhar do mesmo jeito.

## 2. No GitHub (primeira publicação)

Pré-requisito: o repositório está no GitHub, com a branch `main`.

1. Em *Settings → Pages → Source*, escolha **GitHub Actions**.
2. Opcional: crie a variável de repositório `OPSPILOT_API_URL`.
3. Rode *Actions → Pages → Run workflow*. Os jobs `build` e `deploy` devem ficar
   verdes. O `deploy` mostra o endereço público no ambiente `github-pages`.
4. Abra `https://<usuário>.github.io/<repo>/`. A war room deve carregar.
   - Recarregue a página, depois abra `.../<repo>/qualquer-coisa`. Os dois
     casos devem mostrar a war room.
5. Na API, inclua `https://<usuário>.github.io` em `CORS_ORIGINS` e reinicie. Na
   ⚙, o "Testar conexão" deve dar ok. A API precisa estar em `https://`, ou em
   `localhost` num navegador que aceite chamadas a ele.

## 3. Garantias (SC-002, SC-005, FR-009)

- **SC-005**: empurre uma mudança só em `src/`. Nenhuma execução de "Pages" deve
  aparecer.
- **SC-002**: empurre uma mudança em `web/` que quebra um teste. O job `build`
  falha em `test`, o `deploy` não roda, e o site segue igual.
- **FR-009**: empurre duas mudanças em `web/` seguidas. A primeira execução
  termina, e só a mais nova das pendentes roda depois.

---
applyTo: "web/**"
description: "Design da interface web do OpsPilot: hierarquia, espaçamento em escala, estados vazios e de erro, dark mode e acessibilidade."
---

# Design da interface web (OpsPilot)

O OpsPilot é usado por um plantonista sob pressão, muitas vezes de madrugada e
com pouca atenção sobrando. Toda tela responde primeiro a **"tem algo pegando
fogo agora?"**. Na dúvida, escolha o que se lê mais rápido, não o que fica mais
bonito.

As regras abaixo valem para tudo em `web/**`. Quando uma regra não couber,
justifique no PR; não abra exceção em silêncio.

## Tokens primeiro

- Nenhum valor solto de cor, espaçamento, raio, sombra, fonte ou duração no
  código de componente. Tudo vem de tokens (CSS custom properties em `:root`,
  ou o equivalente do framework).
- Os tokens têm **nome semântico** (`--color-danger`, `--color-surface`), nunca
  nome de cor (`--red-500`) dentro de componente. Paletas cruas só existem no
  arquivo de tokens.
- Um valor novo precisa ser um token novo, adicionado ao arquivo de tokens no
  mesmo PR.

## Hierarquia

- **Uma ação primária por tela ou por seção.** As demais são secundárias
  (contorno) ou terciárias (texto). Ações destrutivas, como `resolve_incident`
  feito por engano, nunca usam o estilo primário perto de outra primária.
- **Ordem de leitura:** estado crítico → resumo → detalhe. Na lista de alertas,
  `firing` vem antes de `resolved`. No `/stats`, `errors` e `errorRate` ficam
  ao lado do `total`, nunca escondidos numa aba.
- **Severidade nunca depende só da cor.** Use cor + ícone + rótulo de texto
  (`Disparando`, `Resolvido`, `Aberto`).
- **Escala tipográfica fixa**, de razão ~1.25:

  | Token          | Tamanho | Uso                                  |
  | -------------- | ------- | ------------------------------------ |
  | `--text-xs`    | 12px    | metadados, carimbos de hora          |
  | `--text-sm`    | 14px    | tabelas, rótulos                     |
  | `--text-base`  | 16px    | corpo (mínimo para texto corrido)    |
  | `--text-lg`    | 20px    | título de seção                      |
  | `--text-xl`    | 25px    | título de página                     |
  | `--text-2xl`   | 31px    | números de destaque (KPIs do `/stats`) |

- No máximo **três níveis de peso** (400, 500 e 600) e **dois tamanhos por
  componente**. Hierarquia vem de tamanho, peso e espaço, não de mais cores.
- Use números tabulares (`font-variant-numeric: tabular-nums`) em métricas,
  latências, custos e horários, para que as colunas alinhem.
- Use fonte monoespaçada para ids (`requestId`, `conversationId`), nomes de
  modelo e nomes de tool. Ids longos aparecem truncados com o valor inteiro
  copiável, por exemplo `3f2a9c1e…` com botão de copiar.

## Espaçamento em escala

- Use só a escala de base 4px:

  | Token        | Valor |
  | ------------ | ----- |
  | `--space-1`  | 4px   |
  | `--space-2`  | 8px   |
  | `--space-3`  | 12px  |
  | `--space-4`  | 16px  |
  | `--space-6`  | 24px  |
  | `--space-8`  | 32px  |
  | `--space-12` | 48px  |
  | `--space-16` | 64px  |

- Nada fora da escala: sem `13px`, `18px` ou `margin: 7px`.
- **Proximidade comunica agrupamento:** o espaço dentro de um grupo é sempre
  menor que o espaço entre grupos. Regra prática: um passo da escala por nível
  (campo↔rótulo `--space-1`, campo↔campo `--space-3`, seção↔seção `--space-8`).
- O componente não define a própria margem externa; quem posiciona é o pai
  (`gap` em flex/grid). Use `gap` em vez de margens em cadeia.
- Ritmo vertical consistente: line-height `1.5` no corpo e `1.25` em títulos.
- Larguras: texto corrido com no máximo ~70 caracteres por linha. Tabelas podem
  ocupar a largura toda.
- Responsivo a partir de 360px de largura, com margem lateral de `--space-4`
  e sem rolagem horizontal da página. Tabelas largas rolam dentro do próprio
  contêiner.

## Estados: carregando, vazio, erro

Toda tela ou componente que busca dados implementa **os quatro estados**:
carregando, vazio, erro e com dados. Um PR que entrega só "com dados" está
incompleto.

### Carregando

- Use esqueletos (skeletons) com o formato do conteúdo final, para que o layout
  não pule quando os dados chegam. Use spinner só em ações pontuais, como
  dentro de um botão.
- O turno do `/chat` pode levar até 180s: mostre progresso honesto (eventos do
  rastro conforme chegam, ou "Pensando… 12s"), nunca um spinner mudo.
- Não mostre o carregando para respostas abaixo de ~300ms, para não piscar.

### Vazio

- O estado vazio **diz o que significa e o que fazer**, numa frase:
  - Alertas: "Nenhum alerta disparando agora." É um estado **bom**; use o tom
    de sucesso, não o de erro.
  - Incidentes: "Nenhum incidente aberto." + ação "Abrir incidente".
  - `/stats` sem dados na janela: "Nenhuma requisição nas últimas 24h." +
    seletor da janela (`since`). Mostre zeros, nunca `NaN` nem `—` sem
    explicação. Percentil `null` aparece como "sem dados".
  - Memórias do usuário: explique o que é uma memória e como criar uma.
- Diferencie **"vazio de verdade"** de **"vazio por filtro"**. No segundo caso,
  ofereça "Limpar filtros".

### Erro

- Traduza o código da API para linguagem humana e diga o próximo passo. Mostre
  o `requestId` (copiável) para suporte:

  | Resposta da API                | Mensagem                                                               | Ação                        |
  | ------------------------------ | ---------------------------------------------------------------------- | --------------------------- |
  | 503 `model_unavailable`        | "Nenhum modelo respondeu. Tentamos: {modelsTried}."                    | Tentar de novo              |
  | 504 timeout                    | "A resposta passou de 3 minutos."                                      | Tentar de novo              |
  | 404 `conversation_not_found`   | "Essa conversa não existe mais."                                       | Começar nova conversa       |
  | 404 `request_not_found`        | "Requisição não encontrada."                                           | Voltar                      |
  | 422 `unknown_strategy`         | "Estratégia inválida. Disponíveis: {available}."                       | Corrigir                    |
  | 422 `secret_detected`          | "Esse texto parece conter um segredo e não foi salvo."                 | Editar                      |
  | 400 (`issues`)                 | Erro junto ao campo correspondente (`path`), não num toast genérico    | Corrigir                    |
  | 500 / rede                     | "Algo deu errado do nosso lado."                                       | Tentar de novo + `requestId` |

- Erro de **campo** aparece junto do campo, associado por `aria-describedby`.
  Erro de **página** aparece onde o conteúdo estaria. Toast serve só para
  confirmações transitórias, nunca como único lugar de um erro.
- Nunca mostre stack trace, mensagem crua de exceção nem payload de
  rastro com conteúdo do usuário numa mensagem de erro. Vale a mesma regra dos
  logs (specs/016).
- Não perca a entrada do usuário num erro: a mensagem digitada no chat continua
  no campo depois de um 503 ou 504.

## Dark mode

- Suporte claro e escuro desde o primeiro componente. O padrão segue
  `prefers-color-scheme`, e existe um seletor manual (claro / escuro / sistema)
  que é persistido no navegador.
- Implemente redefinindo **os mesmos tokens semânticos**. Componente nenhum tem
  `if (dark)` nem classes `dark:` espalhadas:

  ```css
  :root { --color-bg: #ffffff; --color-surface: #f6f7f9; --color-text: #16181d; }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) { --color-bg: #0f1115; --color-surface: #171a21; --color-text: #e6e8ec; }
  }
  :root[data-theme="dark"] { --color-bg: #0f1115; --color-surface: #171a21; --color-text: #e6e8ec; }
  ```

- No escuro, **elevação vem de superfícies mais claras**, não de sombras mais
  fortes. Evite preto puro (`#000`) no fundo e branco puro no texto longo.
- Cores de status (perigo, aviso, sucesso, info) têm variante própria por tema,
  dessaturada no escuro, e cada uma passa no contraste do tema em que está.
- Declare `color-scheme: light dark` para que controles nativos e barras de
  rolagem acompanhem o tema.
- Gráficos e imagens também trocam de tema: eixos, grades e séries usam tokens.
- Teste toda tela nos dois temas antes do PR.

## Acessibilidade

A meta é **WCAG 2.2 AA**, sem exceção para telas internas.

- **Contraste:** texto ≥ 4.5:1, texto grande (≥ 24px, ou ≥ 19px em 600) ≥ 3:1,
  bordas de controle, ícones informativos e foco ≥ 3:1. Vale nos **dois
  temas**.
- **Teclado:** tudo é operável só pelo teclado, em ordem lógica, sem armadilhas
  de foco. Diálogos prendem o foco enquanto abertos, fecham com `Esc` e
  devolvem o foco a quem os abriu.
- **Foco visível sempre:** `:focus-visible` com anel de ≥ 2px no token
  `--color-focus`. Nunca `outline: none` sem substituto.
- **HTML semântico antes de ARIA:** use `<button>` para ação, `<a>` para
  navegação, `<table>` com `<th scope>` para dados tabulares, e landmarks
  (`<header>`, `<nav>`, `<main>`). Use ARIA só para o que o HTML não expressa.
- **Formulários:** todo campo tem `<label>` visível (placeholder não é rótulo).
  Obrigatoriedade e erro são anunciados (`aria-invalid` + `aria-describedby`).
- **Conteúdo dinâmico:** a resposta nova do chat e as mudanças de estado de
  alerta são anunciadas por região `aria-live="polite"`. Use `assertive` só
  para falha crítica. O carregando tem `aria-busy`.
- **Alvos de toque** ≥ 24×24px (ideal 44×44px), com espaço entre alvos
  vizinhos.
- **Movimento:** respeite `prefers-reduced-motion`; animações ≤ 200ms e nunca
  essenciais para entender o estado. Nada pisca mais de 3 vezes por segundo,
  nem alerta crítico.
- **Zoom e texto:** funciona com 200% de zoom e com texto aumentado. Tamanhos de
  fonte em `rem`, nunca bloqueie o zoom no `viewport`.
- **Ícones:** ícone sozinho num botão exige `aria-label`. Ícone decorativo leva
  `aria-hidden="true"`.
- **Gráficos** (p50/p95, quebras por rota e modelo do `/stats`) têm alternativa
  em texto ou tabela com os mesmos números.
- **Idioma:** `<html lang="pt-BR">`. Datas e números são formatados com
  `Intl` em `pt-BR`. Horários mostram o fuso, pois incidentes cruzam fusos.

## Checklist do PR em `web/**`

- [ ] Só tokens: nenhum valor solto de cor, espaço, fonte ou raio
- [ ] Uma ação primária por seção; severidade com cor + ícone + texto
- [ ] Espaçamentos na escala de 4px; agrupamento por proximidade
- [ ] Estados carregando, vazio (real e por filtro), erro e com dados implementados
- [ ] Erros traduzidos, com próxima ação e `requestId`; entrada do usuário preservada
- [ ] Revisado nos temas claro e escuro, contraste AA nos dois
- [ ] Navegação completa por teclado, foco visível, rótulos e `aria-live` onde há mudança
- [ ] `prefers-reduced-motion` respeitado; funciona com 200% de zoom e em 360px

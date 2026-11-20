# Phase 0 Research: Persistência Real de Operações (SQLite)

Nenhum item ficou marcado `NEEDS CLARIFICATION` no Technical Context — as duas
decisões de maior impacto (remover o store Sequelize/MySQL; `Incident` usar status
`open|resolved` distinto de `Alert`) já foram confirmadas com o usuário antes deste
documento (ver plan.md, Constitution Check). O restante abaixo documenta as
decisões técnicas necessárias para fechar o design.

## 1. Acesso ao SQLite: `node:sqlite` (`DatabaseSync`)

**Decision**: usar o módulo nativo `node:sqlite` (API síncrona, `DatabaseSync`),
sem nenhum pacote npm de terceiros para SQLite.

**Rationale**: é exatamente o que a constitution v1.1.0 e o pedido do usuário
determinam — zero dependência nova no `package.json`, disponível sem flag desde
Node 22.13 (LTS "jod"); validado localmente em Node 24.16.0, onde
`require("node:sqlite").DatabaseSync` já funciona sem `--experimental-sqlite`.
A API é síncrona (sem Promises), o que é aceitável aqui porque todo o resto do
`OpsStore` já é `async` por contrato (mesma assinatura de método que o store
antigo) — a implementação SQLite apenas `await`-a valores já resolvidos
(`Promise.resolve(...)` implícito em uma função `async`), mantendo a interface
istêntica entre `SqliteOpsStore` e `MockOpsStore`.

**Alternatives considered**:
- `better-sqlite3` / `sqlite3` (pacotes npm): rejeitados — exigem binários
  nativos pré-compilados (dor de instalação em CI/Windows) e contradizem
  diretamente a constitution v1.1.0 ("sem dependência de terceiros para SQLite").
  `sqlite3` já está solto no `package.json` como dependência não usada — remover
  como parte desta feature.
- `sequelize` com dialeto `sqlite`: rejeitado — mantém uma camada ORM pesada e
  genérica (multi-dialeto) que a constitution já descartou; o volume/():complexidade
  de dados do OpsPilot não justifica um ORM.

## 2. Caminho do arquivo e criação do diretório `data/`

**Decision**: `createSqliteOpsStore(dbPath = process.env.OPSPILOT_DB ?? "./data/opspilot.db")`.
Quando `dbPath !== ":memory:"`, a store garante `mkdirSync(dirname(dbPath), { recursive: true })`
antes de abrir o `DatabaseSync` — `node:sqlite` não cria diretórios pais sozinho.
Caminho relativo é resolvido a partir do `cwd` do processo (mesmo padrão já usado
pelos scripts `npm run dev`/`arena`/`bench`, todos rodados da raiz do repo).

**Rationale**: satisfaz a spec ("arquivo configurável por variável de ambiente,
default em pasta de dados do projeto") sem exigir que quem sobe o processo crie a
pasta manualmente — consistente com FR-002 (preparar a estrutura automaticamente).

**Alternatives considered**: exigir que `data/` já exista (falhar se não existir) —
rejeitado, viola FR-002 e criaria um passo manual de setup que a spec
explicitamente quer evitar (SC-002).

## 3. Schema: DDL idempotente + `CHECK` em campo fechado

**Decision**: 4 tabelas (`services`, `alerts`, `incidents`, `runbooks`), criadas
com `CREATE TABLE IF NOT EXISTS` dentro do construtor da store (chamado sempre que
a store é instanciada, tanto para o arquivo real quanto para `:memory:`). Todo
campo de domínio fechado leva `CHECK (coluna IN (...))`: `services.tier`,
`alerts.severity`, `alerts.status`, `incidents.severity`, `incidents.status`.
Ver `data-model.md` para o DDL completo.

**Rationale**: `IF NOT EXISTS` é idempotente por construção (FR-002) — não precisa
de uma tabela de controle de migrations à parte, o que seria excesso de engenharia
para o escopo atual (constitution: Fluxo de Desenvolvimento não menciona
migrations; YAGNI). `CHECK` garante FR-005 (rejeitar valor fora do domínio) no
nível mais baixo possível — mesmo um bug futuro que pule a validação Zod na tool
não consegue gravar um valor inválido.

**Alternatives considered**: validar só no Zod da tool, sem `CHECK` no banco —
rejeitado; o pedido do usuário é explícito ("CHECK em todo campo de domínio
fechado") e é a defesa em profundidade certa para um dado que, uma vez gravado
errado, é muito mais caro de corrigir do que uma chamada de tool rejeitada.

## 4. Separar `Alert` (monitoramento) de `Incident` (ação do operador)

**Decision**: duas tabelas e dois conjuntos de status —
`alerts.status IN ('firing','resolved')` (linguagem de monitoramento, inalterada
em relação ao `list_alerts` já existente) e `incidents.status IN ('open','resolved')`
(linguagem de operador; `open_incident` agora grava `status='open'`, não mais
`'firing'`). `incidents` ganha `resolved_at TEXT` e `summary TEXT`, ambos
anuláveis — preenchidos por `resolveIncident`, que grava `resolved_at = now()` na
primeira resolução e é idempotente depois disso (não sobrescreve em chamadas
repetidas, mesma semântica do teste antigo "resolveIncident é idempotente").
`summary` fica reservado (sempre `null` por enquanto) — nenhuma tool nesta feature
expõe um parâmetro para preenchê-lo; é só a coluna existindo para uso futuro,
como a spec pede ("PODE registrar um resumo").

**Rationale**: confirmado com o usuário (ver plan.md) — a tool nova `list_incidents`
já foi pedida com vocabulário `open|resolved|all`, diferente do `firing|resolved`
de `list_alerts`; a leitura mais direta é que são dois conceitos operacionais
distintos (sinal automático × ação humana), o que também bate com a lista de 4
tabelas pedida (`alerts` E `incidents`, não uma só).

**Alternatives considered**: manter uma tabela única "incidents" (como hoje) e só
adicionar `resolved_at`/`summary`, com `list_incidents` sendo um alias de
`list_alerts` traduzindo `open`→`firing` na fronteira da tool — era a alternativa
levantada e explicitamente descartada pelo usuário em favor da separação real.

## 5. `OpsStore`: nova interface, dois backends

**Decision**: `src/store/ops-store.ts` define `OpsStore` (`listAlerts`,
`listIncidents`, `openIncident`, `resolveIncident`, `getRunbook`) e os tipos de
domínio. `SqliteOpsStore` (`src/store/sqlite-ops-store.ts`) e `MockOpsStore`
(`src/store/mock-ops-store.ts`, em memória) implementam a mesma interface.
Composição (`index.ts`, `arena.ts`) injeta `SqliteOpsStore`; testes de tools/
estratégia e `bench.ts` usam `MockOpsStore` — nunca tocam disco, então continuam
deterministicamente reproduzíveis execução após execução (FR-014/SC-006).

**Rationale**: é literalmente o pedido do usuário ("SqlliteOpsStore implementa a
interface OpsStore existente [...] mock in memory fica para testes e para o
bench"). Ter os dois atrás da mesma interface é o que permite trocar a
implementação por composição, sem tocar nas tools nem nas estratégias
(Constitution Princípio III).

**Alternatives considered**: `MockOpsStore` abrir a `SqliteOpsStore` com
`:memory:` em vez de ter uma implementação em memória "pura" separada — rejeitado
para o `bench`: os cenários do bench (`checkC1`/`C2`/`C3`) fazem `structuredClone`
do dataset a cada combinação cenário×estratégia para isolar mutações
(`bench.ts:224`); reabrir um `DatabaseSync(":memory:")` por combinação funcionaria,
mas adiciona I/O síncrono de banco a um loop que hoje é síncrono em memória, sem
necessidade. Testes de tools continuam preferindo um *fake* mínimo inline
(como já fazem em `tools.test.ts`) para os casos que não precisam de dado real —
`MockOpsStore` entra onde o teste precisa de um dataset completo e realista.

## 6. Prepared statements — sem SQL concatenado

**Decision**: toda leitura/escrita usa `db.prepare(sql)` com `?` posicionais,
nunca template string interpolando valores. Nomes de tabela/coluna, por serem
estáticos (nunca vêm de entrada do usuário), podem aparecer literalmente no SQL —
o que nunca é interpolado é *valor* de domínio (título, nome de serviço,
severidade, status, id).

**Rationale**: pedido explícito do usuário e alinhado à constitution (Princípio I,
validação na fronteira) — a superfície de risco de injeção de SQL nesta feature é
baixa (dados vêm de uma tool já validada por Zod), mas prepared statements são o
padrão mínimo esperado mesmo assim, sem custo adicional relevante.

**Alternatives considered**: nenhuma — não há um caso de uso aqui que precise de
SQL dinâmico (os filtros de `listAlerts`/`listIncidents` são um `WHERE status = ?`
opcional, resolvido em código com duas queries preparadas distintas — uma com
filtro, uma sem — em vez de montar a cláusula `WHERE` dinamicamente).

## 7. Descrições de tool: as "6 regras"

**Decision**: revisar as 5 tools (`list_alerts`, `list_incidents`, `open_incident`,
`resolve_incident`, `consultar_runbook`) contra este checklist:

1. A descrição diz, em uma frase, o que a tool faz.
2. A descrição diz explicitamente *quando* usá-la — inclusive o que a distingue de
   tools parecidas (em especial `list_alerts` × `list_incidents` ×
   `open_incident`, que são as mais fáceis de confundir).
3. Todo campo do `schema` Zod tem `.describe(...)` próprio.
4. Todo campo de valor fechado usa `z.enum([...])`, nunca `z.string()` livre.
5. Valor padrão (quando existe) é explícito no schema (`.default(...)`) e citado
   na descrição do campo.
6. A descrição é curta e não reusa a mesma frase-gatilho de outra tool, para não
   dar ambiguidade ao modelo na hora de escolher qual chamar.

**Rationale**: este checklist não está documentado em nenhum arquivo do repo
(procurado em `AGENTS.md` e no restante do projeto — nenhuma ocorrência); é
tratado aqui como a interpretação razoável de "boas práticas de descrição de tool
para tool-calling", aplicada de forma consistente às 5 tools. Se o curso/material
de referência do usuário tiver uma lista diferente, é um ajuste barato de revisar
depois — nenhuma das 6 regras acima contradiz o que a spec pede (FR-012).

**Alternatives considered**: N/A — item de estilo/consistência, não uma decisão
técnica com trade-off real.

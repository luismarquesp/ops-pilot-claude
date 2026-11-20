<!--
Sync Impact Report
- Version change: 1.0.0 → 1.1.0
- Principles: nenhum princípio removido ou redefinido de forma incompatível;
  Princípio III (Arquitetura em Camadas / MVC) teve sua referência de persistência
  atualizada de "Models representam o estado persistido (Sequelize/MySQL)" para
  SQLite nativo (node:sqlite / DatabaseSync), mantendo a mesma regra de camadas.
- Modified sections: Stack Tecnológica (troca de `sequelize` + `mysql2` por
  `node:sqlite`; remoção da dependência de terceiros `sqlite3`; nota sobre
  caminho do arquivo de banco, `:memory:` em testes, e DDL idempotente sem
  migrations externas por enquanto).
- Added sections: nenhuma
- Removed sections: nenhuma
- Templates a revisar:
  ✅ .specify/templates/plan-template.md — compatível (sem contradição com os princípios)
  ✅ .specify/templates/spec-template.md — compatível
  ✅ .specify/templates/tasks-template.md — compatível
  ⚠ AGENTS.md — fonte primária deste conteúdo; manter os dois em sincronia manualmente
- Specs existentes (001-reasoning-core, 002-reflection-layer, 003-chat-endpoint):
  não tratam de persistência de dados de domínio, não precisam de retrofit.
  Specs futuras que envolvam persistência DEVEM usar SQLite (node:sqlite).
- TODOs: nenhum
-->

# OpsPilot Constitution

OpsPilot é o copiloto de plantão que gerencia alertas e incidentes de produção.
A API é um agente LangChain/LangGraph rodando sobre OpenRouter.

## Core Principles

### I. Validação na Fronteira (Zod)
Toda entrada externa — HTTP (Express) ou CLI — DEVE ser validada com `zod` antes de
entrar na camada de serviço/domínio. Dados que atravessam a fronteira sem passar por um
schema `zod` são tratados como não confiáveis e NÃO DEVEM alcançar a lógica de negócio.
Rationale: em um copiloto que age sobre incidentes de produção, entrada malformada ou
inesperada tem alto custo de erro; validar na borda mantém o núcleo do domínio simples e
confiável.

### II. Test-First
Lógica nova NASCE com teste (`node:test` via `tsx`). Nenhuma mudança de comportamento é
aceita sem um teste que a exercite. `npm run typecheck` e `npm test` DEVEM estar sempre
verdes antes de qualquer commit.
Rationale: um agente autônomo que interage com produção precisa de uma rede de segurança
verificável; testes são a evidência de que o comportamento é o esperado.

### III. Arquitetura em Camadas (MVC)
O código segue as camadas padrão Model, Service, Controller. Controllers não contêm
regra de negócio; regra de negócio vive em Services; Models representam o estado
persistido via stores/repositórios que implementam interfaces de domínio sobre SQLite
(`node:sqlite`, `DatabaseSync`) — nenhuma camada além do Model fala SQL diretamente.
Rationale: separação de responsabilidades previsível facilita revisão, testes isolados e
substituição de partes do sistema sem efeito cascata.

### IV. Erros de Domínio como Classes na Borda
Erros de domínio são modelados como classes específicas e só são traduzidos (para HTTP
status, mensagens de CLI, etc.) na borda da aplicação (Controller). Services e Models NÃO
DEVEM formatar respostas de transporte.
Rationale: manter o erro semântico intacto até a borda permite tratamento e log
consistentes, e evita que detalhes de transporte vazem para o domínio.

### V. Funções Puras
Lógica de domínio e de serviço é escrita preferencialmente como funções puras (mesma
entrada → mesma saída, sem efeitos colaterais ocultos). Efeitos colaterais (I/O, chamadas
ao LLM, banco de dados) são isolados nas bordas da aplicação.
Rationale: funções puras são triviais de testar e de raciocinar sobre, essencial para um
agente que toma decisões automatizadas sobre incidentes.

### VI. Segredos Nunca Expostos
O arquivo `.env` NUNCA é commitado nem lido pelo agente (nem via ferramenta de leitura,
nem via terminal). Variáveis de ambiente são acessadas via a API nativa do Node
(`node:process`), sem uso de bibliotecas como `dotenv`. `.env.example` documenta as
chaves esperadas (`OPENROUTER_API_KEY`, `OPEN_ROUTER_MODEL`) sem valores reais.
Rationale: credenciais (chave da OpenRouter, credenciais de banco) nunca podem vazar para
histórico de commits, logs de agente ou contexto de LLM.

## Stack Tecnológica

- Node.js 22 LTS.
- TypeScript em modo ESM (`"type": "module"`), `strict: true`.
- `zod` para validação na fronteira (ver Princípio I).
- `@langchain/core`, `@langchain/langgraph`, `@langchain/openai` como base do agente,
  falando com modelos via OpenRouter.
- `express` como camada HTTP.
- `node:sqlite` (`DatabaseSync`) como camada de persistência — API nativa do Node
  22+, sem dependência de terceiros para SQLite (nada de `sqlite3`/`better-sqlite3`
  no `package.json`). O arquivo do banco fica em um caminho configurável por
  variável de ambiente (default em `./data/`); testes usam `:memory:`. O schema é
  criado por DDL idempotente executado pelo próprio store ao inicializar — não há
  ferramenta de migration externa por enquanto.
- Testes com o runner nativo `node:test`, executado via `tsx`.
- Ferramentas de dev: `typescript`, `tsx`, `@types/node`, `@types/express`.

## Fluxo de Desenvolvimento e Permissões

- O desenvolvimento de features segue o fluxo do Spec Kit, nesta ordem:
  `/speckit.specify` → `/speckit.plan` → `/speckit.task` → `/speckit.implement`.
- Specs DEVEM ser versionadas junto com o código.
- Comandos do projeto (`dev`, `arena`, `bench`, `test`, `typecheck`) são os definidos em
  `package.json` e não devem ser duplicados ou reinventados em outros scripts.
- As permissões do agente (allow/deny/ask sobre comandos de shell e leitura de arquivos)
  estão declaradas em `.claude/settings.json`. Em particular: `git push` exige aprovação
  manual (não está na allow list), e leitura de `.env` é sempre negada.
- `npm run typecheck` e `npm test` DEVEM passar antes de qualquer commit (ver Princípio
  II); isso é responsabilidade de quem propõe a mudança, não apenas de CI.

## Governance

Esta constituição tem precedência sobre qualquer outra prática ou preferência informal
do projeto, incluindo `AGENTS.md` (que serve como resumo operacional e deve permanecer
consistente com este documento, mas não o substitui em caso de conflito).

- Emendas a esta constituição são feitas via `/speckit.constitution` e exigem descrever a
  mudança, sua motivação e o impacto em templates/specs existentes (Sync Impact Report).
- Versionamento segue semver: MAJOR para remoção/redefinição incompatível de princípios,
  MINOR para adição de princípio ou seção, PATCH para clarificações e correções.
- Toda spec, plano e PR DEVE ser revisado quanto à conformidade com os princípios acima;
  complexidade que viole um princípio (ex.: pular validação Zod, pular testes) deve ser
  explicitamente justificada na spec/plan ou rejeitada.

**Version**: 1.1.0 | **Ratified**: 2026-09-07 | **Last Amended**: 2026-09-16

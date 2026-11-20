# Feature Specification: Publicação automática da war room

**Feature Branch**: `019-pages-deploy`

**Created**: 2026-11-20

**Status**: Draft

**Input**: User description: "Deploy do web/ no Pages via Actions: upload-pages-artifact + deploy-pages, permissions, README (atualizar)"

## Clarifications

### Session 2026-11-20

- Q: O site de projeto fica em `/<nome-do-repositório>/`, mas a war room foi feita
  com caminho fixo `/opspilot/` (specs/018, FR-017). Como conciliar? → A: o caminho
  de publicação passa a ser configurável no build. Sem configuração continua
  `/opspilot/`, e a publicação automática usa o caminho real do site.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Publicar a war room a cada mudança aprovada (Priority: P1)

O mantenedor junta uma mudança da war room na branch principal. Sem nenhum passo
manual, a versão nova fica disponível no endereço público do projeto. O
plantonista abre esse endereço e usa a war room normalmente.

**Why this priority**: hoje a war room só existe para quem a roda localmente ou
copia os arquivos para um servidor à mão. A publicação automática é o motivo da
feature.

**Independent Test**: fazer uma mudança visível na war room, levá-la à branch
principal e abrir o endereço público depois que a publicação terminar. A mudança
aparece, e a página e todos os recursos carregam sem erro.

**Acceptance Scenarios**:

1. **Given** uma mudança na war room chega à branch principal, **When** a
   publicação termina, **Then** o endereço público mostra a versão nova.
2. **Given** a war room publicada, **When** o plantonista abre o endereço público,
   **Then** a página e todos os recursos carregam sem erro, qualquer que seja o
   nome do repositório.
3. **Given** a war room publicada, **When** o plantonista recarrega a página ou
   abre um endereço desconhecido dentro do site, **Then** ele vê a war room, não
   uma página de erro do provedor.
4. **Given** uma mudança que só toca a API, **When** ela chega à branch principal,
   **Then** nenhuma publicação nova é disparada.

---

### User Story 2 - Nunca publicar uma versão quebrada (Priority: P1)

Antes de publicar, a versão nova passa pelas mesmas verificações que o
mantenedor roda localmente: checagem de tipos, testes e build. Se qualquer uma
falhar, a versão que está no ar continua lá.

**Why this priority**: uma war room quebrada no meio de um incidente é pior que
uma versão um pouco antiga. Essa garantia vale tanto quanto a publicação em si.

**Independent Test**: levar à branch principal uma mudança que quebra um teste da
war room. A publicação falha na etapa de verificação, o mantenedor vê qual
verificação falhou, e o endereço público segue com a versão anterior.

**Acceptance Scenarios**:

1. **Given** uma mudança que quebra a checagem de tipos, os testes ou o build,
   **When** a publicação roda, **Then** ela para antes de publicar e o site segue
   com a versão anterior.
2. **Given** duas mudanças chegam em sequência rápida, **When** as publicações
   rodam, **Then** a última mudança é a que fica no ar, e uma publicação em
   andamento não é interrompida no meio.

---

### User Story 3 - Publicar sob demanda e saber configurar (Priority: P2)

O mantenedor pode disparar a publicação à mão, por exemplo depois de mudar o
endereço padrão da API. O README explica como ativar a publicação no repositório,
onde fica o endereço público, como apontar a war room para a API e o que
liberar em `CORS_ORIGINS`.

**Why this priority**: sem instruções, a primeira publicação falha por falta de
configuração do repositório, e a war room publicada não conversa com nenhuma API.

**Independent Test**: seguir só o README num repositório novo, do zero até a war
room publicada conversando com uma API. Nenhum passo fica faltando.

**Acceptance Scenarios**:

1. **Given** o mantenedor dispara a publicação à mão, **When** ela termina,
   **Then** o site mostra a versão atual da branch principal.
2. **Given** um endereço padrão da API configurado no repositório, **When** a
   publicação roda, **Then** a war room publicada já abre apontando para ele.
3. **Given** nenhum endereço padrão configurado, **When** o plantonista abre a war
   room publicada, **Then** a ⚙ Configurações e o "Testar conexão" o guiam até
   informar o endereço da API.
4. **Given** o README atualizado, **When** o mantenedor o lê, **Then** encontra o
   endereço público, os passos de ativação, o endereço padrão da API e a origem
   exata a incluir em `CORS_ORIGINS`.

### Edge Cases

- **Publicação não ativada no repositório**: a primeira execução falha com uma
  mensagem que aponta para o passo do README.
- **Repositório com outro nome ou com domínio próprio**: o caminho de publicação
  segue o endereço real do site, sem mudar o código.
- **Endereço padrão da API inválido**: o build falha na verificação, em vez de
  publicar uma war room que não conecta.
- **API em `http://` com site em `https://`**: o navegador pode bloquear a
  chamada. O README avisa que a API publicada precisa de `https://`; `localhost`
  costuma ser aceito pelos navegadores, mas não por todos.
- **Origem não autorizada**: com o site no ar e a API sem a origem em
  `CORS_ORIGINS`, o "Testar conexão" mostra "origem não autorizada" e o nome
  exato da origem (comportamento do specs/018).
- **Credenciais**: a publicação não usa nem expõe segredos. O endereço padrão da
  API não é segredo e fica visível no site publicado.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A war room MUST ser publicada automaticamente quando uma mudança em
  `web/` ou na própria definição da publicação chegar à branch principal.
- **FR-002**: O mantenedor MUST poder disparar a publicação manualmente.
- **FR-003**: Mudanças que não tocam a war room nem a definição da publicação
  MUST NOT disparar publicação.
- **FR-004**: Antes de publicar, a publicação MUST rodar a checagem de tipos, os
  testes e o build da war room. Qualquer falha MUST interromper a publicação e
  manter a versão que está no ar.
- **FR-005**: O caminho de publicação da war room MUST ser configurável no build.
  Sem configuração MUST continuar `/opspilot/` (specs/018 FR-017). A publicação
  automática MUST usar o caminho real do site.
- **FR-006**: No site publicado, recarregar a página ou abrir um caminho
  desconhecido dentro dele MUST mostrar a war room.
- **FR-007**: O endereço padrão da API da versão publicada MUST poder ser
  definido como configuração do repositório, sem mudar o código. Sem ele, vale a
  regra do specs/018: o plantonista informa o endereço na ⚙.
- **FR-008**: A publicação MUST pedir só as permissões mínimas: ler o código,
  publicar o site e provar a própria identidade ao provedor. Nenhuma outra.
- **FR-009**: Publicações MUST NOT rodar em paralelo. A mais recente MUST
  prevalecer, e uma publicação em andamento MUST NOT ser cancelada no meio.
- **FR-010**: A publicação MUST informar o endereço público ao terminar.
- **FR-011**: A publicação MUST NOT usar segredos nem publicar nada além do
  resultado do build da war room.
- **FR-012**: O README da war room MUST ser atualizado com: ativação da
  publicação no repositório, endereço público, endereço padrão da API, a origem a
  incluir em `CORS_ORIGINS`, o aviso de `https://` e como rodar a publicação à
  mão. O README MUST deixar de citar um `web/.env.example` inexistente, ou o
  arquivo MUST passar a existir.
- **FR-013**: A API e o `npm test`/`npm run typecheck` da raiz MUST seguir
  inalterados.

### Key Entities

- **Publicação**: uma execução que verifica, gera e põe no ar uma versão da war
  room. Tem origem (mudança na branch principal ou disparo manual), resultado
  (publicada ou falhou em qual etapa) e endereço público.
- **Configuração de publicação**: caminho de publicação e endereço padrão da API.
  Nenhum dos dois é segredo.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Uma mudança na war room fica disponível no endereço público em até
  10 minutos depois de chegar à branch principal, sem nenhum passo manual.
- **SC-002**: 100% das mudanças que quebram tipos, testes ou build deixam de ser
  publicadas, e o site segue com a versão anterior.
- **SC-003**: No site publicado, a página e todos os recursos carregam sem erro,
  inclusive depois de recarregar e em caminhos desconhecidos.
- **SC-004**: Um mantenedor que nunca publicou a war room chega ao site no ar
  conversando com uma API seguindo só o README.
- **SC-005**: Mudanças só na API disparam zero publicações.

## Assumptions

- O repositório fica no GitHub, e o provedor de páginas estáticas é o GitHub
  Pages, publicado a partir de uma execução automática (não de uma branch).
- A branch principal é `main`. Hoje o trabalho local está em `master`, sem
  remoto configurado; publicar exige empurrar para `main` (fora do escopo).
- A API não é publicada por esta feature. A war room publicada conversa com uma
  API hospedada em outro lugar, ou com uma API local durante testes.
- A ativação do Pages no repositório (fonte "GitHub Actions") é um passo manual
  único, documentado no README.
- O endereço padrão da API, quando usado, é uma variável do repositório (não um
  segredo), porque fica visível no site publicado de qualquer forma.
- A Node usada na publicação é a mesma da war room (Node 22 LTS).
- O `web/.env` local nunca é lido nem usado pela publicação.

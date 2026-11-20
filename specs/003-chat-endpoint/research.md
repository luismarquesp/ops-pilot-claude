# Research: Endpoint HTTP de Chat sobre o Núcleo de Raciocínio

A stack já está fixada (Express, Zod, `ReasoningStrategy`, `withReflection`) — o
Technical Context do `plan.md` não deixou nenhum `NEEDS CLARIFICATION`. As decisões
abaixo cobrem *como* montar o endpoint sobre o que já existe.

## 1. Timeout de 180s sem cancelamento real da execução

**Decision**: usar `Promise.race([strategy.run(input), timeout(180_000)])`. Se o
timeout vencer, a resposta 504 é enviada imediatamente; a promise da estratégia
continua rodando em segundo plano e seu resultado (ou erro) é apenas descartado
(`.catch(() => {})` para nunca virar uma rejeição não tratada do processo).

**Rationale**: nenhuma das estratégias hoje (`react`, `plan-and-execute`, e por
extensão `withReflection`) aceita um `AbortSignal` ou qualquer mecanismo de
cancelamento — adicionar isso exigiria mudar o contrato `ReasoningStrategy` já
estabelecido em specs/001, o que está fora do escopo desta feature (que é expor o
núcleo existente, não modificá-lo). "Descartar o resultado tardio" é exatamente o
comportamento que a spec já assume (Assumptions: "o resultado tardio é descartado").

**Alternatives considered**: estender `ReasoningStrategy.run` para aceitar um
`AbortSignal` — rejeitado por alterar um contrato já implementado e testado em duas
features anteriores, por um ganho (economizar computação após o timeout) que a spec
não pede.

## 2. Registro como fábrica parametrizada, não singleton

**Decision**: `src/agents/index.ts` exporta uma função `createStrategyRegistry(tools)
=> Map<string, ReasoningStrategy>`, não um objeto global pré-construído. O bootstrap
real (`src/index.ts`) chama essa função uma vez, com as tools construídas a partir do
store JSON. O teste de integração constrói seu próprio registro (um `Map` com uma
única estratégia falsa), sem passar por `createStrategyRegistry` nem por tools reais.

**Rationale**: mesma razão de design já usada nas tools/estratégias de specs/001
(`createOpsTools(store)`, `createReactStrategy(tools)`) — fábricas parametrizadas são
o que torna o Controller testável sem LLM real. Um registro singleton construído no
módulo (`export const registry = ...`) acopla `src/http/server.ts` a uma inicialização
de rede/LLM só para importar o arquivo, o que quebraria o teste determinístico
exigido por FR-010.

**Alternatives considered**: registro global montado no próprio `server.ts` — rejeitado
por misturar a responsabilidade de "resolver e rodar uma estratégia" (Controller) com
a de "saber montar as estratégias reais" (bootstrap), o que impediria testar o
Controller isoladamente.

## 3. Como testar o endpoint sem novas dependências

**Decision**: `createApp(registry, opts?)` retorna um `express.Express` comum. O
teste de integração faz `app.listen(0)` (porta efêmera, o SO escolhe uma livre),
lê a porta atribuída, faz requisições com o `fetch` global do Node (disponível desde
o Node 18, sem dependência extra) para `http://127.0.0.1:<porta>/chat`, e fecha o
servidor (`server.close()`) ao final de cada teste.

**Rationale**: evita adicionar `supertest` (ou equivalente) só para este teste,
mantendo a política do projeto de não introduzir dependências sem necessidade clara.
Subir um servidor real numa porta efêmera é rápido (milissegundos) e testa o mesmo
caminho de código que roda em produção (parsing HTTP real, não uma simulação).

**Alternatives considered**: `supertest` — rejeitado por ser uma dependência nova
para um ganho pequeno (ergonomia de asserções HTTP) que `fetch` + `assert` já cobre
bem o suficiente para os quatro casos desta feature (200/400/422/504).

## 4. Mapeamento de respostas de erro

**Decision**:
- Corpo inválido (Zod `safeParse` falha) → **400**, corpo `{ issues: result.error.issues }`
  (os `issues` do próprio Zod, sem reformatação — FR-005).
- Estratégia informada não existe no registro → **422**, corpo indicando a estratégia
  pedida e as disponíveis (FR-006). Checado **antes** de aplicar `withReflection`
  (edge case da spec: reflect + estratégia inexistente não deve tentar refletir nada).
- Execução não termina em 180s → **504**, corpo indicando tempo esgotado (FR-007).
- Qualquer outro erro inesperado (ex.: uma estratégia lança algo fora do contrato
  "nunca lança" já estabelecido, ou uma falha de infraestrutura) → **500** genérico.
  Isso não está pedido explicitamente na spec (que só define os 4 casos acima), mas é
  necessário para nunca deixar uma exceção não tratada travar a resposta HTTP — o
  Express 5 já encaminha automaticamente erros de handlers `async` para o middleware
  de erro, então isso é uma rede de segurança pequena, não uma feature nova.

**Rationale**: os quatro primeiros casos vêm diretamente das FR-005/006/007 e do
contrato de sucesso (FR-004); o 500 genérico é a extensão mínima necessária para o
Controller nunca "vazar" uma exceção crua para o cliente.

**Alternatives considered**: deixar erros inesperados sem tratamento (a requisição
travaria sem resposta) — rejeitado por contradizer o espírito geral de "toda falha
tem uma resposta clara" que motiva a User Story 3.

## 5. `src/index.ts` como bootstrap real do servidor

**Decision**: `src/index.ts` (vazio desde o esqueleto inicial do projeto) passa a:
montar o store JSON (`createJsonIncidentsStore` sobre `seed-data.json`), as tools, o
registro de estratégias (`createStrategyRegistry`), o app (`createApp`), e chamar
`app.listen(process.env.PORT ?? 3000)`.

**Rationale**: é o mesmo padrão de bootstrap já usado em `arena.ts`/`bench.ts`
(montar dependências reais e injetá-las), e finalmente dá um propósito real ao
`npm run dev`, que hoje só executa um arquivo vazio.

**Alternatives considered**: colocar o bootstrap dentro do próprio
`src/http/server.ts` — rejeitado porque misturaria "definir o app" (testável, sem
efeitos colaterais de montagem) com "montar as dependências reais e escutar uma
porta" (só faz sentido em runtime real), repetindo o mesmo motivo da decisão #2.

---

**Output**: todas as decisões técnicas relevantes ao design foram resolvidas acima;
nenhum `NEEDS CLARIFICATION` permanece no Technical Context de `plan.md`.

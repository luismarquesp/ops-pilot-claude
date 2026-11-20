# Research: Camada de Reflexão sobre Estratégias de Raciocínio

A stack já está fixada pela constitution e pela 001 (`ReasoningStrategy`, `createModel`,
Zod) — o Technical Context do `plan.md` não deixou nenhum `NEEDS CLARIFICATION`. As
decisões abaixo cobrem *como* implementar o ciclo de reflexão sobre o contrato já
existente, e resolvem as ambiguidades registradas como Assumptions em `spec.md`.

## 1. Tornar o loop de reflexão testável sem rede

**Decision**: `withReflection(strategy, opts)` recebe a estratégia de base como
argumento (já é assim, por contrato) e aceita um **crítico injetável** em
`opts.critic` — uma função `(question, answer, observations) => Promise<CriticVerdict>`.
Quando `opts.critic` não é informado, um crítico padrão baseado em `createModel()` é
usado (comportamento real, com LLM). Os testes do loop de reflexão fornecem tanto uma
estratégia de base falsa (um objeto `ReasoningStrategy` simples, sem LLM, que devolve
respostas pré-definidas) quanto um crítico falso (que devolve vereditos pré-definidos),
exercitando o controle de rodadas/corte 100% em memória.

**Rationale**: o contrato `ReasoningStrategy` já é uma interface (não uma classe
concreta), então "estratégia de base falsa" é trivial de construir sem nenhuma
mudança de design. Tornar o crítico igualmente injetável é o que permite testar
determinísticamente a lógica de negócio real desta feature — quantas rodadas rodam,
quando param, como o feedback é incorporado — sem depender de um LLM real, coisa que a
001 não conseguia fazer para `react`/`plan-and-execute` (só validável manualmente via
quickstart). Esta feature tem uma superfície de teste melhor que a anterior exatamente
por decorar, e não reimplementar, o raciocínio em si.

**Alternatives considered**: testar `withReflection` apenas manualmente (como
`react.ts`/`plan-and-execute.ts` na 001) — rejeitado porque a lógica de controle do
loop (rodadas, corte, encerramento) é justamente o tipo de regra determinística que a
constitution (Princípio II, Test-First) exige nascer com teste; não teria justificativa
para deixá-la sem cobertura automática quando é perfeitamente isolável.

## 2. Como o feedback do crítico chega na próxima tentativa

**Decision**: sem estender o contrato `StrategyInput` (que teria efeito colateral sobre
`react.ts`/`plan-and-execute.ts`), o feedback é incorporado **dentro do próprio texto
da pergunta** enviada na reexecução: a pergunta original é combinada com a resposta
rejeitada e a justificativa do crítico, pedindo explicitamente uma nova resposta que
resolva a crítica.

**Rationale**: FR-001 exige que `withReflection` não altere o comportamento da
estratégia decorada — a única superfície de entrada que toda `ReasoningStrategy` já
aceita é `StrategyInput.question`. Reusar esse único canal mantém o decorador
genérico para qualquer estratégia atual ou futura que siga o contrato, sem exigir que
cada estratégia saiba lidar com um campo novo de "feedback anterior".

**Alternatives considered**: estender `StrategyInput` com um campo opcional
`priorFeedback` — rejeitado por exigir que toda estratégia existente (e futura) saiba
interpretá-lo para ter algum efeito, o que na prática as obrigaria a mudar; incorporar
o feedback só no rastro (sem reenviar ao modelo) — rejeitado porque não influenciaria
de fato a nova geração, esvaziando o propósito da reflexão.

## 3. Contagem exata de rodadas e resposta retornada no limite

**Decision**: `maxReflection` (padrão 2) conta **rodadas de crítica**, não gerações.
Uma execução com reflexão sempre gera pelo menos 1 resposta; a cada rodada permitida, o
crítico avalia a última resposta gerada e, se reprovar, uma nova geração acontece. Ao
todo, uma execução com `maxReflection = N` produz no máximo `N + 1` gerações e exatamente
`N` avaliações do crítico (menos se aprovar antes). Quando a rodada `N` reprova, a
`(N + 1)`-ésima geração é produzida mas **não** é mais avaliada — ela é retornada como
resultado final (FR-006), já que o orçamento de crítica acabou.

**Rationale**: essa contagem casa exatamente com a redação do pedido original
("regenera com o feedback; para em approved ou maxReflection") e com FR-006
("retorna a resposta mais recentemente gerada") — se a última rodada de crítica ainda
gerasse uma nova resposta E a avaliasse, o teto nunca teria efeito prático (sempre
haveria "mais uma" crítica pendente).

**Alternatives considered**: contar `maxReflection` como número de gerações totais
(incluindo a primeira) — rejeitado porque com o padrão 2 isso permitiria só 1 rodada
real de crítica+regeneração, o que parece baixo demais para o valor default pedido.

## 4. `maxReflection = 0` e falha do próprio crítico

**Decision**: `maxReflection = 0` é válido e significa "nenhuma rodada de crítica
ocorre" — `withReflection` se comporta como um passthrough para a estratégia de base
(só muda o `name` reportado, para `reflect:<nome original>`). Se a própria chamada ao
crítico falhar (exceção inesperada), o erro é capturado dentro do `run()`, um evento
`critique` registra que a avaliação falhou, e a execução encerra com a última resposta
válida já gerada — nunca propaga a exceção para fora do contrato `ReasoningStrategy`
(mesma regra de "nunca lança" já estabelecida na 001 para falhas de tool).

**Rationale**: manter `run()` livre de exceções não tratadas é uma invariante do
contrato já estabelecida (`contracts/reasoning-strategy.md` da 001); uma falha no
crítico é conceitualmente equivalente a uma falha de ferramenta — não deve derrubar a
execução, só limitar o que a reflexão consegue garantir naquela rodada.

**Alternatives considered**: propagar a exceção do crítico para quem chamou
`withReflection(...).run()` — rejeitado por violar a invariante "nunca lança" que toda
`ReasoningStrategy` já garante, obrigando `arena.ts` a lidar com dois modos de falha
diferentes dependendo da estratégia escolhida.

## 5. Observações usadas pelo crítico

**Decision**: o crítico recebe apenas o conteúdo dos eventos do tipo `observation` do
rastro daquela execução (na ordem em que ocorreram), junto da pergunta original e da
resposta gerada — não o rastro completo (pensamentos/ações também incluídos seriam
ruído para o julgamento de "a resposta bate com o que foi observado?").

**Rationale**: `observation` é exatamente o tipo de evento que registra o que as tools
de fato retornaram (contracts/tools.md da 001) — é a fonte de verdade contra a qual a
resposta deve ser conferida, conforme a própria redação do pedido ("avalia a resposta
contra as observações do trace").

**Alternatives considered**: enviar o rastro completo ao crítico — rejeitado por
aumentar o tamanho do prompt sem melhorar a qualidade do julgamento, já que
pensamentos/planos não são fatos verificáveis.

---

**Output**: todas as decisões técnicas relevantes ao design foram resolvidas acima;
nenhum `NEEDS CLARIFICATION` permanece no Technical Context de `plan.md`.

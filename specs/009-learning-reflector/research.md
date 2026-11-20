# Research: Refletor de Aprendizado

Fase 0 do plano. Cada seção fecha uma decisão com a justificativa e as
alternativas descartadas.

## §1 — Extrator com saída estruturada

- **Decision**: `src/memory/learning.ts` define o tipo injetável
  `LearningExtractor = (message: string) => Promise<LearningVerdict>`, com
  `LearningVerdict = { hasLearning: boolean; fact?: string }`. O extrator padrão é
  `createModel().withStructuredOutput(learningSchema).invoke([system, user])`, o
  mesmo padrão do `defaultCritic` em `src/agents/reflection.ts`. O schema zod usa
  `hasLearning: z.boolean()` e `fact: z.string().optional().describe(...)`.
- **Rationale**: é o que o usuário pediu (`withStructuredOutput({ hasLearning, fact })`)
  e reaproveita o modelo configurado (OpenRouter, temperatura 0). O tipo
  injetável permite testar sem rede com um extrator fake (FR-013), como já é feito
  com `ReflectionOptions.critic`.
- **Alternatives considered**: um extrator por regras/regex (não entende
  linguagem natural, e o FR-005 exige julgamento); pedir ao próprio agente que
  termine a resposta com um bloco "aprendizado" (mistura responsabilidades e
  atrasa a resposta).

## §2 — Prompt do extrator

- **Decision**: um system prompt fixo, `LEARNING_PROMPT`, em português, que:
  1. Olha **só** a mensagem do plantonista (FR-010). O user prompt contém
     apenas `Mensagem do plantonista: <texto>`.
  2. Aceita como aprendizado só fatos **duradouros sobre a pessoa**: papel,
     time, serviços pelos quais responde, preferências de formato/idioma de
     resposta e rotinas de plantão.
  3. Rejeita explicitamente pedidos pontuais ("abre/fecha/lista…"), estado de
     alertas/incidentes, informação só da conversa atual e **qualquer**
     credencial. Mensagens que contêm uma credencial resultam em
     `hasLearning: false` inteiro (US2, cenário 2).
  4. Quando a mensagem tem vários fatos, devolve **um**, o mais relevante,
     numa frase curta e autocontida em terceira pessoa ("O plantonista é
     responsável pelo checkout"), no idioma da mensagem.
  5. Traz 4 exemplos curtos (fato, pedido, misto, segredo).
- **Rationale**: a mensagem isolada reduz custo e evita "aprender" o que o
  OpsPilot disse. A terceira pessoa deixa o fato legível quando reinjetado no
  prompt. Os exemplos são o jeito mais barato de calibrar a fronteira entre
  pedido e fato.
- **Alternatives considered**: mandar o histórico junto (mais contexto, mas viola
  FR-010 e aumenta o custo); devolver uma lista de fatos (a spec fixa no
  máximo 1 por turno).

## §3 — Segunda barreira contra segredos (FR-007)

- **Decision**: função pura `containsSecret(text): boolean` em
  `src/memory/secrets.ts`, com uma lista de regex conservadora:
  - Pares chave/valor: `(senha|password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|client[_-]?secret)\s*[:=]\s*\S+` (case-insensitive).
  - URLs com credencial: `[a-z][a-z0-9+.-]*://[^\s/:@]+:[^\s/@]+@`.
  - Blocos PEM: `-----BEGIN [A-Z ]*PRIVATE KEY-----`.
  - Formatos conhecidos de token: `sk-[A-Za-z0-9_-]{16,}` (OpenAI/OpenRouter),
    `gh[pousr]_[A-Za-z0-9]{20,}`, `AKIA[0-9A-Z]{16}`, `xox[baprs]-[A-Za-z0-9-]{10,}`,
    `eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.` (JWT).
  - Strings longas de alta entropia: qualquer "palavra" de 32 caracteres ou
    mais, sem espaço, que misture letras e dígitos.

  Ela é aplicada ao **fato proposto** em `toLearnableFact` (§4). Adicionalmente,
  quando a **mensagem original** contém segredo, o extrator nem é chamado
  (economiza a chamada e garante o US2-2 mesmo se o modelo errar).
- **Rationale**: é defesa em profundidade independente do LLM (FR-007). O viés
  conservador é aceito pela spec (Assumptions). Pular o extrator nesse caso
  também evita mandar o segredo ao provedor uma segunda vez.
- **Alternatives considered**: uma biblioteca de detecção de segredos (nova
  dependência, overkill para o volume); confiar só no prompt (viola FR-007).

## §4 — Pipeline do aprendizado (puro + efeitos na borda)

- **Decision**:
  - `toLearnableFact(verdict): string | undefined` é **pura**: `hasLearning`
    falso → `undefined`; `fact` ausente ou só espaços → `undefined`; `trim()`;
    mais de 500 caracteres → `undefined`; `containsSecret` → `undefined`.
  - `learnFromMessage({ userId, message }, { memory, extractor, log })` →
    `Promise<LearningOutcome>`, onde `LearningOutcome` é
    `"skipped_secret" | "nothing" | "rejected" | "learned" | "duplicate" | "failed"`.
    Ela **nunca rejeita**: qualquer erro do extrator ou da memória vira
    `"failed"` + `log`.
- **Rationale**: a decisão (o que é aprendível) fica pura e fácil de testar
  exaustivamente. A função com efeitos devolve um resultado observável para os
  testes e nunca derruba o processo, porque roda sem `await` (§5).

## §5 — Execução assíncrona (fire-and-forget)

- **Decision**: `ChatDeps` ganha `learn?: (input: { userId: string; message: string }) => Promise<unknown>`.
  No `runChat`, **depois** de gravar pergunta + resposta e só quando há
  `userId` e `learn`: `void learn({ userId, message }).catch(() => {})`, sem
  `await`. O `catch` vazio é só um cinto de segurança contra
  `unhandledRejection`, porque `learnFromMessage` já não rejeita. O
  Controller recebe `learn` em `AppDeps` e o repassa. Em `src/index.ts`,
  `learn = (input) => learnFromMessage(input, { memory, extractor: defaultLearningExtractor, log: logLearningFailure })`.
- **Rationale**: a resposta nunca espera o aprendizado (FR-004/SC-004), e o
  teto de 180 s e as métricas não mudam. Turnos que falham não chegam a esse
  ponto (FR-009). Com a injeção, o teste usa um `learn` que nunca resolve para
  provar que a resposta não espera, e outro que captura a promise para
  verificar o que foi aprendido.
- **Alternatives considered**: `setImmediate`/`queueMicrotask` (mesma coisa, só
  menos explícito); uma fila em memória com worker (complexidade sem ganho, já
  que não há durabilidade — Assumptions); `await` com timeout curto (ainda
  atrasaria a resposta).

## §6 — Log sem conteúdo (FR-008)

- **Decision**: `logLearningFailure(error)` faz
  `console.warn("[learning] falha ao aprender:", error instanceof Error ? error.name : typeof error)`.
  Só o **nome** do erro é logado, nunca `message`, `userId` ou o texto.
- **Rationale**: mensagens de erro de parse do zod ou do provedor podem ecoar o
  conteúdo gerado, que por sua vez pode ecoar a mensagem do usuário. O nome da
  classe basta para diagnosticar (rede, parse, SQLite).
- **Alternatives considered**: logar `message` truncada (ainda pode vazar
  conteúdo).

## §7 — `forget_preference` substitui `forget_fact` (FR-011/FR-012)

- **Decision**: em `src/memory/memory-tools.ts`, `forget_fact` sai e entra
  `forget_preference { description: string (trim, 1..500) }`. A lógica fica em
  `forgetPreference(memory, userId, description)` (exportada para testes):
  `recall(userId, description, 1)`. Se vier um fato (score ≥ 0,3), chama
  `forget(userId, id)` e devolve `{ forgotten: true, fact }`; senão, devolve
  `{ forgotten: false }`. O `formatQuestionWithMemory` deixa de mostrar `[id]` e
  lista só `- <fato>`. `MemoryStore.forget(userId, id)` continua como está.
- **Rationale**: é a decisão da spec (opção A). Reaproveitar `recall` com
  `k = 1` dá "o mais parecido, se suficientemente parecido" sem regra nova, e
  mantém o isolamento por usuário (o `userId` fica na closure).
- **Alternatives considered**: um limiar próprio, mais alto, para esquecer (mais
  seguro contra apagar o fato errado, mas a spec fixou 0,3; fica como ajuste
  futuro); esquecer **todos** os fatos acima do limiar (arriscado demais).
- **Impacto na 008**: `memory-prompt.test.ts`, `memory-tools.test.ts`,
  `chat-service.test.ts` e `server.test.ts`, que verificam `[id]` no prompt ou
  usam `forget_fact`, precisam ser atualizados. `contracts/memory-tools.md` da 008
  fica superado pelo desta feature.

## §8 — Medição de qualidade (SC-001/SC-002/SC-003)

- **Decision**: um script de avaliação fora do `npm test`,
  `src/memory/learning-eval.ts`, roda o **extrator real** sobre três conjuntos
  fixos (≈10 fatos duradouros, ≈10 pedidos pontuais, ≈6 mensagens com segredo) e
  imprime as taxas contra as metas: ≥ 90%, ≤ 5% e 0%. Execução:
  `node --env-file-if-exists=.env --import tsx src/memory/learning-eval.ts`
  (mesmo padrão dos scripts `arena`/`bench`, sem novo script no `package.json`).
  No conjunto de segredos, a meta de 0% vale para o **pipeline completo**
  (`learnFromMessage` com memória em `:memory:`), não só para o extrator.
- **Rationale**: as metas percentuais dependem do LLM e não cabem num teste
  determinístico. Um eval manual e reproduzível é o suficiente para essa escala.
- **Resultado (implementação, 2026-09-30) — INCONCLUSIVO**: o modelo configurado
  (tier gratuito da OpenRouter) devolveu `RateLimitCapacityError`/429 na maior
  parte das chamadas, mesmo com 6 s entre elas. Parcial:
  - **Segredos**: 6/6 `skipped_secret`, ou seja, 0% aprendido, garantido pela
    barreira determinística antes do LLM.
  - **Fatos**: 7 de 8 chamadas sem erro aprenderam. A exceção (#3) voltou com
    `hasLearning: true` **sem `fact`**, então o campo passou a ser obrigatório
    no schema (string vazia quando não há aprendizado).
  - **Pedidos**: 2 de 2 chamadas sem erro devolveram `nothing`.

  O eval passou a espaçar as chamadas (`OPSPILOT_EVAL_DELAY_MS`), a logar só o
  nome do erro e a sair com código 1 (inconclusivo) se houver `failed`. É preciso
  reexecutar com um modelo sem esse limite para fechar SC-001/SC-003.
- **Alternatives considered**: integrar ao `bench` (o bench mede estratégias, não
  memória); rodar no `npm test` (depende de rede e credenciais).

## §9 — Testes determinísticos

- **Decision**:
  1. `secrets.test.ts`: um positivo por padrão da §3 e negativos plausíveis
     ("sou do time de pagamentos", "o token de deploy fica no vault" sem
     valor, um UUID, um hash curto de commit).
  2. `learning.test.ts`: casos de `toLearnableFact` (tabela) e de
     `learnFromMessage` com extrator fake + `SqliteMemoryStore(":memory:")` +
     fake embedder, cobrindo cada `LearningOutcome`. Mensagem com segredo →
     extrator **não** chamado. Erro do extrator/memória → `"failed"` + `log`
     com o nome do erro e sem o texto.
  3. `chat-service.test.ts`:
     - com `learn` que nunca resolve, `runChat` resolve normalmente;
     - `learn` é chamado uma vez com `{ userId, message }` após o sucesso;
     - não é chamado sem `userId`, em timeout nem com estratégia que lança erro;
     - `learn` que rejeita não gera `unhandledRejection`.
  4. `memory-tools.test.ts`: `forget_preference` esquece o fato mais parecido,
     devolve `forgotten: false` abaixo do limiar, não toca fatos de outro
     usuário, e `forget_fact` não existe mais.
  5. `server.test.ts`: `AppDeps.learn` é chamado com o `userId` da requisição.

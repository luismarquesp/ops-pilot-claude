# Research: Memória Semântica por Usuário

Fase 0 do plano. Cada seção fecha uma decisão com a justificativa e as
alternativas descartadas.

## §1 — Modelo de embeddings e biblioteca

- **Decision**: `@huggingface/transformers` (Transformers.js v3), pipeline
  `feature-extraction` com o modelo `Xenova/all-MiniLM-L6-v2` (ONNX, 384
  dimensões), `dtype: "fp32"`, chamado com `{ pooling: "mean", normalize: true }`.
- **Rationale**: pedido explícito do usuário. Roda 100% local em Node via
  `onnxruntime-node` (FR-012 — nenhum fato vai para serviço externo). O `mean
  pooling` é o pooling com que o all-MiniLM-L6-v2 foi treinado, e `normalize: true`
  entrega vetores unitários, então produto escalar = cosseno (§4). O repositório
  `Xenova/…` traz os pesos ONNX prontos para Transformers.js. `fp32` evita
  variação numérica da quantização perto dos limiares 0,3/0,92.
- **Alternatives considered**: embeddings via OpenRouter/API (envia o fato para
  fora, viola FR-012 e depende de rede); `fastembed`/Python sidecar (outro runtime);
  modelo multilíngue (`paraphrase-multilingual-MiniLM-L12-v2`) — melhor para
  português, mas o usuário fixou o all-MiniLM-L6-v2; fica como evolução.
- **Nota de stack**: é a primeira dependência de terceiros de ML do projeto.
  A constituição proíbe dependência de terceiros **para SQLite**, não para
  embeddings, então não há violação. Mesmo assim, fica registrado em Complexity
  Tracking por trazer um binário nativo (`onnxruntime-node`) e um download de
  modelo (~90 MB em fp32) no primeiro uso.

## §2 — Singleton preguiçoso do embedder

- **Decision**: `src/memory/embeddings.ts` exporta a interface
  `Embedder { embed(text): Promise<Float32Array> }` e
  `createLocalEmbedder(): Embedder`. O pipeline fica em uma `Promise` guardada no
  escopo do módulo (`let pipelinePromise: Promise<…> | undefined`), criada só na
  primeira chamada de `embed`. Chamadas concorrentes aguardam a mesma promise. Se o
  carregamento falhar, a promise é descartada, para a próxima chamada tentar de novo.
- **Rationale**: o carregamento custa de segundos (cache) a dezenas de segundos
  (download), e não deve atrasar o boot da API, `arena`, `bench` nem os testes que
  não usam o modelo real (edge case "primeira utilização"). Guardar a *promise*, não
  o resultado, evita dois carregamentos em paralelo. O import de
  `@huggingface/transformers` é dinâmico (`await import(...)`), para que só carregar
  o módulo não puxe o `onnxruntime`.
- **Alternatives considered**: carregar no boot (atrasa `npm run dev` e todo teste
  que importa o módulo); um pipeline por chamada (inviável em custo).
- **Cache**: usa o `env.cacheDir` padrão da biblioteca. Não é preciso configurar
  nada novo.

## §3 — Persistência do vetor (BLOB)

- **Decision**: tabela `memories (id TEXT PK, user_id TEXT NOT NULL, fact TEXT NOT
  NULL, embedding BLOB NOT NULL, created_at TEXT NOT NULL)` + índice em `user_id`,
  com DDL idempotente no construtor, no mesmo arquivo `OPSPILOT_DB` (padrão do
  `SqliteConversationStore`). O vetor é gravado como os bytes crus de um
  `Float32Array` little-endian (384 × 4 = 1536 bytes). Na leitura, o `Uint8Array`
  devolvido pelo `node:sqlite` é **copiado** para um `ArrayBuffer` novo antes de
  virar `Float32Array`, porque o offset do buffer pode não estar alinhado em 4 bytes.
  A conversão fica em funções puras `toBlob`/`fromBlob`.
- **Rationale**: o formato foi pedido pelo usuário, é compacto e não exige
  parse. A cópia elimina o `RangeError` de alinhamento.
- **Alternatives considered**: JSON em TEXT (≈4× maior e lento para parsear);
  extensão `sqlite-vec` (dependência nativa de terceiros para SQLite, vetada pela
  constituição, e desnecessária para a escala esperada).

## §4 — Similaridade, recall e dedup

- **Decision**: funções puras em `src/memory/similarity.ts`:
  - `dot(a, b)`: produto escalar (lança erro se as dimensões diferirem).
  - `rankBySimilarity(query, candidates, { limit: 3, minScore: 0.3 })`: calcula o
    score de cada candidato, filtra `score >= 0.3`, ordena de forma decrescente
    (empate: `created_at` mais recente primeiro) e corta em 3.
  - `findDuplicate(vector, candidates, 0.92)`: devolve o candidato de maior
    score se `score > 0.92`; senão, `undefined`.
- **Rationale**: vetores normalizados → produto escalar = cosseno, sem dividir por
  normas. Limiares conforme a spec: 0,3 é inclusivo; 0,92 é estrito. Busca
  linear em memória sobre os fatos do usuário (dezenas a centenas × 384 floats):
  menos de 1 ms, bem dentro do SC-007.
- **Alternatives considered**: `ORDER BY` no SQL (o SQLite não calcula produto
  escalar de BLOB sem extensão); índice ANN (excessivo para a escala).

## §5 — Onde a memória vive (camadas)

- **Decision**: `src/memory/memory-store.ts` contém os tipos, a interface
  `MemoryStore` (`remember`/`recall`/`forget`, sempre com `userId` como
  primeiro parâmetro) e a implementação `SqliteMemoryStore(embedder, path)`. Não há
  fake de store separado: os testes usam `SqliteMemoryStore(":memory:")` com um
  **embedder fake** (§8), que é a única parte não determinística.
- **Rationale**: os caminhos foram pedidos pelo usuário (`src/memory/`). O Model
  continua sendo o único que fala SQL (Princípio III). O fake de store existiria
  só para o `bench`, que não usa memória.
- **Alternatives considered**: colocar em `src/store/` (consistente com o resto,
  mas contraria o caminho pedido); criar `MockMemoryStore` (duplicaria a regra de
  dedup/recall sem ganho).

## §6 — Como o recall entra no prompt

- **Decision**: decorador puro `withMemory(strategy, facts)` em
  `src/memory/memory-prompt.ts`, gêmeo de `withHistory`, com
  `formatQuestionWithMemory(facts, question)`. Sem fatos, a pergunta fica inalterada
  (FR-008). Com fatos:
  ```
  Fatos lembrados sobre este usuário (mais relevante primeiro):
  - [<id>] <fato>
  ...

  <pergunta — já com histórico, se houver>
  ```
  Ordem de composição no `runChat`:
  `withHistory(withMemory(strategy, facts), history)`. O histórico continua a
  camada mais externa (specs/007, research §2). Como o `withHistory` reescreve a
  pergunta antes de repassá-la, o texto final fica: fatos → histórico → pergunta
  atual.
- **Rationale**: mesma técnica já validada para o histórico. Nenhuma estratégia muda
  de contrato (FR-007), e reflexão, arena e bench continuam intactos. O `[id]`
  permite que o agente chame `forget_fact` (FR-013).
- **Alternatives considered**: system prompt por estratégia (exigiria mudar cada
  estratégia); tool `recall` para o agente chamar (o pedido é *injetar* o recall).

## §7 — Tools de memória com o `userId` do turno (FR-013, opção A)

- **Decision**: `src/memory/memory-tools.ts` → `createMemoryTools(memory, userId)`
  devolve duas tools LangChain, com o `userId` capturado na closure:
  - `remember_fact { fact: string (1..500, trim) }` → `{ id, fact, created }`
  - `forget_fact { memoryId: uuid }` → `{ forgotten: boolean }`

  O LLM nunca recebe nem informa `userId`. Como as estratégias são construídas
  sobre uma lista fixa de tools, o Controller passa a receber uma **fábrica de
  registry** em vez de um `Map` fixo:
  `strategiesFor(userId?: string): Map<string, ReasoningStrategy>`. Em
  `src/index.ts`: sem `userId` → registry base, memoizado uma vez; com `userId`
  → `createStrategyRegistry([...baseTools, ...createMemoryTools(memory, userId)])`.
- **Rationale**: isolamento por construção. Um usuário não consegue lembrar ou
  esquecer fatos de outro, porque o id nem é parâmetro da tool (SC-002). Montar
  `createReactAgent` por turno custa milissegundos, desprezível frente ao LLM. Sem
  usuário, o comportamento e as tools são exatamente os de hoje (SC-005).
- **Alternatives considered**: `userId` como argumento da tool (o LLM poderia
  trocá-lo, falha de isolamento); `AsyncLocalStorage` com o usuário corrente
  (estado implícito, contraria o Princípio V e é difícil de testar); tools sempre
  presentes, falhando sem usuário (confunde o agente).
- **Impacto**: a assinatura muda de `createApp(registry, conversations, opts)` para
  `createApp({ strategiesFor, conversations, memory }, opts)`, com `memory` opcional.
  O `server.test.ts` passa a usar `strategiesFor: () => fakeRegistry`. `arena`,
  `bench` e o MCP não mudam.

## §8 — Testes

- **Decision**:
  1. `similarity.test.ts`: puro — limiares 0,3 (inclusivo) e 0,92 (estrito),
     top-3, ordenação, `toBlob`/`fromBlob` com round-trip e offset desalinhado.
  2. `memory-store.test.ts`: `SqliteMemoryStore(":memory:")` +
     `createFakeEmbedder(table)` (texto → vetor unitário fixo, declarado no teste).
     Cobre dedup, isolamento por usuário, forget restrito ao dono, recall vazio e
     persistência em arquivo temporário (reabrir o store).
  3. `memory-prompt.test.ts` e `memory-tools.test.ts`: puros/fake.
  4. `chat-service.test.ts` e `server.test.ts`: `userId` injeta fatos,
     `metrics.memoryFacts`, sem `userId` = comportamento antigo, `userId`
     inválido → 400.
  5. `embeddings.test.ts` (**modelo real**): par fato/pergunta **sem nenhuma
     palavra em comum** — o teste verifica isso por tokenização antes de medir.
     Par escolhido (em inglês, idioma de treino do modelo): fato *"The payments
     database runs on PostgreSQL"* × pergunta *"Which SQL engine stores our billing
     records?"*, junto com um fato distrator sem relação (*"My favourite colour is
     green"*). Esperado: o fato certo volta com score ≥ 0,3 e acima do distrator.
     Timeout de 120 s no primeiro download. Pode ser pulado com
     `OPSPILOT_SKIP_MODEL_TESTS=1` (ambiente offline/CI); o `npm test` roda por
     padrão.
- **Rationale**: a regra de negócio fica determinística e sem rede. O único teste
  real prova o requisito central (FR-004/SC-001) sem deixar a suíte inteira
  dependente do modelo.
- **Resultado (implementação, 2026-09-30)**: o par obteve **score 0,4306**
  (limiar 0,3), com o distrator abaixo. Nenhuma troca de par foi necessária.
- **Nota de implementação**: os limiares são comparados na precisão float32 dos
  vetores (`Math.fround`), senão "exatamente 0,92" (que em float32 vale
  0,92000002) seria tratado como duplicata.
- **Risco (original)**: o score exato do par só é conhecido ao rodar. Se ficar abaixo de 0,3,
  o `/speckit-implement` troca o par (mantendo a regra de nenhuma palavra em
  comum), sem mexer no limiar.

## §9 — Contrato HTTP

- **Decision**: `chatRequestSchema` ganha
  `userId: z.string().trim().min(1).max(128).optional()`. A resposta ganha
  `metrics.memoryFacts` (0..3, sempre presente, 0 sem `userId`). O `userId` não é
  ecoado na resposta. O recall roda antes do teto de tempo, como a leitura de
  histórico. Falha do embedder propaga até a rede de segurança (500
  `internal_error`), sem degradação silenciosa.
- **Rationale**: é o menor acréscimo compatível (SC-005). Falhar alto evita
  respostas que parecem "ter esquecido" o usuário sem explicação.
- **Alternatives considered**: `userId` obrigatório (quebra clientes atuais);
  degradar para 0 fatos com log (esconde um problema de infraestrutura atrás de
  uma resposta plausível).

import { SqliteOpsStore } from "./store/sqlite-ops-store.js";
import { SqliteConversationStore } from "./store/sqlite-conversation-store.js";
import { SqliteRequestStore } from "./store/sqlite-request-store.js";
import { SqliteApprovalStore } from "./store/sqlite-approval-store.js";
import { createLogger } from "./obs/logger.js";
import { createOpsTools } from "./agents/tools.js";
import { createProviderStatusTool } from "./agents/provider-status-tool.js";
import { createStrategyRegistry } from "./agents/index.js";
import { createApp } from "./http/server.js";
import { createLocalEmbedder } from "./memory/embeddings.js";
import { SqliteMemoryStore } from "./memory/memory-store.js";
import { createMemoryTools } from "./memory/memory-tools.js";
import { defaultLearningExtractor, learnFromMessage, logLearningFailure, type LearnInput } from "./memory/learning.js";
import { defaultSummarizer } from "./agents/summarizer.js";
import { defaultRouter } from "./agents/router.js";
import { parseContextBudget } from "./context/context-builder.js";
import { parseModelPrices } from "./services/pricing.js";
import { parseCorsOrigins } from "./http/cors.js";

const store = new SqliteOpsStore();
const baseTools = [...createOpsTools(store), createProviderStatusTool()];
const baseRegistry = createStrategyRegistry(baseTools);
const conversations = new SqliteConversationStore();
// Registro + rastro de cada turno do /chat, consultável por GET /requests/:id (specs/016).
const requests = new SqliteRequestStore();
// Aprovações de ações sensíveis (specs/018): open_incident/resolve_incident pausam o /chat (202).
const approvals = new SqliteApprovalStore();
// Logs JSON de uma linha por acontecimento, só metadados (specs/016).
const logger = createLogger();
// O modelo de embeddings só carrega no primeiro turno com userId (specs/008, research.md §2).
const memory = new SqliteMemoryStore(createLocalEmbedder());

/** Sem userId → registry base; com userId → + tools de memória presas a ele (research.md §7). */
function strategiesFor(userId?: string) {
	return userId ? createStrategyRegistry([...baseTools, ...createMemoryTools(memory, userId)]) : baseRegistry;
}

/** Refletor de aprendizado (specs/009): roda sem await depois de cada turno com userId. */
function learn(input: LearnInput) {
	return learnFromMessage(input, { memory, extractor: defaultLearningExtractor, log: logLearningFailure });
}

// Orçamento de contexto por seção (specs/013): CONTEXT_BUDGET_*, inválido → padrão.
const { budget: contextBudget, invalid } = parseContextBudget(process.env);
if (invalid.length > 0) {
	console.warn(`Orçamento de contexto inválido em ${invalid.join(", ")}; usando o padrão.`);
}

// Preços para o custo estimado do GET /stats (specs/017): MODEL_PRICES, ids :free custam 0.
const { prices: modelPrices, invalid: invalidPrices } = parseModelPrices(process.env);
if (invalidPrices.length > 0) {
	console.warn(`Preço inválido em ${invalidPrices.join(", ")}; entrada ignorada.`);
}

// Origens de navegador aceitas (specs/018): CORS_ORIGINS, lista exata; vazio → nenhuma.
const { origins: corsOrigins, invalid: invalidOrigins } = parseCorsOrigins(process.env);
if (invalidOrigins.length > 0) {
	console.warn(`Origem inválida em ${invalidOrigins.join(", ")}; entrada ignorada.`);
}

// Resumidor de histórico (specs/012): só roda quando 8 mensagens saem da janela recente.
// Roteador do grafo de produção (specs/014): escolhe a rota quando o /chat não traz `strategy`.
const app = createApp({ strategiesFor, conversations, memory, learn, summarizer: defaultSummarizer, contextBudget, router: defaultRouter, requests, logger, modelPrices, corsOrigins, approvals, ops: store });

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
	console.log(`OpsPilot ouvindo em http://localhost:${port}`);
});

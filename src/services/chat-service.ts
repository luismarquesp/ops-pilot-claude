import type { Summarizer } from "../agents/summarizer.js";
import type { Metrics } from "../agents/strategy.js";
import type { Route, Router } from "../agents/router.js";
import type { RouteStrategies } from "../agents/routes.js";
import { createProductionGraph, type GraphTrace } from "../graph/production-graph.js";
import type { ConversationStore } from "../store/conversation-store.js";
import type { MemoryStore } from "../memory/memory-store.js";
import type { LearnInput } from "../memory/learning.js";
import type { ContextBreakdown } from "../context/breakdown.js";
import type { ContextBudget, ContextTrimReport } from "../context/context-builder.js";
import { promptTokensOf } from "../context/tokens.js";
import { trackUsage } from "../context/usage-tracker.js";
import { trackModelCalls } from "../agents/model-calls.js";
import { TimeoutError } from "./errors.js";
import { randomUUID } from "node:crypto";
import type { TraceEvent } from "../agents/strategy.js";
import { trackApprovals } from "../agents/approval-gate.js";
import { APPROVAL_TTL_MS, approvalSummary, ledgerPromptSection, type LedgerEntry } from "../agents/approvals.js";
import type { Approval, ApprovalStore } from "../store/approval-store.js";

export interface ChatInput {
	message: string;
	conversationId?: string;
	/** Dono da memória semântica do turno (specs/008). Sem ele, nenhuma memória é consultada. */
	userId?: string;
	/** `strategy` da requisição (specs/014): override da rota, sem chamar o roteador. */
	strategy?: Route;
	/** `reflect` da requisição — guardado na aprovação para o replay (specs/018). */
	reflect?: boolean;
	/** Requisição que originou o turno — guardada na aprovação (specs/018). */
	requestId?: string;
	/** Turno retomado depois de uma decisão (specs/018, research §1). */
	resume?: TurnResume;
}

export interface TurnResume {
	turnId: string;
	route: Route;
	/** Decisões já tomadas no turno, consultadas pelo portão. */
	ledger: LedgerEntry[];
	/** Evento `decision` que abre o rastro do turno retomado. */
	decision: Extract<TraceEvent, { type: "decision" }>;
}

export interface ChatDeps {
	/** Estratégias por rota, já refletidas se pedido (specs/014, `routeStrategies`). */
	strategies: RouteStrategies;
	/** Roteador do grafo (specs/014); ausente → toda decisão cai em `react` (fallback). */
	router?: Router;
	conversations: ConversationStore;
	/** Memória semântica por usuário (specs/008); só consultada quando há `userId`. */
	memory?: MemoryStore;
	timeoutMs: number;
	/**
	 * Refletor de aprendizado (specs/009, research.md §5): disparado sem `await`
	 * depois de um turno bem-sucedido com `userId`; nunca atrasa a resposta.
	 */
	learn?: (input: LearnInput) => Promise<unknown>;
	/**
	 * Resumidor de histórico (specs/012): chamado só quando 8 mensagens não
	 * resumidas saem da janela recente. Ausente → só a janela, sem resumo novo.
	 */
	summarizer?: Summarizer;
	/** Tetos por seção do prompt (specs/013); ausente → `DEFAULT_CONTEXT_BUDGET`. */
	budget?: ContextBudget;
	/**
	 * Aprovações (specs/018): presente → ações sensíveis pausam o turno (202).
	 * Ausente → o portão fica inativo e as ações executam direto, como antes.
	 */
	approvals?: ApprovalStore;
	now?: () => Date;
	newId?: () => string;
}

/**
 * Métricas do turno: as da estratégia + mensagens de histórico usadas
 * (specs/007, FR-009) + fatos de memória injetados (specs/008, FR-009) +
 * medição de contexto (specs/011).
 */
export interface ChatMetrics extends Metrics {
	historyMessages: number;
	memoryFacts: number;
	/** Real: tokens de entrada somados em todas as chamadas ao modelo do turno; `null` sem uso informado (FR-004). */
	promptTokens: number | null;
	/** Estimado (`ceil(chars/4)`) por fonte do prompt montado: pergunta, histórico e memória (FR-005). */
	contextBreakdown: ContextBreakdown;
	/** Removidos pelo orçamento de contexto neste turno (specs/013, FR-011). */
	contextTrimmed: ContextTrimReport;
	/** Modelo que produziu a resposta final (specs/015); `null` se a estratégia não chamou o modelo. */
	modelUsed: string | null;
}

export interface ChatResult {
	kind?: "ok";
	conversationId: string;
	answer: string;
	/** Rastro do grafo (specs/014): todo evento com `node`, exatamente um `route`. */
	trace: GraphTrace;
	metrics: ChatMetrics;
}

/** Turno pausado antes de uma ação sensível (specs/018): vira 202 no Controller. */
export interface PendingApprovalResult {
	kind: "pending";
	conversationId: string;
	approval: Approval;
	/** Termina no evento `approval`; nenhuma resposta. */
	trace: GraphTrace;
	metrics: ChatMetrics;
}

export type TurnResult = (ChatResult & { kind: "ok" }) | PendingApprovalResult;

/**
 * Corre `promise` contra um teto de tempo. Se o teto vencer, a promise original
 * continua rodando em segundo plano — seu resultado eventual é apenas ignorado
 * (specs/003, research.md §1): resolver/rejeitar uma promise já assentada não tem efeito.
 */
function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new TimeoutError(timeoutMs));
		}, timeoutMs);

		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

/**
 * Um turno de chat com conversa persistente (specs/007, contracts/chat-api.md):
 * carrega até `HISTORY_LIMIT` mensagens anteriores (`ConversationNotFoundError`
 * para id desconhecido), roda a estratégia com o histórico por composição, e só
 * depois do sucesso cria a conversa (se nova) e grava pergunta + resposta —
 * turnos que falham ou estouram o tempo não alteram nada (FR-006).
 *
 * Com `userId` e `memory`, os fatos lembrados (specs/008, research.md §6)
 * entram por dentro do histórico: fatos → histórico → pergunta. Falha do
 * embedder propaga, sem gravar nada (research.md §9).
 *
 * Com `userId` e `learn`, depois de gravar o turno dispara o aprendizado sem
 * esperá-lo (specs/009); turnos que falham nunca chegam a esse ponto.
 *
 * A estratégia roda dentro de `trackUsage` (specs/011, research.md §3): o uso
 * real de todas as chamadas ao modelo vira `promptTokens`; o escopo fecha antes
 * do `learn`, que fica fora da contagem.
 *
 * O contexto de conversa (specs/012) é carregado dentro do mesmo timeout e do
 * mesmo `trackUsage`: resumo vigente + mensagens não resumidas, sumarizando
 * quando `planHistory` manda. O prompt sai fatos → resumo → histórico → pergunta.
 *
 * O prompt é montado por `buildContext` (specs/013) com teto por seção, para
 * qualquer estratégia; métricas de histórico, memória e contexto refletem o
 * que sobrou depois dos cortes.
 *
 * Desde o specs/014, contexto, roteamento e estratégia rodam no grafo de
 * produção (`createProductionGraph`): o roteador escolhe a rota (ou vale o
 * override de `input.strategy`) e conta em `llmCalls`/`promptTokens`. Recall,
 * timeout, gravação e `learn` continuam aqui, em volta do grafo.
 *
 * Resiliência de modelo (specs/015): o grafo roda dentro de `trackModelCalls`;
 * `metrics.modelUsed` é o modelo da resposta final. `ModelUnavailableError`
 * propaga sem gravar nada — o Controller responde 503.
 */
export async function runChat(input: ChatInput, deps: ChatDeps): Promise<ChatResult> {
	// Sem ApprovalStore o portão fica inativo: o turno nunca pausa.
	const { kind: _kind, ...result } = (await runTurn(input, { ...deps, approvals: undefined })) as ChatResult & { kind: "ok" };
	return result;
}

/**
 * Turno do `/chat` com aprovação (specs/018): igual ao `runChat`, mas com
 * `approvals` o grafo roda dentro de `trackApprovals`. Se uma ação sensível foi
 * interceptada, a resposta do LLM é descartada, a conversa é criada (vazia) se
 * preciso, a `Approval` é gravada (TTL 15 min) e nada vai para a conversa nem
 * para o `learn`. Com `resume`, o livro responde pelas ações decididas e o
 * rastro abre com o evento `decision`.
 */
export async function runTurn(input: ChatInput, deps: ChatDeps): Promise<TurnResult> {
	const { conversations, memory, timeoutMs, approvals, now = () => new Date(), newId = randomUUID } = deps;
	const { resume } = input;
	const facts = input.userId && memory ? await memory.recall(input.userId, input.message) : [];
	const graph = createProductionGraph({
		strategies: deps.strategies,
		router: deps.router,
		conversations,
		summarizer: deps.summarizer,
		budget: deps.budget,
	});

	const { value: output, usage } = await runWithTimeout(
		trackUsage(async () => {
			// Escopo das chamadas ao modelo do turno (specs/015): o grafo lê as trocas por nó.
			const { value } = await trackModelCalls(async () => {
				const run = () =>
					graph.invoke({
						message: input.message,
						conversationId: input.conversationId,
						facts,
						override: input.strategy,
						...(resume
							? { resume: { route: resume.route }, decisions: ledgerPromptSection(resume.ledger), leading: [resume.decision] }
							: {}),
					});
				// Portão ativo só com ApprovalStore; o id da aprovação nasce no portão.
				return approvals ? (await trackApprovals(run, { ledger: resume?.ledger ?? [], newId })).value : run();
			});
			return value;
		}),
		timeoutMs,
	);
	const { built } = output;
	const metrics: ChatMetrics = {
		llmCalls: output.llmCalls,
		latencyMs: output.latencyMs,
		historyMessages: built.history.length,
		memoryFacts: built.facts.length,
		promptTokens: promptTokensOf(usage),
		contextBreakdown: built.breakdown,
		contextTrimmed: built.trimmed,
		modelUsed: output.modelUsed,
	};

	if (approvals && output.pending) {
		const conversationId = input.conversationId ?? (await conversations.create()).id;
		const createdAt = now();
		const approval = await approvals.create({
			id: output.pending.id,
			turnId: resume?.turnId ?? newId(),
			conversationId,
			requestId: input.requestId ?? null,
			message: input.message,
			userId: input.userId ?? null,
			route: output.route.route,
			reflect: Boolean(input.reflect),
			tool: output.pending.tool,
			args: output.pending.args,
			summary: approvalSummary(output.pending.tool, output.pending.args),
			createdAt: createdAt.toISOString(),
			expiresAt: new Date(createdAt.getTime() + APPROVAL_TTL_MS).toISOString(),
		});
		return { kind: "pending", conversationId, approval, trace: output.trace, metrics };
	}

	const conversationId = input.conversationId ?? (await conversations.create()).id;
	await conversations.append(conversationId, "user", input.message);
	await conversations.append(conversationId, "assistant", output.answer);

	if (input.userId && deps.learn) {
		void deps.learn({ userId: input.userId, message: input.message }).catch(() => {});
	}

	return { kind: "ok", conversationId, answer: output.answer, trace: output.trace, metrics };
}

import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { userIdSchema } from "./schemas.js";
import type { ReflectionOptions } from "../agents/reflection.js";
import type { ReasoningStrategy } from "../agents/strategy.js";
import type { Route, Router } from "../agents/router.js";
import { availableRoutes, routeStrategies } from "../agents/routes.js";
import { runTurn, type ChatDeps, type TurnResult } from "../services/chat-service.js";
import { createMemoryRouter } from "./memory-routes.js";
import {
	ApprovalAlreadyDecidedError,
	ApprovalExpiredError,
	ApprovalNotFoundError,
	ConversationNotFoundError,
	ModelUnavailableError,
	TimeoutError,
} from "../services/errors.js";
import type { ConversationStore } from "../store/conversation-store.js";
import type { MemoryStore } from "../memory/memory-store.js";
import type { LearnInput } from "../memory/learning.js";
import type { Summarizer } from "../agents/summarizer.js";
import type { ContextBudget } from "../context/context-builder.js";
import { requestContext, requestIdOf, withRequestId } from "../obs/request-context.js";
import { silentLogger, type Logger } from "../obs/logger.js";
import type { RequestErrorCode, RequestStore } from "../store/request-store.js";
import { buildRequestRecord, recordRequest, routeOf, type RequestRecordInput } from "../services/request-service.js";
import { traceEventLogFields } from "../obs/log-fields.js";
import { createRequestRouter } from "./request-routes.js";
import { createStatsRouter } from "./stats-routes.js";
import type { ModelPrices } from "../services/pricing.js";
import { corsMiddleware } from "./cors.js";
import type { ApprovalStore } from "../store/approval-store.js";
import type { OpsStore } from "../store/ops-store.js";
import { decideApproval, resumeTurn } from "../services/approval-service.js";
import { approvalView, createApprovalRouter } from "./approval-routes.js";

/** Teto de tempo por requisição, em ms (FR-007). */
const DEFAULT_TIMEOUT_MS = 180_000;

const chatRequestSchema = z.object({
	message: z.string().min(1),
	strategy: z.string().optional(),
	reflect: z.boolean().optional(),
	conversationId: z.uuid().optional(),
	userId: userIdSchema.optional(),
});

/**
 * Dependências do Controller (specs/008, contracts/chat-api.md). As estratégias
 * vêm de uma fábrica por `userId` porque as tools de memória ficam presas ao
 * usuário do turno (research.md §7).
 */
export interface AppDeps {
	strategiesFor(userId?: string): Map<string, ReasoningStrategy>;
	conversations: ConversationStore;
	/** Ausente → `userId` é aceito, mas nenhum fato é lembrado. */
	memory?: MemoryStore;
	/** Refletor de aprendizado, disparado sem await após sucesso (specs/009). */
	learn?: (input: LearnInput) => Promise<unknown>;
	/** Resumidor de histórico (specs/012); ausente → só a janela recente, sem resumo novo. */
	summarizer?: Summarizer;
	/** Tetos por seção do prompt (specs/013); ausente → padrão do `buildContext`. */
	contextBudget?: ContextBudget;
	/** Roteador do grafo de produção (specs/014); ausente → toda decisão cai em `react`. */
	router?: Router;
	/** Registro + rastro por requisição (specs/016); ausente → nada é gravado e `/requests` não existe. */
	requests?: RequestStore;
	/** Logger estruturado (specs/016); ausente → `silentLogger`. */
	logger?: Logger;
	/** Preço por 1M tokens de prompt para o `GET /stats` (specs/017); ausente → só `:free` tem custo conhecido. */
	modelPrices?: ModelPrices;
	/** Origens de navegador aceitas (specs/018, `CORS_ORIGINS`); ausente/vazio → nenhuma. */
	corsOrigins?: readonly string[];
	/**
	 * Aprovação de ações sensíveis (specs/018): com `approvals` + `ops`, o `/chat`
	 * pausa antes de abrir/resolver incidente (202) e `/chat/approvals` existe.
	 * Ausente → as ações executam direto, como antes.
	 */
	approvals?: ApprovalStore;
	/** Onde a ação aprovada é executada (o mesmo `OpsStore` das tools). */
	ops?: OpsStore;
	/** Relógio (expiração das aprovações); ausente → `new Date()`. */
	now?: () => Date;
}

export interface CreateAppOptions {
	/** Sobrescreve o teto de 180s — usado pelos testes para exercitar o 504 rapidamente. */
	timeoutMs?: number;
	/**
	 * Repassado a `withReflection` quando `reflect: true` — injetável para os
	 * testes de integração substituírem o crítico real por um dublê determinístico
	 * (mesmo princípio de specs/002, research.md §1). Em produção, fica indefinido
	 * e `withReflection` usa o crítico padrão baseado em `createModel()`.
	 */
	reflectionOptions?: ReflectionOptions;
	/** Gerador do `requestId` (specs/016); ausente → `randomUUID`. */
	newRequestId?: () => string;
}

/**
 * Monta o app Express desta feature (Controller — constitution Princípio III):
 * só valida entrada HTTP, monta as estratégias por rota via `strategiesFor(userId)` +
 * `routeStrategies` (specs/014: `strategy` é override opcional do roteador), e traduz o
 * resultado (ou a falha) em uma resposta HTTP. O turno em si (histórico,
 * timeout, gravação, memória) é do serviço `runChat`. Ver contracts/chat-api.md
 * (specs/003, specs/007 e specs/008). Modelo indisponível vira 503
 * `model_unavailable` (specs/015).
 */
export function createApp(deps: AppDeps, opts: CreateAppOptions = {}): Express {
	const { strategiesFor, conversations, memory, logger = silentLogger } = deps;
	const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const app = express();
	// CORS antes de tudo (specs/018): preflight responde aqui, sem requestId nem log de turno.
	app.use(corsMiddleware(deps.corsOrigins ?? []));
	// Saúde para o "Testar conexão" da war room — sem dependências.
	app.get("/health", (_req: Request, res: Response) => {
		res.status(200).json({ status: "ok" });
	});
	// Id de requisição antes do express.json(): o JSON malformado também recebe id (specs/016).
	app.use("/chat", requestContext({ newId: opts.newRequestId, logger }));
	app.use(express.json());

	if (deps.approvals && !deps.ops) {
		throw new Error("AppDeps.approvals exige AppDeps.ops para executar as ações aprovadas");
	}
	const now = deps.now ?? (() => new Date());

	const chatDeps = (strategies: ChatDeps["strategies"]): ChatDeps => ({
		strategies,
		router: deps.router,
		conversations,
		memory,
		timeoutMs,
		learn: deps.learn,
		summarizer: deps.summarizer,
		budget: deps.contextBudget,
		approvals: deps.approvals,
		now,
	});

	const strategiesOf = (userId: string | undefined, reflect: boolean | undefined) =>
		routeStrategies(strategiesFor(userId), { reflect, reflectionOptions: opts.reflectionOptions });

	type MappedError = { status: number; errorCode: RequestErrorCode; body: object };

	/**
	 * Um turno validado (specs/016 + 018): roda, grava o registro antes de
	 * responder, loga o rastro e traduz o resultado — 200, 202 (pausa) ou erro.
	 * Compartilhado pelo `/chat` e pela decisão de aprovação. `input()` é lido na
	 * gravação: a decisão só conhece a conversa depois de decidir.
	 */
	async function respondTurn(
		res: Response,
		input: () => { conversationId?: string; userId?: string },
		run: () => Promise<TurnResult>,
		mapError?: (error: unknown) => MappedError | undefined,
	): Promise<void> {
		const requestId = requestIdOf(res)!;
		const reply = (status: number, body: object) => res.status(status).json(withRequestId(body, requestId));
		const startedAt = new Date().toISOString();
		const t0 = Date.now();
		const persist = async (outcome: Pick<RequestRecordInput, "result" | "status" | "errorCode">) => {
			if (!deps.requests) {
				return;
			}
			const record = buildRequestRecord({ requestId, startedAt, durationMs: Date.now() - t0, input: input(), ...outcome });
			await recordRequest({ requests: deps.requests, logger }, record, outcome.result?.trace ?? []);
		};
		const fail = async ({ status, errorCode, body }: MappedError) => {
			res.locals.errorCode = errorCode;
			await persist({ status, errorCode });
			reply(status, body);
		};

		try {
			const turn = await run();
			await persist({ result: turn });
			// Linhas de log do rastro e métricas do `chat.request.end` (specs/016, FR-012): só metadados.
			turn.trace.forEach((event, seq) => logger.info("chat.trace.event", traceEventLogFields(event, seq, requestId)));
			res.locals.metrics = turn.metrics;
			res.locals.route = routeOf(turn.trace).route;
			if (turn.kind === "pending") {
				const { conversationId, approval, trace, metrics } = turn;
				reply(202, { conversationId, status: "approval_required", approval: approvalView(approval), trace, metrics });
				return;
			}
			const { kind: _kind, ...result } = turn;
			reply(200, result);
		} catch (error) {
			const mapped = mapError?.(error);
			if (mapped) {
				await fail(mapped);
				return;
			}
			if (error instanceof ConversationNotFoundError) {
				await fail({ status: 404, errorCode: "conversation_not_found", body: { error: "conversation_not_found", conversationId: error.conversationId } });
				return;
			}
			if (error instanceof TimeoutError) {
				await fail({ status: 504, errorCode: "timeout", body: { error: "timeout", timeoutMs: error.timeoutMs } });
				return;
			}
			// Nenhum modelo respondeu (specs/015): 503 honesto, log só com os ids.
			if (error instanceof ModelUnavailableError) {
				logger.warn("model.unavailable", { requestId, modelsTried: error.modelsTried });
				await fail({ status: 503, errorCode: "model_unavailable", body: { error: "model_unavailable", modelsTried: error.modelsTried } });
				return;
			}
			// Erro inesperado: grava internal_error e segue para a rede de segurança (500).
			await persist({ status: 500, errorCode: "internal_error" });
			throw error;
		}
	}

	app.post("/chat", async (req: Request, res: Response) => {
		const requestId = requestIdOf(res)!;
		const reply = (status: number, body: object) => res.status(status).json(withRequestId(body, requestId));

		const parsed = chatRequestSchema.safeParse(req.body);
		if (!parsed.success) {
			reply(400, { issues: parsed.error.issues });
			return;
		}

		const { message, strategy: strategyName, reflect, conversationId, userId } = parsed.data;
		const strategies = strategiesOf(userId, reflect);
		const available = availableRoutes(strategies).map((spec) => spec.name);
		if (strategyName !== undefined && !available.includes(strategyName as Route)) {
			reply(422, { error: "unknown_strategy", strategy: strategyName, available });
			return;
		}

		await respondTurn(
			res,
			() => ({ conversationId, userId }),
			() => runTurn({ message, conversationId, userId, strategy: strategyName as Route | undefined, reflect, requestId }, chatDeps(strategies)),
		);
	});

	// Aprovação de ações sensíveis (specs/018) — sob /chat, herda o requestContext.
	if (deps.approvals && deps.ops) {
		const approvals = deps.approvals;
		const ops = deps.ops;
		const mapApprovalError = (error: unknown): MappedError | undefined => {
			if (error instanceof ApprovalNotFoundError) {
				return { status: 404, errorCode: "approval_not_found", body: { error: "approval_not_found", approvalId: error.approvalId } };
			}
			if (error instanceof ApprovalAlreadyDecidedError) {
				return {
					status: 409,
					errorCode: "approval_already_decided",
					body: { error: "approval_already_decided", approvalId: error.approvalId, status: error.status },
				};
			}
			if (error instanceof ApprovalExpiredError) {
				return { status: 410, errorCode: "approval_expired", body: { error: "approval_expired", approvalId: error.approvalId } };
			}
			return undefined;
		};
		app.use(
			"/chat/approvals",
			createApprovalRouter({
				approvals,
				now,
				decide: async (_req, res, id, decision) => {
					const requestId = requestIdOf(res)!;
					let known: { conversationId?: string; userId?: string } = {};
					await respondTurn(
						res,
						() => known,
						async () => {
							const decided = await decideApproval(id, decision, { approvals, ops, now });
							known = { conversationId: decided.conversationId, ...(decided.userId ? { userId: decided.userId } : {}) };
							const strategies = strategiesOf(decided.userId ?? undefined, decided.reflect);
							return resumeTurn(decided, { requestId }, { ...chatDeps(strategies), approvals });
						},
						mapApprovalError,
					);
				},
			}),
		);
	}

	// Acesso direto à memória, sem LLM (specs/010) — só existe quando há memória.
	if (memory) {
		app.use("/memories", createMemoryRouter(memory));
	}

	// Registro + rastro por requestId (specs/016) — só existe quando há RequestStore.
	if (deps.requests) {
		app.use("/requests", createRequestRouter(deps.requests));
		// Agregados da janela (specs/017) sobre as mesmas requisições.
		app.use("/stats", createStatsRouter(deps.requests, { prices: deps.modelPrices }));
	}

	// Rede de segurança para qualquer erro inesperado (research.md §4) — inclui
	// falhas de estratégia fora do contrato "nunca lança" e corpo JSON malformado
	// (erro lançado pelo próprio express.json() antes do handler acima rodar).
	// Log só com o nome do erro, nunca mensagem nem stack (specs/016, research.md §8).
	app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
		const requestId = requestIdOf(res);
		logger.error("http.unexpected_error", { requestId, errorName: err instanceof Error ? err.name : typeof err });
		res.locals.errorCode = "internal_error";
		const body = { error: "internal_error" };
		res.status(500).json(requestId ? withRequestId(body, requestId) : body);
	});

	return app;
}

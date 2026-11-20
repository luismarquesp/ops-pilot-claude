import {
	approvalListSchema,
	chatOkSchema,
	chatPendingSchema,
	errorBodySchema,
	type ChatOk,
	type ChatPending,
	type ErrorBody,
	type PendingApproval,
} from "./schemas.js";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Código de erro da API; `validation` para o 400 com `issues`. */
export type ApiErrorCode = string;

export interface ApiError {
	kind: "error";
	status: number;
	code: ApiErrorCode;
	requestId: string | undefined;
	body: ErrorBody;
}

/** Falhas que não são respostas de erro da API. */
export type TransportFailure =
	| { kind: "network" }
	| { kind: "cancelled" }
	| { kind: "invalid"; status: number; requestId: string | undefined };

/** Resposta de um turno: 200, 202 (aguardando aprovação), erro da API ou falha de transporte. */
export type ChatOutcome = { kind: "ok"; data: ChatOk } | { kind: "pending"; data: ChatPending } | ApiError | TransportFailure;

export type ApprovalListOutcome = { kind: "ok"; approvals: PendingApproval[] } | ApiError | TransportFailure;

export interface ChatRequest {
	message: string;
	conversationId?: string;
}

export interface ApiClientOptions {
	baseUrl: string;
	fetch?: FetchLike;
}

export interface ApiClient {
	readonly baseUrl: string;
	/** Nunca lança: todo resultado é uma união discriminada por `kind`. */
	postChat(request: ChatRequest, signal?: AbortSignal): Promise<ChatOutcome>;
	/** Aprovar ou negar; a resposta é a do turno retomado (200 ou outro 202). */
	decideApproval(approvalId: string, decision: "approve" | "deny"): Promise<ChatOutcome>;
	/** Pendentes da conversa, para recuperar os cartões ao recarregar. */
	listPendingApprovals(conversationId: string): Promise<ApprovalListOutcome>;
}

function join(baseUrl: string, path: string): string {
	return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function isAbort(error: unknown): boolean {
	return error instanceof DOMException ? error.name === "AbortError" : error instanceof Error && error.name === "AbortError";
}

type Raw = { response: Response; body: unknown } | TransportFailure;

async function send(fetchFn: FetchLike, url: string, init: RequestInit): Promise<Raw> {
	let response: Response;
	try {
		response = await fetchFn(url, init);
	} catch (error) {
		return isAbort(error) ? { kind: "cancelled" } : { kind: "network" };
	}
	const requestId = response.headers.get("x-request-id") ?? undefined;
	try {
		return { response, body: JSON.parse(await response.text()) as unknown };
	} catch (error) {
		return isAbort(error) ? { kind: "cancelled" } : { kind: "invalid", status: response.status, requestId };
	}
}

/** Resposta não-2xx → `ApiError` se o corpo seguir o contrato de erro; senão `invalid`. */
export function toApiError(status: number, body: unknown, headerRequestId: string | undefined): ApiError | TransportFailure {
	const parsed = errorBodySchema.safeParse(body);
	if (!parsed.success) {
		return { kind: "invalid", status, requestId: headerRequestId };
	}
	const code = "issues" in parsed.data ? "validation" : parsed.data.error;
	return { kind: "error", status, code, requestId: parsed.data.requestId ?? headerRequestId, body: parsed.data };
}

/** 200 → ok, 202 → pending, demais → erro; tudo validado pelo schema (FR-009). */
function toChatOutcome(raw: Raw): ChatOutcome {
	if ("kind" in raw) {
		return raw;
	}
	const { status } = raw.response;
	const headerRequestId = raw.response.headers.get("x-request-id") ?? undefined;
	if (status === 200) {
		const parsed = chatOkSchema.safeParse(raw.body);
		return parsed.success ? { kind: "ok", data: parsed.data } : { kind: "invalid", status, requestId: headerRequestId };
	}
	if (status === 202) {
		const parsed = chatPendingSchema.safeParse(raw.body);
		return parsed.success ? { kind: "pending", data: parsed.data } : { kind: "invalid", status, requestId: headerRequestId };
	}
	return toApiError(status, raw.body, headerRequestId);
}

export function createApiClient({ baseUrl, fetch: fetchFn = (url, init) => globalThis.fetch(url, init) }: ApiClientOptions): ApiClient {
	const postJson = (path: string, body: unknown, signal?: AbortSignal) =>
		send(fetchFn, join(baseUrl, path), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });

	return {
		baseUrl,
		async postChat(request, signal) {
			return toChatOutcome(await postJson("chat", request.conversationId ? request : { message: request.message }, signal));
		},
		async decideApproval(approvalId, decision) {
			return toChatOutcome(await postJson(`chat/approvals/${encodeURIComponent(approvalId)}`, { decision }));
		},
		async listPendingApprovals(conversationId) {
			const raw = await send(fetchFn, join(baseUrl, `chat/approvals?conversationId=${encodeURIComponent(conversationId)}`), { method: "GET" });
			if ("kind" in raw) {
				return raw;
			}
			const headerRequestId = raw.response.headers.get("x-request-id") ?? undefined;
			if (raw.response.status === 200) {
				const parsed = approvalListSchema.safeParse(raw.body);
				return parsed.success
					? { kind: "ok", approvals: parsed.data.approvals.map(({ status: _status, ...approval }) => approval) }
					: { kind: "invalid", status: 200, requestId: headerRequestId };
			}
			return toApiError(raw.response.status, raw.body, headerRequestId);
		},
	};
}

/** Resultado do "Testar conexão" (FR-015). */
export type ConnectionResult =
	| { kind: "connected" }
	| { kind: "cors_blocked" }
	| { kind: "unreachable" }
	| { kind: "unexpected"; status: number };

/**
 * Testa `GET /health` em duas etapas (research §7). O navegador não diz por que
 * um `fetch` falhou; se a mesma URL responde em `no-cors` (resposta opaca), o
 * servidor está no ar e o bloqueio é de origem (CORS).
 */
export async function testConnection(baseUrl: string, fetchFn: FetchLike = (url, init) => globalThis.fetch(url, init)): Promise<ConnectionResult> {
	const url = join(baseUrl, "health");
	try {
		const response = await fetchFn(url, { method: "GET" });
		return response.status === 200 ? { kind: "connected" } : { kind: "unexpected", status: response.status };
	} catch {
		try {
			await fetchFn(url, { method: "GET", mode: "no-cors" });
			return { kind: "cors_blocked" };
		} catch {
			return { kind: "unreachable" };
		}
	}
}

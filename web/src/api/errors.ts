import type { ApiError, TransportFailure } from "./client.js";

export type ErrorAction = "retry" | "new_conversation" | "fix" | "settings" | "none";

export interface ErrorInfo {
	title: string;
	detail?: string;
	action: ErrorAction;
	requestId: string | undefined;
}

type Described = Omit<ErrorInfo, "requestId">;

function minutes(ms: number | undefined): string {
	const n = Math.max(1, Math.round((ms ?? 180_000) / 60_000));
	return n === 1 ? "1 minuto" : `${n} minutos`;
}

function describeApiError(error: ApiError): Described {
	const body = "error" in error.body ? error.body : undefined;
	switch (error.code) {
		case "model_unavailable":
			return {
				title: "Nenhum modelo respondeu.",
				...(body?.modelsTried?.length ? { detail: `Tentamos: ${body.modelsTried.join(", ")}.` } : {}),
				action: "retry",
			};
		case "timeout":
			return { title: `A resposta passou de ${minutes(body?.timeoutMs)}.`, action: "retry" };
		case "conversation_not_found":
			return { title: "Essa conversa não existe mais.", action: "new_conversation" };
		case "request_not_found":
			return { title: "Requisição não encontrada.", action: "none" };
		case "unknown_strategy":
			return {
				title: "Estratégia inválida.",
				...(body?.available?.length ? { detail: `Disponíveis: ${body.available.join(", ")}.` } : {}),
				action: "fix",
			};
		case "secret_detected":
			return { title: "Esse texto parece conter um segredo e não foi salvo.", action: "fix" };
		case "validation":
			return { title: "A pergunta não foi aceita.", detail: "Revise o texto e envie de novo.", action: "fix" };
		case "approval_not_found":
			return { title: "Essa aprovação não existe mais.", action: "none" };
		case "approval_already_decided":
			return { title: "Essa ação já foi decidida.", action: "none" };
		case "approval_expired":
			return { title: "A aprovação expirou e a ação não foi executada.", action: "none" };
		default:
			return { title: "Algo deu errado do nosso lado.", action: "retry" };
	}
}

/**
 * Traduz uma falha em mensagem humana + próxima ação (pura; tabela de erros das
 * design instructions). Nunca repassa texto cru da API, stack ou JSON.
 */
export function describeError(failure: ApiError | TransportFailure, { apiUrl }: { apiUrl: string }): ErrorInfo {
	switch (failure.kind) {
		case "error":
			return { ...describeApiError(failure), requestId: failure.requestId };
		case "network":
			return {
				title: "Não foi possível falar com a API.",
				detail: `Confira o endereço ${apiUrl} nas configurações.`,
				action: "settings",
				requestId: undefined,
			};
		case "invalid":
			return { title: "Resposta inesperada da API.", action: "retry", requestId: failure.requestId };
		case "cancelled":
			return {
				title: "Espera cancelada.",
				detail: "O copiloto pode ter concluído; essa resposta não será exibida.",
				action: "retry",
				requestId: undefined,
			};
	}
}

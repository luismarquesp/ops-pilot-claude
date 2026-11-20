/** Erros de domínio, traduzidos na borda (constitution, Princípio IV). */

export class ServiceNotFoundError extends Error {
	constructor(public readonly service: string) {
		super(`Serviço não encontrado: ${service}`);
		this.name = "ServiceNotFoundError";
	}
}

export class IncidentNotFoundError extends Error {
	constructor(public readonly incidentId: number) {
		super(`Incidente não encontrado: ${incidentId}`);
		this.name = "IncidentNotFoundError";
	}
}

export class ConversationNotFoundError extends Error {
	constructor(public readonly conversationId: string) {
		super(`Conversa não encontrada: ${conversationId}`);
		this.name = "ConversationNotFoundError";
	}
}

export class TimeoutError extends Error {
	constructor(public readonly timeoutMs: number) {
		super(`Tempo esgotado após ${timeoutMs}ms`);
		this.name = "TimeoutError";
	}
}

export class RunbookNotFoundError extends Error {
	constructor(public readonly service: string) {
		super(`Nenhum runbook cadastrado para o serviço: ${service}`);
		this.name = "RunbookNotFoundError";
	}
}

/** Fato enviado à memória contém algo com cara de segredo (specs/010). Não carrega o texto. */
export class SecretDetectedError extends Error {
	constructor() {
		super("Fato contém um possível segredo");
		this.name = "SecretDetectedError";
	}
}

export class MemoryNotFoundError extends Error {
	constructor(public readonly memoryId: string) {
		super(`Memória não encontrada: ${memoryId}`);
		this.name = "MemoryNotFoundError";
	}
}

/**
 * Nenhum modelo da cadeia respondeu — principal e reservas esgotados (specs/015).
 * Carrega só os ids tentados, nunca a mensagem do provedor (research.md §6).
 */
export class ModelUnavailableError extends Error {
	constructor(public readonly modelsTried: string[]) {
		super(`Nenhum modelo respondeu: ${modelsTried.join(", ")}`);
		this.name = "ModelUnavailableError";
	}
}

/** Requisição sem registro persistido (specs/016) — nunca gravada ou gravação falhou. */
export class RequestNotFoundError extends Error {
	constructor(public readonly requestId: string) {
		super(`Requisição não encontrada: ${requestId}`);
		this.name = "RequestNotFoundError";
	}
}

/** Aprovação inexistente (specs/018) → 404 `approval_not_found`. */
export class ApprovalNotFoundError extends Error {
	constructor(public readonly approvalId: string) {
		super(`Aprovação não encontrada: ${approvalId}`);
		this.name = "ApprovalNotFoundError";
	}
}

/** Aprovação já aprovada ou negada (specs/018) → 409 `approval_already_decided`. */
export class ApprovalAlreadyDecidedError extends Error {
	constructor(
		public readonly approvalId: string,
		public readonly status: string,
	) {
		super(`Aprovação já decidida (${status}): ${approvalId}`);
		this.name = "ApprovalAlreadyDecidedError";
	}
}

/** Aprovação vencida — 15 min sem decisão, conta como negada (specs/018) → 410 `approval_expired`. */
export class ApprovalExpiredError extends Error {
	constructor(public readonly approvalId: string) {
		super(`Aprovação expirada: ${approvalId}`);
		this.name = "ApprovalExpiredError";
	}
}

import type { ApiError, TransportFailure } from "../api/client.js";
import type { ChatMetrics, ChatOk, ChatPending, PendingApproval, TraceEvent } from "../api/schemas.js";

export type Failure = ApiError | TransportFailure;

export interface UserMessage {
	id: string;
	role: "user";
	text: string;
}

export interface AssistantMessage {
	id: string;
	role: "assistant";
	/** `paused`: o turno parou antes de uma ação sensível (há um cartão de aprovação). */
	status: "sending" | "answered" | "paused" | "failed" | "cancelled";
	/** Pergunta que originou esta resposta — usada no "Tentar de novo". */
	question: string;
	text?: string;
	requestId?: string;
	trace?: TraceEvent[];
	metrics?: ChatMetrics;
	failure?: Failure;
}

export type ChatMessage = UserMessage | AssistantMessage;

export type ApprovalCardStatus = "pending" | "deciding" | "approved" | "denied" | "expired";

export interface ApprovalCardState {
	approval: PendingApproval;
	status: ApprovalCardStatus;
	requestId?: string;
	/** Falha da última tentativa de decidir (ou da resposta depois de decidir). */
	failure?: Failure;
}

/** Só memória: nada de conteúdo vai para o navegador (FR-021). */
export interface ChatState {
	conversationId?: string;
	messages: ChatMessage[];
	draft: string;
	/** Conversa recuperada depois de recarregar: mensagens antigas não são reexibidas. */
	resumed: boolean;
	approvals: ApprovalCardState[];
}

type Decision = "approve" | "deny";

export type ChatAction =
	| { type: "draft"; text: string }
	| { type: "send"; id: string; text: string }
	| { type: "answered"; id: string; data: ChatOk }
	| { type: "paused"; id: string; data: ChatPending }
	| { type: "failed"; id: string; failure: Failure }
	| { type: "cancelled"; id: string }
	| { type: "newConversation" }
	| { type: "decide"; approvalId: string; decision: Decision }
	| { type: "decided"; approvalId: string; decision: Decision; id: string; data: ChatOk }
	| { type: "decidedPending"; approvalId: string; decision: Decision; id: string; data: ChatPending }
	| { type: "decideFailed"; approvalId: string; decision: Decision; failure: Failure }
	| { type: "expire"; approvalId: string }
	| { type: "restore"; approvals: PendingApproval[] };

export function initialChatState(conversationId?: string, resumed = false): ChatState {
	return { ...(conversationId ? { conversationId } : {}), messages: [], draft: "", resumed: Boolean(conversationId) && resumed, approvals: [] };
}

/** Há uma resposta em andamento (o envio fica bloqueado). */
export function isBusy(state: ChatState): boolean {
	return state.messages.some((m) => m.role === "assistant" && m.status === "sending");
}

/** Há um cartão ainda sem decisão: novas perguntas ficam bloqueadas (FR-012). */
export function hasPendingApproval(state: ChatState): boolean {
	return state.approvals.some((c) => c.status === "pending" || c.status === "deciding");
}

function updateAssistant(state: ChatState, id: string, patch: (m: AssistantMessage) => AssistantMessage): ChatMessage[] {
	return state.messages.map((m) => (m.role === "assistant" && m.id === id ? patch(m) : m));
}

function updateCard(state: ChatState, approvalId: string, patch: (c: ApprovalCardState) => ApprovalCardState): ApprovalCardState[] {
	return state.approvals.map((c) => (c.approval.id === approvalId ? patch(c) : c));
}

function questionOf(state: ChatState, id: string): string {
	const message = state.messages.find((m) => m.role === "assistant" && m.id === id);
	return message?.role === "assistant" ? message.question : "";
}

const decidedStatus = (decision: Decision): ApprovalCardStatus => (decision === "approve" ? "approved" : "denied");

function answeredMessage(id: string, question: string, data: ChatOk): AssistantMessage {
	return { id, role: "assistant", status: "answered", question, text: data.answer, requestId: data.requestId, trace: data.trace, metrics: data.metrics };
}

function pausedMessage(id: string, question: string, data: ChatPending): AssistantMessage {
	return { id, role: "assistant", status: "paused", question, requestId: data.requestId, trace: data.trace, metrics: data.metrics };
}

function newCard(data: ChatPending): ApprovalCardState {
	return { approval: data.approval, status: "pending", requestId: data.requestId };
}

/**
 * A decisão falhou. Rede/resposta inválida: não sabemos se valeu → volta a
 * `pending` com o erro (tentar de novo recebe 409 se já valeu). 409/410 trazem
 * o estado real. 5xx: a decisão foi registrada, mas a resposta não veio.
 */
function afterFailedDecision(card: ApprovalCardState, decision: Decision, failure: Failure): ApprovalCardState {
	if (failure.kind !== "error") {
		return { ...card, status: "pending", failure };
	}
	const body = "error" in failure.body ? failure.body : undefined;
	switch (failure.code) {
		case "approval_already_decided":
			return { ...card, status: body?.status === "approved" ? "approved" : body?.status === "denied" ? "denied" : "expired", failure: undefined };
		case "approval_expired":
		case "approval_not_found":
			return { ...card, status: "expired", failure: undefined };
		default:
			return failure.status >= 500 ? { ...card, status: decidedStatus(decision), failure } : { ...card, status: "pending", failure };
	}
}

/** Reducer puro da conversa (data-model.md). Nunca muta o estado recebido. */
export function chatReducer(state: ChatState, action: ChatAction): ChatState {
	switch (action.type) {
		case "draft":
			return { ...state, draft: action.text };
		case "send": {
			const text = action.text.trim();
			if (!text || isBusy(state) || hasPendingApproval(state)) {
				return state;
			}
			return {
				...state,
				draft: "",
				messages: [
					...state.messages,
					{ id: `${action.id}-q`, role: "user", text },
					{ id: action.id, role: "assistant", status: "sending", question: text },
				],
			};
		}
		case "answered":
			return {
				...state,
				conversationId: action.data.conversationId,
				messages: updateAssistant(state, action.id, (m) => answeredMessage(m.id, m.question, action.data)),
			};
		case "paused":
			return {
				...state,
				conversationId: action.data.conversationId,
				messages: updateAssistant(state, action.id, (m) => pausedMessage(m.id, m.question, action.data)),
				approvals: [...state.approvals, newCard(action.data)],
			};
		case "failed":
		case "cancelled": {
			const question = questionOf(state, action.id);
			const failure: Failure = action.type === "failed" ? action.failure : { kind: "cancelled" };
			return {
				...state,
				draft: state.draft ? state.draft : question,
				messages: updateAssistant(state, action.id, (m) => ({
					...m,
					status: action.type,
					failure,
					...(failure.kind === "error" || failure.kind === "invalid" ? { requestId: failure.requestId } : {}),
				})),
			};
		}
		case "newConversation":
			return { ...initialChatState(), draft: state.draft };
		case "decide": {
			const card = state.approvals.find((c) => c.approval.id === action.approvalId);
			if (card?.status !== "pending") {
				return state;
			}
			return { ...state, approvals: updateCard(state, action.approvalId, (c) => ({ ...c, status: "deciding", failure: undefined })) };
		}
		case "decided":
			return {
				...state,
				conversationId: action.data.conversationId,
				approvals: updateCard(state, action.approvalId, (c) => ({ ...c, status: decidedStatus(action.decision), failure: undefined })),
				messages: [...state.messages, answeredMessage(action.id, "", action.data)],
			};
		case "decidedPending":
			return {
				...state,
				conversationId: action.data.conversationId,
				approvals: [
					...updateCard(state, action.approvalId, (c) => ({ ...c, status: decidedStatus(action.decision), failure: undefined })),
					newCard(action.data),
				],
				messages: [...state.messages, pausedMessage(action.id, "", action.data)],
			};
		case "decideFailed":
			return { ...state, approvals: updateCard(state, action.approvalId, (c) => afterFailedDecision(c, action.decision, action.failure)) };
		case "expire":
			return {
				...state,
				approvals: updateCard(state, action.approvalId, (c) => (c.status === "pending" ? { ...c, status: "expired", failure: undefined } : c)),
			};
		case "restore": {
			const known = new Set(state.approvals.map((c) => c.approval.id));
			const restored = action.approvals.filter((a) => !known.has(a.id)).map((approval): ApprovalCardState => ({ approval, status: "pending" }));
			return { ...state, approvals: [...state.approvals, ...restored] };
		}
	}
}

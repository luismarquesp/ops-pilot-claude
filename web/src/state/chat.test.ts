import { describe, expect, test } from "vitest";
import { chatReducer, hasPendingApproval, initialChatState, isBusy, type ChatState } from "./chat.js";
import { OK_BODY } from "../test/bodies.js";
import { chatOkSchema, chatPendingSchema } from "../api/schemas.js";
import pendingFixture from "../test/fixtures/chat-202.json";
import decidedFixture from "../test/fixtures/approval-decided-200.json";

const OK = chatOkSchema.parse(OK_BODY);

function sent(state: ChatState = initialChatState(), id = "m1", text = "quais alertas?"): ChatState {
	return chatReducer(chatReducer(state, { type: "draft", text }), { type: "send", id, text });
}

describe("chatReducer — conversa (US1)", () => {
	test("send acrescenta a pergunta e uma resposta em sending, e limpa o rascunho", () => {
		const state = sent();

		expect(state.draft).toBe("");
		expect(state.messages).toEqual([
			{ id: "m1-q", role: "user", text: "quais alertas?" },
			{ id: "m1", role: "assistant", status: "sending", question: "quais alertas?" },
		]);
		expect(isBusy(state)).toBe(true);
	});

	test("answered guarda resposta, rastro, métricas, requestId e conversationId", () => {
		const state = chatReducer(sent(), { type: "answered", id: "m1", data: OK });

		expect(state.conversationId).toBe(OK.conversationId);
		expect(state.messages[1]).toMatchObject({
			status: "answered",
			text: OK.answer,
			trace: OK.trace,
			metrics: OK.metrics,
			requestId: OK.requestId,
		});
		expect(isBusy(state)).toBe(false);
	});

	test("failed mantém a pergunta no rascunho para tentar de novo", () => {
		const failure = { kind: "network" } as const;

		const state = chatReducer(sent(), { type: "failed", id: "m1", failure });

		expect(state.messages[1]).toMatchObject({ status: "failed", failure });
		expect(state.draft).toBe("quais alertas?");
	});

	test("failed não sobrescreve um rascunho novo que o usuário já começou", () => {
		let state = sent();
		state = chatReducer(state, { type: "draft", text: "outra coisa" });

		state = chatReducer(state, { type: "failed", id: "m1", failure: { kind: "network" } });

		expect(state.draft).toBe("outra coisa");
	});

	test("cancelled marca a resposta como cancelada e devolve a pergunta ao rascunho", () => {
		const state = chatReducer(sent(), { type: "cancelled", id: "m1" });

		expect(state.messages[1]).toMatchObject({ status: "cancelled" });
		expect(state.draft).toBe("quais alertas?");
	});

	test("send é recusado enquanto outra resposta está pendente ou o texto está em branco", () => {
		const busy = sent();
		expect(chatReducer(busy, { type: "send", id: "m2", text: "mais" })).toBe(busy);

		const idle = initialChatState();
		expect(chatReducer(idle, { type: "send", id: "m2", text: "   " })).toBe(idle);
	});

	test("newConversation limpa mensagens e id, mantendo o rascunho", () => {
		let state = chatReducer(sent(), { type: "answered", id: "m1", data: OK });
		state = chatReducer(state, { type: "draft", text: "rascunho" });

		state = chatReducer(state, { type: "newConversation" });

		expect(state.messages).toEqual([]);
		expect(state.conversationId).toBeUndefined();
		expect(state.draft).toBe("rascunho");
	});

	test("o reducer não muta o estado anterior", () => {
		const before = sent();
		const snapshot = structuredClone(before);

		chatReducer(before, { type: "answered", id: "m1", data: OK });

		expect(before).toEqual(snapshot);
	});

	test("initialChatState aceita o conversationId salvo", () => {
		expect(initialChatState("c-1").conversationId).toBe("c-1");
	});
});

const PENDING = chatPendingSchema.parse(pendingFixture);
const DECIDED = chatOkSchema.parse(decidedFixture);
const APPROVAL_ID = PENDING.approval.id;

function paused(): ChatState {
	return chatReducer(sent(), { type: "paused", id: "m1", data: PENDING });
}

describe("chatReducer — aprovação (US3)", () => {
	test("paused: a resposta vira 'aguardando aprovação' com rastro e nasce um cartão pending", () => {
		const state = paused();

		expect(state.conversationId).toBe(PENDING.conversationId);
		expect(state.messages[1]).toMatchObject({ status: "paused", trace: PENDING.trace, requestId: PENDING.requestId });
		expect(state.approvals).toEqual([{ approval: PENDING.approval, status: "pending", requestId: PENDING.requestId }]);
		expect(hasPendingApproval(state)).toBe(true);
		expect(isBusy(state)).toBe(false);
	});

	test("com cartão pendente, send é recusado", () => {
		const state = chatReducer(paused(), { type: "draft", text: "outra" });

		expect(chatReducer(state, { type: "send", id: "m2", text: "outra" })).toBe(state);
	});

	test("decide → deciding; decided → approved + resposta final; libera o envio", () => {
		let state = chatReducer(paused(), { type: "decide", approvalId: APPROVAL_ID, decision: "approve" });
		expect(state.approvals[0]?.status).toBe("deciding");
		expect(hasPendingApproval(state)).toBe(true);

		state = chatReducer(state, { type: "decided", approvalId: APPROVAL_ID, decision: "approve", id: "m2", data: DECIDED });

		expect(state.approvals[0]?.status).toBe("approved");
		expect(state.messages.at(-1)).toMatchObject({ id: "m2", role: "assistant", status: "answered", text: DECIDED.answer });
		expect(hasPendingApproval(state)).toBe(false);
	});

	test("decide só vale para cartão pending (sem decisão dupla)", () => {
		const deciding = chatReducer(paused(), { type: "decide", approvalId: APPROVAL_ID, decision: "approve" });

		expect(chatReducer(deciding, { type: "decide", approvalId: APPROVAL_ID, decision: "deny" })).toBe(deciding);
	});

	test("decidedPending: cartão decidido e um novo cartão para a próxima ação", () => {
		const next = { ...PENDING, approval: { ...PENDING.approval, id: "outro", summary: "Resolver o incidente #2" } };

		const state = chatReducer(chatReducer(paused(), { type: "decide", approvalId: APPROVAL_ID, decision: "approve" }), {
			type: "decidedPending",
			approvalId: APPROVAL_ID,
			decision: "approve",
			id: "m2",
			data: next,
		});

		expect(state.approvals.map((c) => [c.approval.id, c.status])).toEqual([
			[APPROVAL_ID, "approved"],
			["outro", "pending"],
		]);
		expect(state.messages.at(-1)).toMatchObject({ id: "m2", status: "paused" });
	});

	test("decideFailed: rede volta a pending com o erro; 409 aplica o status devolvido; 410 expira; 5xx registra a decisão sem resposta", () => {
		const deciding = chatReducer(paused(), { type: "decide", approvalId: APPROVAL_ID, decision: "approve" });
		const error = (status: number, code: string, body: Record<string, unknown> = {}) => ({
			kind: "error" as const,
			status,
			code,
			requestId: "r",
			body: { requestId: "r", error: code, ...body },
		});

		expect(chatReducer(deciding, { type: "decideFailed", approvalId: APPROVAL_ID, decision: "approve", failure: { kind: "network" } }).approvals[0]).toMatchObject({
			status: "pending",
			failure: { kind: "network" },
		});
		expect(
			chatReducer(deciding, { type: "decideFailed", approvalId: APPROVAL_ID, decision: "approve", failure: error(409, "approval_already_decided", { status: "denied" }) })
				.approvals[0]?.status,
		).toBe("denied");
		expect(chatReducer(deciding, { type: "decideFailed", approvalId: APPROVAL_ID, decision: "approve", failure: error(410, "approval_expired") }).approvals[0]?.status).toBe(
			"expired",
		);
		expect(chatReducer(deciding, { type: "decideFailed", approvalId: APPROVAL_ID, decision: "approve", failure: error(504, "timeout") }).approvals[0]).toMatchObject({
			status: "approved",
			failure: { code: "timeout" },
		});
	});

	test("expire marca o cartão pendente como expirado e libera o envio", () => {
		const state = chatReducer(paused(), { type: "expire", approvalId: APPROVAL_ID });

		expect(state.approvals[0]?.status).toBe("expired");
		expect(hasPendingApproval(state)).toBe(false);
	});

	test("restore cria os cartões recuperados; newConversation os descarta", () => {
		let state = chatReducer(initialChatState(PENDING.conversationId, true), { type: "restore", approvals: [PENDING.approval] });

		expect(state.resumed).toBe(true);
		expect(state.approvals).toEqual([{ approval: PENDING.approval, status: "pending" }]);
		state = chatReducer(state, { type: "newConversation" });
		expect(state.approvals).toEqual([]);
		expect(state.resumed).toBe(false);
	});
});

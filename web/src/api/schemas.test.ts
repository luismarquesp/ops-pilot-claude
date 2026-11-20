import { describe, expect, test } from "vitest";
import { approvalListSchema, chatOkSchema, chatPendingSchema, errorBodySchema, traceEventSchema } from "./schemas.js";
import { OK_BODY } from "../test/bodies.js";

describe("chatOkSchema", () => {
	test("aceita o corpo 200 do /chat", () => {
		expect(chatOkSchema.parse(OK_BODY).answer).toBe("Nada disparando.");
	});

	test("recusa corpo fora do contrato", () => {
		expect(chatOkSchema.safeParse({ ...OK_BODY, answer: 42 }).success).toBe(false);
		expect(chatOkSchema.safeParse({ ...OK_BODY, metrics: undefined }).success).toBe(false);
	});
});

describe("traceEventSchema", () => {
	test.each([
		{ type: "thought", content: "pensando", node: "react" },
		{ type: "plan", steps: ["a", "b"], node: "plan-and-execute" },
		{ type: "critique", content: "ok", node: "reflection" },
		{ type: "fallback", from: "a", to: "b", reason: "RateLimitError", node: "react" },
		{ type: "summarize", content: "- x", messagesSummarized: 8, node: "contexto" },
	])("aceita $type", (event) => {
		expect(traceEventSchema.parse(event).type).toBe(event.type);
	});

	test("tipo desconhecido passa pelo ramo genérico, marcado como unknown", () => {
		const parsed = traceEventSchema.parse({ type: "novo", node: "react", extra: 1 });
		expect(parsed).toEqual({ type: "novo", node: "react", unknown: true, raw: { type: "novo", node: "react", extra: 1 } });
	});

	test("tipo conhecido com campos errados não cai no ramo genérico", () => {
		expect(traceEventSchema.safeParse({ type: "action", node: "react" }).success).toBe(false);
	});
});

describe("errorBodySchema", () => {
	test.each([
		{ requestId: "r", issues: [{ path: ["message"], message: "obrigatório" }] },
		{ requestId: "r", error: "conversation_not_found", conversationId: "c" },
		{ requestId: "r", error: "model_unavailable", modelsTried: ["a", "b"] },
		{ requestId: "r", error: "timeout", timeoutMs: 180000 },
		{ requestId: "r", error: "internal_error" },
		{ requestId: "r", error: "unknown_strategy", strategy: "x", available: ["react"] },
	])("aceita %j", (body) => {
		expect(errorBodySchema.safeParse(body).success).toBe(true);
	});
});

describe("fixtures geradas pela API (research §11)", () => {
	const fixtures = import.meta.glob<{ default: Record<string, unknown> }>("../test/fixtures/*.json", { eager: true });

	test("há fixtures para validar", () => {
		expect(Object.keys(fixtures).length).toBeGreaterThanOrEqual(7);
	});

	test.each(Object.entries(fixtures))("%s segue o contrato da web", (name, mod) => {
		const body = mod.default;
		const schema =
			"answer" in body ? chatOkSchema : body.status === "approval_required" ? chatPendingSchema : "approvals" in body ? approvalListSchema : errorBodySchema;
		const parsed = schema.safeParse(body);
		expect(parsed.error?.issues ?? []).toEqual([]);
		if ("trace" in body && (schema === chatOkSchema || schema === chatPendingSchema)) {
			const trace = (schema === chatOkSchema ? chatOkSchema.parse(body) : chatPendingSchema.parse(body)).trace;
			expect(trace.filter((e) => "unknown" in e), `${name} não deve ter passos desconhecidos`).toEqual([]);
		}
	});
});

describe("aprovação (specs/018)", () => {
	test("202 approval_required e a lista de pendentes seguem o contrato", async () => {
		const pending = (await import("../test/fixtures/chat-202.json")).default;
		const list = (await import("../test/fixtures/approvals-list.json")).default;

		expect(chatPendingSchema.parse(pending).approval.summary).toBe("Resolver o incidente #1");
		expect(approvalListSchema.parse(list).approvals[0]?.status).toBe("pending");
	});

	test.each([
		{ requestId: "r", error: "approval_not_found", approvalId: "a" },
		{ requestId: "r", error: "approval_already_decided", approvalId: "a", status: "approved" },
		{ requestId: "r", error: "approval_expired", approvalId: "a" },
	])("erro %j segue o contrato", (body) => {
		expect(errorBodySchema.safeParse(body).success).toBe(true);
	});
});

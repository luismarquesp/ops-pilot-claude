import { describe, expect, test } from "vitest";
import { describeError } from "./errors.js";
import type { ApiError } from "./client.js";

function apiError(code: string, body: Record<string, unknown> = {}, status = 500): ApiError {
	return { kind: "error", status, code, requestId: "req-1", body: { requestId: "req-1", error: code, ...body } };
}

const CTX = { apiUrl: "http://localhost:3000" };

describe("describeError — tabela das design instructions", () => {
	test.each([
		[apiError("model_unavailable", { modelsTried: ["a/b", "c/d:free"] }, 503), "Nenhum modelo respondeu.", "Tentamos: a/b, c/d:free.", "retry"],
		[apiError("timeout", { timeoutMs: 180000 }, 504), "A resposta passou de 3 minutos.", undefined, "retry"],
		[apiError("conversation_not_found", {}, 404), "Essa conversa não existe mais.", undefined, "new_conversation"],
		[apiError("unknown_strategy", { available: ["react", "reflection"] }, 422), "Estratégia inválida.", "Disponíveis: react, reflection.", "fix"],
		[apiError("secret_detected", {}, 422), "Esse texto parece conter um segredo e não foi salvo.", undefined, "fix"],
		[apiError("internal_error", {}, 500), "Algo deu errado do nosso lado.", undefined, "retry"],
		[apiError("approval_not_found", {}, 404), "Essa aprovação não existe mais.", undefined, "none"],
		[apiError("approval_already_decided", { status: "approved" }, 409), "Essa ação já foi decidida.", undefined, "none"],
		[apiError("approval_expired", {}, 410), "A aprovação expirou e a ação não foi executada.", undefined, "none"],
		[apiError("codigo_novo", {}, 500), "Algo deu errado do nosso lado.", undefined, "retry"],
	])("%#: %s", (failure, title, detail, action) => {
		const info = describeError(failure, CTX);

		expect(info.title).toBe(title);
		expect(info.detail).toBe(detail);
		expect(info.action).toBe(action);
		expect(info.requestId).toBe("req-1");
	});

	test("400 de validação pede para revisar a pergunta", () => {
		const failure: ApiError = { kind: "error", status: 400, code: "validation", requestId: "r", body: { requestId: "r", issues: [] } };

		expect(describeError(failure, CTX)).toMatchObject({ title: "A pergunta não foi aceita.", action: "fix" });
	});

	test("rede, resposta inválida e cancelamento têm mensagens próprias", () => {
		expect(describeError({ kind: "network" }, CTX)).toEqual({
			title: "Não foi possível falar com a API.",
			detail: "Confira o endereço http://localhost:3000 nas configurações.",
			action: "settings",
			requestId: undefined,
		});
		expect(describeError({ kind: "invalid", status: 200, requestId: "hdr" }, CTX)).toMatchObject({
			title: "Resposta inesperada da API.",
			action: "retry",
			requestId: "hdr",
		});
		expect(describeError({ kind: "cancelled" }, CTX)).toMatchObject({
			title: "Espera cancelada.",
			action: "retry",
		});
	});

	test("nenhuma mensagem vaza stack, 'Error:' ou JSON cru", () => {
		const failures = [apiError("internal_error"), apiError("x"), { kind: "network" } as const];
		for (const failure of failures) {
			const { title, detail } = describeError(failure, CTX);
			expect(`${title} ${detail ?? ""}`).not.toMatch(/at \w+ \(|Error:|[{}]/);
		}
	});
});

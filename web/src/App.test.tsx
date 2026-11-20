import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { App } from "./App.js";
import { CONVERSATION_ID, okBody } from "./test/bodies.js";
import { fakeFetch, freshFixture, json, memoryStorage } from "./test/http.js";
import pendingFixture from "./test/fixtures/chat-202.json";
import decidedFixture from "./test/fixtures/approval-decided-200.json";
import approvalsFixture from "./test/fixtures/approvals-list.json";

const pendingFixtureBody = () => freshFixture(pendingFixture);
const decidedFixtureBody = () => structuredClone(decidedFixture);
const approvalsListBody = () => freshFixture(approvalsFixture);

function bodyOf(init: RequestInit | undefined): Record<string, unknown> {
	return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

test("App mostra o título da war room e a área principal", () => {
	render(<App fetch={fakeFetch()} storage={memoryStorage()} />);

	expect(screen.getByRole("heading", { level: 1, name: /OpsPilot/ })).toBeInTheDocument();
	expect(screen.getByRole("main")).toBeInTheDocument();
});

describe("conversa (US1)", () => {
	test("pergunta → resposta; a segunda pergunta reaproveita a conversa", async () => {
		const user = userEvent.setup();
		const fetchMock = fakeFetch(
			() => json(200, okBody("Nada disparando.")),
			() => json(200, okBody("Continua tudo calmo.")),
		);
		const storage = memoryStorage();
		render(<App fetch={fetchMock} storage={storage} />);

		await user.type(screen.getByLabelText("Pergunta"), "quais alertas?{Enter}");
		expect(await screen.findByText("Nada disparando.")).toBeInTheDocument();
		await user.type(screen.getByLabelText("Pergunta"), "e agora?{Enter}");
		expect(await screen.findByText("Continua tudo calmo.")).toBeInTheDocument();

		const [firstUrl, first] = fetchMock.mock.calls[0]!;
		expect(firstUrl).toBe("http://localhost:3000/chat");
		expect(bodyOf(first)).toEqual({ message: "quais alertas?" });
		expect(bodyOf(fetchMock.mock.calls[1]![1])).toEqual({ message: "e agora?", conversationId: CONVERSATION_ID });
		expect(storage.data.get("opspilot.conversationId")).toBe(CONVERSATION_ID);
	});

	test("503 mostra erro humano com requestId e mantém o texto no campo", async () => {
		const user = userEvent.setup();
		render(
			<App fetch={fakeFetch(() => json(503, { requestId: "req-503", error: "model_unavailable", modelsTried: ["a"] }))} storage={memoryStorage()} />,
		);

		await user.type(screen.getByLabelText("Pergunta"), "quais alertas?{Enter}");

		const alert = await screen.findByRole("alert");
		expect(alert).toHaveTextContent("Nenhum modelo respondeu.");
		expect(within(alert).getByText("req-503")).toBeInTheDocument();
		expect(screen.getByLabelText("Pergunta")).toHaveValue("quais alertas?");
	});

	test("Tentar de novo reenvia a mesma pergunta", async () => {
		const user = userEvent.setup();
		const fetchMock = fakeFetch(
			() => json(504, { requestId: "r", error: "timeout", timeoutMs: 180000 }),
			() => json(200, okBody("Agora foi.")),
		);
		render(<App fetch={fetchMock} storage={memoryStorage()} />);

		await user.type(screen.getByLabelText("Pergunta"), "quais alertas?{Enter}");
		await user.click(await screen.findByRole("button", { name: "Tentar de novo" }));

		expect(await screen.findByText("Agora foi.")).toBeInTheDocument();
		expect(bodyOf(fetchMock.mock.calls[1]![1])).toEqual({ message: "quais alertas?" });
	});

	test("Nova conversa limpa a lista e a próxima pergunta vai sem conversationId", async () => {
		const user = userEvent.setup();
		const fetchMock = fakeFetch(
			() => json(200, okBody("Primeira.")),
			() => json(200, okBody("Segunda.", { conversationId: "5b1f3c2e-0000-4000-8000-000000000002" })),
		);
		const storage = memoryStorage();
		render(<App fetch={fetchMock} storage={storage} />);

		await user.type(screen.getByLabelText("Pergunta"), "um{Enter}");
		await screen.findByText("Primeira.");
		await user.click(screen.getByRole("button", { name: "Nova conversa" }));

		expect(screen.queryByText("Primeira.")).not.toBeInTheDocument();
		expect(storage.data.has("opspilot.conversationId")).toBe(false);
		await user.type(screen.getByLabelText("Pergunta"), "dois{Enter}");
		await screen.findByText("Segunda.");
		expect(bodyOf(fetchMock.mock.calls[1]![1])).toEqual({ message: "dois" });
	});

	test("Cancelar interrompe a espera e devolve a pergunta ao campo", async () => {
		const user = userEvent.setup();
		const fetchMock = fakeFetch(
			(_url, init) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
				}),
		);
		render(<App fetch={fetchMock} storage={memoryStorage()} />);

		await user.type(screen.getByLabelText("Pergunta"), "demorado{Enter}");
		await user.click(await screen.findByRole("button", { name: "Cancelar" }, { timeout: 2000 }));

		await waitFor(() => expect(screen.getByLabelText("Pergunta")).toHaveValue("demorado"));
		expect(screen.getByText(/Espera cancelada/)).toBeInTheDocument();
	});

	test("exemplo do estado vazio envia a pergunta", async () => {
		const user = userEvent.setup();
		const fetchMock = fakeFetch(() => json(200, okBody("Nada disparando.")));
		render(<App fetch={fetchMock} storage={memoryStorage()} />);

		await user.click(screen.getByRole("button", { name: "Quais alertas estão disparando?" }));

		expect(await screen.findByText("Nada disparando.")).toBeInTheDocument();
		expect(bodyOf(fetchMock.mock.calls[0]![1])).toEqual({ message: "Quais alertas estão disparando?" });
	});
});

describe("ver raciocínio (US2)", () => {
	test("o botão abre o rastro da resposta; Esc fecha e devolve o foco ao botão", async () => {
		const user = userEvent.setup();
		render(<App fetch={fakeFetch(() => json(200, okBody("Nada disparando.")))} storage={memoryStorage()} />);

		await user.type(screen.getByLabelText("Pergunta"), "quais alertas?{Enter}");
		const button = await screen.findByRole("button", { name: "Ver raciocínio" });
		await user.click(button);

		const dialog = screen.getByRole("dialog", { name: "Raciocínio" });
		expect(within(dialog).getByText("list_alerts")).toBeInTheDocument();
		await user.keyboard("{Escape}");
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(button).toHaveFocus();
	});

	test("resposta com erro não oferece Ver raciocínio", async () => {
		const user = userEvent.setup();
		render(<App fetch={fakeFetch(() => json(500, { requestId: "r", error: "internal_error" }))} storage={memoryStorage()} />);

		await user.type(screen.getByLabelText("Pergunta"), "oi{Enter}");
		await screen.findByRole("alert");

		expect(screen.queryByRole("button", { name: "Ver raciocínio" })).not.toBeInTheDocument();
	});
});

describe("aprovação (US3)", () => {
	const pending = () => json(202, pendingFixtureBody());
	const decided = () => json(200, decidedFixtureBody());

	test("202 vira cartão e bloqueia o envio; Negar envia a decisão e mostra a resposta final", async () => {
		const user = userEvent.setup();
		const fetchMock = fakeFetch(pending, decided);
		render(<App fetch={fetchMock} storage={memoryStorage()} />);

		await user.type(screen.getByLabelText("Pergunta"), "resolva o incidente 1{Enter}");
		const region = await screen.findByRole("region", { name: "Aprovação necessária" });
		expect(region).toHaveTextContent("Resolver o incidente #1");
		expect(screen.getByLabelText("Pergunta")).toBeDisabled();
		expect(screen.getByText(/Decida a aprovação pendente/)).toBeInTheDocument();

		await user.click(within(region).getByRole("button", { name: "Negar" }));

		expect(await within(region).findByText(/Negada — nada foi executado/)).toBeInTheDocument();
		const [url, init] = fetchMock.mock.calls[1]!;
		expect(url).toBe(`http://localhost:3000/chat/approvals/${pendingFixtureBody().approval.id}`);
		expect(bodyOf(init)).toEqual({ decision: "deny" });
		expect(await screen.findByText(/Aprovado pelo plantonista e executado/)).toBeInTheDocument();
		expect(screen.getByLabelText("Pergunta")).toBeEnabled();
	});

	test("recarregar com conversa salva busca as aprovações pendentes e o cartão volta", async () => {
		const storage = memoryStorage({ "opspilot.conversationId": pendingFixtureBody().conversationId });
		const fetchMock = fakeFetch(() => json(200, approvalsListBody()));
		render(<App fetch={fetchMock} storage={storage} />);

		const region = await screen.findByRole("region", { name: "Aprovação necessária" });
		expect(region).toHaveTextContent("Resolver o incidente #1");
		expect(screen.getByText(/Conversa retomada/)).toBeInTheDocument();
		expect(fetchMock.mock.calls[0]![0]).toBe(`http://localhost:3000/chat/approvals?conversationId=${pendingFixtureBody().conversationId}`);
	});

	test("recarregar sem aprovações pendentes só avisa que a conversa foi retomada", async () => {
		const storage = memoryStorage({ "opspilot.conversationId": pendingFixtureBody().conversationId });
		render(<App fetch={fakeFetch(() => json(200, { requestId: "r", approvals: [] }))} storage={storage} />);

		expect(await screen.findByText(/Conversa retomada/)).toBeInTheDocument();
		await waitFor(() => expect(screen.queryByRole("region", { name: "Aprovação necessária" })).not.toBeInTheDocument());
		expect(screen.getByLabelText("Pergunta")).toBeEnabled();
	});
});

describe("configurações (US4)", () => {
	test("engrenagem abre as configurações; salvar outra URL inicia conversa nova e as chamadas vão para ela", async () => {
		const user = userEvent.setup();
		const fetchMock = fakeFetch(
			() => json(200, okBody("Na API antiga.")),
			() => json(200, okBody("Na API nova.", { conversationId: "5b1f3c2e-0000-4000-8000-000000000003" })),
		);
		const storage = memoryStorage();
		render(<App fetch={fetchMock} storage={storage} />);

		await user.type(screen.getByLabelText("Pergunta"), "um{Enter}");
		await screen.findByText("Na API antiga.");
		await user.click(screen.getByRole("button", { name: "Configurações" }));
		const input = screen.getByLabelText("Endereço da API");
		await user.clear(input);
		await user.type(input, "http://localhost:4000");
		await user.click(screen.getByRole("button", { name: "Salvar" }));

		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(screen.queryByText("Na API antiga.")).not.toBeInTheDocument();
		expect(storage.data.get("opspilot.apiUrl")).toBe("http://localhost:4000");
		await user.type(screen.getByLabelText("Pergunta"), "dois{Enter}");
		await screen.findByText("Na API nova.");
		const [url, init] = fetchMock.mock.calls[1]!;
		expect(url).toBe("http://localhost:4000/chat");
		expect(bodyOf(init)).toEqual({ message: "dois" });
	});

	test("tema salvo aplica data-theme no <html>; sistema remove", async () => {
		const user = userEvent.setup();
		render(<App fetch={fakeFetch()} storage={memoryStorage({ "opspilot.theme": "dark" })} />);
		expect(document.documentElement).toHaveAttribute("data-theme", "dark");

		await user.click(screen.getByRole("button", { name: "Configurações" }));
		await user.click(screen.getByRole("radio", { name: "Sistema" }));
		await user.click(screen.getByRole("button", { name: "Salvar" }));

		expect(document.documentElement).not.toHaveAttribute("data-theme");
	});

	test("erro de rede oferece abrir as configurações", async () => {
		const user = userEvent.setup();
		render(
			<App
				fetch={fakeFetch(() => {
					throw new TypeError("Failed to fetch");
				})}
				storage={memoryStorage()}
			/>,
		);

		await user.type(screen.getByLabelText("Pergunta"), "oi{Enter}");
		await user.click(await screen.findByRole("button", { name: "Abrir configurações" }));

		expect(screen.getByRole("dialog", { name: "Configurações" })).toBeInTheDocument();
	});
});

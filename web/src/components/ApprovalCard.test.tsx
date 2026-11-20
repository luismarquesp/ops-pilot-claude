import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ApprovalCard } from "./ApprovalCard.js";
import { chatPendingSchema } from "../api/schemas.js";
import type { ApprovalCardState } from "../state/chat.js";
import { expectNoA11yViolations } from "../test/axe.js";
import pendingFixture from "../test/fixtures/chat-202.json";

const { approval } = chatPendingSchema.parse(pendingFixture);
const CREATED = Date.parse(approval.createdAt);

function card(overrides: Partial<ApprovalCardState> = {}): ApprovalCardState {
	return { approval, status: "pending", ...overrides };
}

describe("ApprovalCard", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	test("descreve a ação em linguagem humana; detalhes técnicos recolhidos; Aprovar é a ação primária", async () => {
		const user = userEvent.setup();
		const { container } = render(<ApprovalCard card={card()} now={() => CREATED} onDecide={() => {}} onExpire={() => {}} />);

		const region = screen.getByRole("region", { name: "Aprovação necessária" });
		expect(region).toHaveTextContent("Resolver o incidente #1");
		const details = screen.getByText("Detalhes técnicos").closest("details")!;
		expect(details).not.toHaveAttribute("open");
		await user.click(screen.getByText("Detalhes técnicos"));
		expect(details).toHaveTextContent("resolve_incident");
		expect(details).toHaveTextContent('"id": 1');
		expect(screen.getByRole("button", { name: "Aprovar" })).toHaveClass("btn-primary");
		expect(screen.getByRole("button", { name: "Negar" })).not.toHaveClass("btn-primary");
		expect(screen.getByText("Expira em 15:00")).toBeInTheDocument();
		await expectNoA11yViolations(container);
	});

	test("clique duplo gera uma única decisão", async () => {
		const user = userEvent.setup();
		const onDecide = vi.fn();
		render(<ApprovalCard card={card()} now={() => CREATED} onDecide={onDecide} onExpire={() => {}} />);

		await user.dblClick(screen.getByRole("button", { name: "Aprovar" }));

		expect(onDecide).toHaveBeenCalledTimes(1);
		expect(onDecide).toHaveBeenCalledWith("approve");
	});

	test.each([
		["deciding", /Registrando a decisão/],
		["approved", /Aprovada — ação executada/],
		["denied", /Negada — nada foi executado/],
		["expired", /Expirada — nada foi executado/],
	] as const)("estado %s: texto próprio e botões desativados ou ausentes", (status, text) => {
		render(<ApprovalCard card={card({ status })} now={() => CREATED} onDecide={() => {}} onExpire={() => {}} />);

		expect(screen.getByText(text)).toBeInTheDocument();
		const approve = screen.queryByRole("button", { name: "Aprovar" });
		if (approve) expect(approve).toBeDisabled();
	});

	test("falha ao decidir mostra o erro e mantém os botões disponíveis", () => {
		render(
			<ApprovalCard card={card({ failure: { kind: "network" } })} apiUrl="http://localhost:3000" now={() => CREATED} onDecide={() => {}} onExpire={() => {}} />,
		);

		expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível falar com a API.");
		expect(screen.getByRole("button", { name: "Aprovar" })).toBeEnabled();
	});

	test("decisão registrada sem resposta (5xx) avisa que a resposta não veio", () => {
		const failure = { kind: "error" as const, status: 504, code: "timeout", requestId: "r", body: { requestId: "r", error: "timeout" } };
		render(<ApprovalCard card={card({ status: "approved", failure })} now={() => CREATED} onDecide={() => {}} onExpire={() => {}} />);

		expect(screen.getByText(/Decisão registrada, mas a resposta do copiloto não veio/)).toBeInTheDocument();
	});

	test("a contagem chega a zero e avisa a expiração", async () => {
		vi.useFakeTimers();
		let clock = CREATED + 14 * 60_000 + 58_000;
		const onExpire = vi.fn();
		render(<ApprovalCard card={card()} now={() => clock} onDecide={() => {}} onExpire={onExpire} />);

		expect(screen.getByText("Expira em 0:02")).toBeInTheDocument();
		clock += 3_000;
		await act(async () => {
			vi.advanceTimersByTime(1_000);
		});

		expect(onExpire).toHaveBeenCalledTimes(1);
	});
});

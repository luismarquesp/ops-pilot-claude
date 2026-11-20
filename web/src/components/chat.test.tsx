import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MessageList } from "./MessageList.js";
import { Composer } from "./Composer.js";
import { PendingIndicator } from "./PendingIndicator.js";
import { ErrorNotice } from "./ErrorNotice.js";
import { expectNoA11yViolations } from "../test/axe.js";
import type { ChatMessage } from "../state/chat.js";

const noop = () => {};

function listProps(messages: ChatMessage[]) {
	return { messages, resumed: false, apiUrl: "http://localhost:3000", onExample: noop, onRetry: noop, onNewConversation: noop, onOpenSettings: noop, onCancel: noop };
}

describe("MessageList", () => {
	test("estado vazio explica o que perguntar e os exemplos disparam onExample", async () => {
		const user = userEvent.setup();
		const onExample = vi.fn();
		const { container } = render(<MessageList {...listProps([])} onExample={onExample} />);

		expect(screen.getByRole("heading", { name: "Pergunte ao OpsPilot" })).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Quais alertas estão disparando?" }));

		expect(onExample).toHaveBeenCalledWith("Quais alertas estão disparando?");
		await expectNoA11yViolations(container);
	});

	test("mensagens ficam num log com aria-live; resposta em Markdown sem HTML cru", async () => {
		const messages: ChatMessage[] = [
			{ id: "1-q", role: "user", text: "linha 1\nlinha 2" },
			{ id: "1", role: "assistant", status: "answered", question: "x", text: "**Ok**\n\n- item\n\n<img src=x onerror=alert(1)>" },
		];
		const { container } = render(<MessageList {...listProps(messages)} />);

		const log = screen.getByRole("log");
		expect(log).toHaveAttribute("aria-live", "polite");
		expect(screen.getByText("Ok").tagName).toBe("STRONG");
		expect(screen.getByRole("listitem")).toHaveTextContent("item");
		expect(container.querySelector("img")).toBeNull();
		expect(screen.getByText(/linha 1/)).toHaveStyle({ whiteSpace: "pre-wrap" });
		await expectNoA11yViolations(container);
	});

	test("lista marca aria-busy enquanto há resposta pendente", () => {
		render(<MessageList {...listProps([{ id: "1", role: "assistant", status: "sending", question: "x" }])} />);

		expect(screen.getByRole("log")).toHaveAttribute("aria-busy", "true");
	});

	test("conversa retomada mostra o aviso", () => {
		render(<MessageList {...listProps([])} resumed />);

		expect(screen.getByText(/Conversa retomada/)).toBeInTheDocument();
	});
});

describe("Composer", () => {
	test("rótulo visível, envio desativado em branco, Enter envia e Shift+Enter quebra linha", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();
		function Harness() {
			const [value, setValue] = useStateValue("");
			return <Composer value={value} onChange={setValue} onSubmit={onSubmit} />;
		}
		const { container } = render(<Harness />);
		const box = screen.getByLabelText("Pergunta");

		expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
		await user.type(box, "   ");
		await user.keyboard("{Enter}");
		expect(onSubmit).not.toHaveBeenCalled();

		await user.clear(box);
		await user.type(box, "linha 1{Shift>}{Enter}{/Shift}linha 2");
		expect(box).toHaveValue("linha 1\nlinha 2");
		await user.keyboard("{Enter}");
		expect(onSubmit).toHaveBeenCalledTimes(1);
		await expectNoA11yViolations(container);
	});

	test("bloqueado mostra o motivo e desativa o campo", () => {
		render(<Composer value="x" onChange={noop} onSubmit={noop} blockedReason="Decida a aprovação pendente antes de perguntar de novo." />);

		expect(screen.getByLabelText("Pergunta")).toBeDisabled();
		expect(screen.getByText("Decida a aprovação pendente antes de perguntar de novo.")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
	});
});

describe("PendingIndicator", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	test("só aparece depois de 300ms, conta os segundos e oferece Cancelar", async () => {
		vi.useFakeTimers();
		const onCancel = vi.fn();
		render(<PendingIndicator startedAt={Date.now()} onCancel={onCancel} />);

		expect(screen.queryByText(/Pensando/)).not.toBeInTheDocument();
		await act(async () => {
			vi.advanceTimersByTime(350);
		});
		expect(screen.getByText(/Pensando… 0s/)).toBeInTheDocument();
		await act(async () => {
			vi.advanceTimersByTime(12_000);
		});
		expect(screen.getByText(/Pensando… 12s/)).toBeInTheDocument();

		screen.getByRole("button", { name: "Cancelar" }).click();
		expect(onCancel).toHaveBeenCalledTimes(1);
	});
});

describe("ErrorNotice", () => {
	test("mostra título, detalhe, ação e requestId copiável", async () => {
		const user = userEvent.setup();
		const onAction = vi.fn();
		const writeText = vi.fn(async () => {});
		Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
		const { container } = render(
			<ErrorNotice info={{ title: "Nenhum modelo respondeu.", detail: "Tentamos: a.", action: "retry", requestId: "req-42" }} onAction={onAction} />,
		);

		expect(screen.getByRole("alert")).toHaveTextContent("Nenhum modelo respondeu.");
		expect(screen.getByText("Tentamos: a.")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Tentar de novo" }));
		expect(onAction).toHaveBeenCalledWith("retry");
		await user.click(screen.getByRole("button", { name: /Copiar id da requisição/ }));
		expect(writeText).toHaveBeenCalledWith("req-42");
		await expectNoA11yViolations(container);
	});

	test("sem ação não mostra botão de ação", () => {
		render(<ErrorNotice info={{ title: "Essa ação já foi decidida.", action: "none", requestId: undefined }} onAction={noop} />);

		expect(screen.queryByRole("button")).not.toBeInTheDocument();
	});
});

/** Pequeno estado controlado para o Composer. */
function useStateValue(initial: string): [string, (v: string) => void] {
	const [value, setValue] = useState(initial);
	return [value, setValue];
}

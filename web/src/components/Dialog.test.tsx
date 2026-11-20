import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { Dialog } from "./Dialog.js";
import { expectNoA11yViolations } from "../test/axe.js";

function Harness() {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button type="button" onClick={() => setOpen(true)}>
				Abrir
			</button>
			<Dialog open={open} title="Detalhes" onClose={() => setOpen(false)}>
				<button type="button">Primeiro</button>
				<button type="button">Último</button>
			</Dialog>
		</>
	);
}

test("abre com o foco dentro, prende o Tab e Esc fecha devolvendo o foco ao gatilho", async () => {
	const user = userEvent.setup();
	render(<Harness />);
	const trigger = screen.getByRole("button", { name: "Abrir" });

	await user.click(trigger);
	const dialog = screen.getByRole("dialog", { name: "Detalhes" });
	expect(dialog).toHaveAttribute("aria-modal", "true");
	expect(dialog.contains(document.activeElement)).toBe(true);

	for (let i = 0; i < 5; i += 1) {
		await user.tab();
		expect(dialog.contains(document.activeElement)).toBe(true);
	}
	await user.tab({ shift: true });
	expect(dialog.contains(document.activeElement)).toBe(true);

	await user.keyboard("{Escape}");
	expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	expect(trigger).toHaveFocus();
});

test("o botão Fechar fecha o diálogo; fechado não renderiza nada", async () => {
	const user = userEvent.setup();
	render(<Harness />);
	expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

	await user.click(screen.getByRole("button", { name: "Abrir" }));
	await user.click(screen.getByRole("button", { name: "Fechar" }));

	expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("diálogo aberto sem violações de acessibilidade", async () => {
	const user = userEvent.setup();
	const { container } = render(<Harness />);
	await user.click(screen.getByRole("button", { name: "Abrir" }));

	await expectNoA11yViolations(container);
});

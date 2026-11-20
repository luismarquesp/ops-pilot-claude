import { render, screen, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { expect, test } from "vitest";
import { App } from "./App.js";
import { fakeFetch, freshFixture, json, memoryStorage } from "./test/http.js";
import pendingFixture from "./test/fixtures/chat-202.json";
import decidedFixture from "./test/fixtures/approval-decided-200.json";

/** Aperta Tab até o foco chegar no elemento (no máximo 40 vezes). */
async function tabTo(user: UserEvent, target: HTMLElement): Promise<void> {
	for (let i = 0; i < 40 && document.activeElement !== target; i += 1) {
		await user.tab();
	}
	expect(document.activeElement).toBe(target);
}

/** SC-006: perguntar → ver raciocínio → aprovar → configurar, só com o teclado. */
test("o fluxo inteiro funciona só com o teclado", async () => {
	const user = userEvent.setup();
	render(
		<App fetch={fakeFetch(() => json(202, freshFixture(pendingFixture)), () => json(200, structuredClone(decidedFixture)))} storage={memoryStorage()} />,
	);

	// Perguntar
	await tabTo(user, screen.getByLabelText("Pergunta"));
	await user.keyboard("resolva o incidente 1{Enter}");
	const card = await screen.findByRole("region", { name: "Aprovação necessária" });

	// Ver raciocínio: Enter abre, Esc fecha e devolve o foco
	const traceButton = screen.getByRole("button", { name: "Ver raciocínio" });
	await tabTo(user, traceButton);
	await user.keyboard("{Enter}");
	expect(screen.getByRole("dialog", { name: "Raciocínio" })).toBeInTheDocument();
	await user.keyboard("{Escape}");
	expect(traceButton).toHaveFocus();

	// Aprovar
	await tabTo(user, within(card).getByRole("button", { name: "Aprovar" }));
	await user.keyboard("{Enter}");
	expect(await within(card).findByText(/Aprovada — ação executada/)).toBeInTheDocument();

	// Configurar
	const gear = screen.getByRole("button", { name: "Configurações" });
	await tabTo(user, gear);
	await user.keyboard("{Enter}");
	expect(screen.getByRole("dialog", { name: "Configurações" })).toBeInTheDocument();
	await user.keyboard("{Escape}");
	expect(gear).toHaveFocus();
});

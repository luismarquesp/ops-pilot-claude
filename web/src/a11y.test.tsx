import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { App } from "./App.js";
import { fakeFetch, freshFixture, json, memoryStorage } from "./test/http.js";
import { expectNoA11yViolations } from "./test/axe.js";
import { okBody } from "./test/bodies.js";
import pendingFixture from "./test/fixtures/chat-202.json";

/**
 * SC-005: as telas principais (conversa, raciocínio, cartão e configurações)
 * sem violações do axe nos dois temas. O contraste das cores é verificado nos
 * tokens (styles/contrast.test.ts), porque o jsdom não calcula cor.
 */
describe.each(["light", "dark"] as const)("acessibilidade no tema %s", (theme) => {
	test("conversa com resposta, cartão pendente, raciocínio aberto e configurações", async () => {
		const user = userEvent.setup();
		const { baseElement } = render(
			<App
				fetch={fakeFetch(
					() => json(200, okBody("Há **1 alerta**:\n\n- pagamentos")),
					() => json(202, freshFixture(pendingFixture)),
				)}
				storage={memoryStorage({ "opspilot.theme": theme })}
			/>,
		);
		expect(document.documentElement).toHaveAttribute("data-theme", theme);
		await expectNoA11yViolations(baseElement);

		await user.type(screen.getByLabelText("Pergunta"), "quais alertas?{Enter}");
		await screen.findByText("1 alerta");
		await user.type(screen.getByLabelText("Pergunta"), "resolva o 1{Enter}");
		await screen.findByRole("region", { name: "Aprovação necessária" });
		await expectNoA11yViolations(baseElement);

		await user.click(screen.getAllByRole("button", { name: "Ver raciocínio" })[0]!);
		await expectNoA11yViolations(baseElement);
		await user.keyboard("{Escape}");

		await user.click(screen.getByRole("button", { name: "Configurações" }));
		await expectNoA11yViolations(baseElement);
	});
});

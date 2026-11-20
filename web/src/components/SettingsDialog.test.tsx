import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { SettingsDialog } from "./SettingsDialog.js";
import type { ConnectionResult } from "../api/client.js";
import { expectNoA11yViolations } from "../test/axe.js";

const SETTINGS = { apiUrl: "http://localhost:3000", theme: "system" as const };

function setup(result: ConnectionResult = { kind: "connected" }) {
	const onSave = vi.fn();
	const onClose = vi.fn();
	const test = vi.fn(async () => result);
	const utils = render(
		<SettingsDialog open settings={SETTINGS} defaultApiUrl="http://localhost:3000" onSave={onSave} onClose={onClose} testConnection={test} origin="http://localhost:5173" />,
	);
	return { ...utils, onSave, onClose, test };
}

describe("SettingsDialog", () => {
	test("mostra o endereço atual e o padrão; diálogo acessível", async () => {
		const { baseElement } = setup();

		expect(screen.getByRole("dialog", { name: "Configurações" })).toBeInTheDocument();
		expect(screen.getByLabelText("Endereço da API")).toHaveValue("http://localhost:3000");
		expect(screen.getByLabelText("Endereço da API")).toHaveAccessibleDescription(/Padrão: http:\/\/localhost:3000/);
		await expectNoA11yViolations(baseElement);
	});

	test("URL inválida: erro junto ao campo (aria-invalid + aria-describedby) e nada é salvo", async () => {
		const user = userEvent.setup();
		const { onSave } = setup();
		const input = screen.getByLabelText("Endereço da API");

		await user.clear(input);
		await user.type(input, "ftp://x");
		await user.click(screen.getByRole("button", { name: "Salvar" }));

		expect(onSave).not.toHaveBeenCalled();
		expect(input).toHaveAttribute("aria-invalid", "true");
		const errorId = input.getAttribute("aria-describedby")!.split(" ").find((id) => document.getElementById(id)?.classList.contains("field-error"));
		expect(document.getElementById(errorId!)).toHaveTextContent("Use um endereço http:// ou https:// válido.");
	});

	test("salvar envia o endereço normalizado e o tema escolhido", async () => {
		const user = userEvent.setup();
		const { onSave } = setup();
		const input = screen.getByLabelText("Endereço da API");

		await user.clear(input);
		await user.type(input, "https://ops.example.com/");
		await user.click(screen.getByRole("radio", { name: "Escuro" }));
		await user.click(screen.getByRole("button", { name: "Salvar" }));

		expect(onSave).toHaveBeenCalledWith({ apiUrl: "https://ops.example.com", theme: "dark" });
	});

	test.each([
		[{ kind: "connected" } as const, /Conectado/],
		[{ kind: "cors_blocked" } as const, /não permite acesso a partir desta origem.*http:\/\/localhost:5173.*CORS_ORIGINS/],
		[{ kind: "unreachable" } as const, /API inacessível em http:\/\/localhost:3000/],
		[{ kind: "unexpected", status: 404 } as const, /status 404/],
	])("Testar conexão mostra %j", async (result, text) => {
		const user = userEvent.setup();
		const { test: testFn } = setup(result);

		await user.click(screen.getByRole("button", { name: "Testar conexão" }));

		expect(testFn).toHaveBeenCalledWith("http://localhost:3000");
		expect(await screen.findByRole("status")).toHaveTextContent(text);
	});
});

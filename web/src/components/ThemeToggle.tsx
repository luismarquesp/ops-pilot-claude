import { useId } from "react";
import type { Theme } from "../config.js";

const OPTIONS: Array<{ value: Theme; label: string }> = [
	{ value: "light", label: "Claro" },
	{ value: "dark", label: "Escuro" },
	{ value: "system", label: "Sistema" },
];

/** Tema da war room: claro, escuro ou o do sistema operacional. */
export function ThemeToggle({ value, onChange }: { value: Theme; onChange: (theme: Theme) => void }) {
	const name = useId();
	return (
		<fieldset className="field">
			<legend>Tema</legend>
			<div className="radio-row">
				{OPTIONS.map((option) => (
					<label key={option.value}>
						<input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
						{option.label}
					</label>
				))}
			</div>
		</fieldset>
	);
}

/** Aplica o tema no `<html>` (pura no efeito: `system` remove o atributo). */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
	if (theme === "system") {
		root.removeAttribute("data-theme");
	} else {
		root.setAttribute("data-theme", theme);
	}
}

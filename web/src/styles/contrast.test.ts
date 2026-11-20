import { describe, expect, test } from "vitest";
import css from "./tokens.css?raw";
import { contrastRatio, parseThemes } from "./contrast.js";

const themes = parseThemes(css);

/** Texto (≥ 4.5:1) e componentes/foco (≥ 3:1), WCAG 2.2 AA. */
const TEXT_PAIRS: Array<[string, string]> = [
	["--color-text", "--color-bg"],
	["--color-text", "--color-surface"],
	["--color-text", "--color-surface-raised"],
	["--color-muted", "--color-bg"],
	["--color-muted", "--color-surface"],
	["--color-primary", "--color-bg"],
	["--color-primary", "--color-surface-raised"],
	["--color-on-primary", "--color-primary"],
	["--color-danger", "--color-danger-bg"],
	["--color-danger", "--color-surface-raised"],
	["--color-warning", "--color-warning-bg"],
	["--color-success", "--color-success-bg"],
	["--color-info", "--color-info-bg"],
	["--color-text", "--color-danger-bg"],
	["--color-text", "--color-warning-bg"],
];
const UI_PAIRS: Array<[string, string]> = [
	["--color-border", "--color-bg"],
	["--color-border", "--color-surface"],
	["--color-focus", "--color-bg"],
	["--color-focus", "--color-surface"],
];

describe.each(["light", "dark"] as const)("tokens do tema %s", (theme) => {
	const tokens = themes[theme];

	test.each(TEXT_PAIRS)("%s sobre %s ≥ 4.5:1", (fg, bg) => {
		expect(contrastRatio(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(4.5);
	});

	test.each(UI_PAIRS)("%s sobre %s ≥ 3:1", (fg, bg) => {
		expect(contrastRatio(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(3);
	});
});

test("o tema escuro por preferência e o forçado definem as mesmas cores", () => {
	const blocks = css.split(":root[data-theme=\"dark\"]");
	expect(blocks).toHaveLength(2);
	expect(themes.dark).toEqual(themes.darkMedia);
});

test("contrastRatio: preto sobre branco = 21", () => {
	expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
});

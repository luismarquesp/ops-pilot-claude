/** Contraste WCAG entre duas cores `#rrggbb` (pura). */
export function contrastRatio(a: string, b: string): number {
	const [la, lb] = [luminance(a), luminance(b)];
	const [hi, lo] = la > lb ? [la, lb] : [lb, la];
	return (hi + 0.05) / (lo + 0.05);
}

function luminance(hex: string): number {
	const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
	if (!match) {
		throw new Error(`cor não suportada: ${hex}`);
	}
	const channels = [0, 2, 4].map((i) => Number.parseInt(match[1]!.slice(i, i + 2), 16) / 255);
	const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

type Tokens = Record<string, string>;

function colorsIn(block: string): Tokens {
	const out: Tokens = {};
	for (const m of block.matchAll(/(--color-[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
		out[m[1]!] = m[2]!;
	}
	return out;
}

/**
 * Extrai as cores hex de cada tema de `tokens.css` (pura): o claro do primeiro
 * `:root`; o escuro de `:root[data-theme="dark"]`; e o escuro por preferência
 * do bloco `@media (prefers-color-scheme: dark)`.
 */
export function parseThemes(css: string): { light: Tokens; dark: Tokens; darkMedia: Tokens } {
	const mediaStart = css.indexOf("@media (prefers-color-scheme: dark)");
	const forcedStart = css.indexOf(':root[data-theme="dark"]');
	return {
		light: colorsIn(css.slice(0, mediaStart)),
		darkMedia: colorsIn(css.slice(mediaStart, forcedStart)),
		dark: colorsIn(css.slice(forcedStart)),
	};
}

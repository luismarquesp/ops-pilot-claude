// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { expect, test } from "vitest";

/** Roda o build num diretório temporário e devolve `index.html` e `404.html` (se houver). */
async function buildTo(base?: string): Promise<{ html: string; fallback: string | null }> {
	const outDir = mkdtempSync(join(tmpdir(), "opspilot-web-build-"));
	try {
		await build({ root: process.cwd(), logLevel: "silent", ...(base ? { base } : {}), build: { outDir, emptyOutDir: true } });
		const fallbackPath = join(outDir, "404.html");
		return {
			html: readFileSync(join(outDir, "index.html"), "utf8"),
			fallback: existsSync(fallbackPath) ? readFileSync(fallbackPath, "utf8") : null,
		};
	} finally {
		rmSync(outDir, { recursive: true, force: true });
	}
}

function refsOf(html: string): string[] {
	return [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]!);
}

/** SC-007 / FR-017 (018) e FR-006 (019): base padrão `/opspilot/` e fallback 404. */
test("vite build: todo src/href do index.html começa com /opspilot/ e 404.html é o mesmo", { timeout: 120_000 }, async () => {
	const { html, fallback } = await buildTo();

	const refs = refsOf(html);
	expect(refs.length).toBeGreaterThan(0);
	expect(refs.filter((ref) => !ref.startsWith("/opspilot/"))).toEqual([]);
	expect(html).toContain('lang="pt-BR"');
	expect(fallback).toBe(html);
});

/** FR-005 (019): o caminho real de um site de projeto no Pages. */
test("vite build com base customizada: recursos sob /ops-pilot-claude/ e 404.html igual", { timeout: 120_000 }, async () => {
	const { html, fallback } = await buildTo("/ops-pilot-claude/");

	const refs = refsOf(html);
	expect(refs.length).toBeGreaterThan(0);
	expect(refs.filter((ref) => !ref.startsWith("/ops-pilot-claude/"))).toEqual([]);
	expect(fallback).toBe(html);
});

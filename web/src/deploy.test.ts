// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Contrato textual do workflow de publicação (specs/019,
 * contracts/pages-workflow.md). O caminho parte deste arquivo, não do `cwd`. O
 * arquivo é lido como texto, linha a linha, sem parser de YAML.
 */
const WORKFLOW = fileURLToPath(new URL("../../.github/workflows/pages.yml", import.meta.url));

function workflow(): string {
	expect(existsSync(WORKFLOW), `${WORKFLOW} não existe`).toBe(true);
	return readFileSync(WORKFLOW, "utf8").replace(/\r\n/g, "\n");
}

/** Texto do job `name` (do cabeçalho `  name:` até o próximo job ou o fim). */
function job(text: string, name: string): string {
	const start = text.search(new RegExp(`^  ${name}:\\s*$`, "m"));
	expect(start, `job ${name} ausente`).toBeGreaterThanOrEqual(0);
	const rest = text.slice(start + 1);
	const next = rest.search(/^  [A-Za-z0-9_-]+:\s*$/m);
	return next < 0 ? text.slice(start) : text.slice(start, start + 1 + next);
}

/** Bloco `permissions:` imediatamente abaixo do recuo dado, normalizado em `chave: valor`. */
function permissions(text: string, indent: string): string[] {
	const lines = text.split("\n");
	const at = lines.findIndex((l) => l.startsWith(`${indent}permissions:`));
	expect(at, `permissions em recuo ${indent.length} ausente`).toBeGreaterThanOrEqual(0);
	const inline = lines[at]!.slice(`${indent}permissions:`.length).replace(/#.*/, "").trim();
	if (inline) {
		return inline === "{}" ? [] : inline.replace(/[{}]/g, "").split(",").map((p) => p.trim().replace(/\s+/g, " "));
	}
	const out: string[] = [];
	for (const line of lines.slice(at + 1)) {
		if (!line.startsWith(`${indent}  `)) {
			break;
		}
		const entry = line.replace(/#.*/, "").trim();
		if (entry) {
			out.push(entry.replace(/\s+/g, " "));
		}
	}
	return out;
}

describe("US1: publicar a cada mudança em main", () => {
	test("gatilho push em main só para web/** e o próprio workflow", () => {
		const text = workflow();
		expect(text).toMatch(/^on:\s*$/m);
		expect(text).toMatch(/^  push:\s*$/m);
		expect(text).toMatch(/branches:\s*\[\s*main\s*\]/);
		expect(text).toMatch(/paths:[\s\S]*?"web\/\*\*"/);
		expect(text).toMatch(/paths:[\s\S]*?"\.github\/workflows\/pages\.yml"/);
	});

	test("build: checkout, node 22, configure-pages, build com a base do Pages e upload de web/dist", () => {
		const build = job(workflow(), "build");
		expect(build).toContain("uses: actions/checkout@");
		expect(build).toContain("uses: actions/setup-node@");
		expect(build).toMatch(/node-version:\s*22\b/);
		expect(build).toMatch(/id:\s*pages\b/);
		expect(build).toContain("uses: actions/configure-pages@");
		expect(build).not.toMatch(/enablement:/);
		expect(build).toContain("OPSPILOT_WEB_BASE: ${{ steps.pages.outputs.base_path }}/");
		expect(build).toContain("uses: actions/upload-pages-artifact@");
		expect(build).toMatch(/path:\s*web\/dist\s*$/m);
	});

	test("deploy: depois do build, no ambiente github-pages, com o endereço público", () => {
		const deploy = job(workflow(), "deploy");
		expect(deploy).toMatch(/needs:\s*build\b/);
		expect(deploy).toMatch(/name:\s*github-pages\b/);
		expect(deploy).toContain("url: ${{ steps.deployment.outputs.page_url }}");
		expect(deploy).toMatch(/id:\s*deployment\b/);
		expect(deploy).toContain("uses: actions/deploy-pages@");
	});

	test("permissões mínimas por job (FR-008)", () => {
		const text = workflow();
		expect(permissions(text, "")).toEqual([]);
		expect(permissions(job(text, "build"), "    ").sort()).toEqual(["contents: read", "pages: read"]);
		expect(permissions(job(text, "deploy"), "    ").sort()).toEqual(["id-token: write", "pages: write"]);
		expect(text).not.toMatch(/contents:\s*write/);
	});
});

describe("US2: nunca publicar uma versão quebrada", () => {
	test("instala → typecheck → testes → build → upload, nesta ordem (FR-004)", () => {
		const build = job(workflow(), "build");
		const steps = [
			"npm ci --prefix web",
			"npm --prefix web run typecheck",
			"npm --prefix web test",
			"npm --prefix web run build",
			"uses: actions/upload-pages-artifact@",
		].map((step) => {
			const at = build.indexOf(step);
			expect(at, `etapa ausente: ${step}`).toBeGreaterThanOrEqual(0);
			return at;
		});
		expect(steps).toEqual([...steps].sort((a, b) => a - b));
	});

	test("uma publicação por vez, sem cancelar a que está rodando (FR-009)", () => {
		const text = workflow();
		expect(text).toMatch(/^concurrency:\s*$/m);
		expect(text).toMatch(/^  group:\s*pages\s*$/m);
		expect(text).toMatch(/^  cancel-in-progress:\s*false\s*$/m);
	});

	test("sem segredos e sem etapas que engolem falha (FR-011)", () => {
		const text = workflow();
		expect(text).not.toContain("secrets.");
		expect(text).not.toMatch(/continue-on-error:\s*true/);
	});
});

describe("US3: publicar sob demanda e configurar a API", () => {
	test("disparo manual (FR-002)", () => {
		const text = workflow();
		const on = text.slice(text.search(/^on:\s*$/m), text.search(/^(concurrency|permissions|jobs):/m));
		expect(on).toMatch(/^  workflow_dispatch:\s*$/m);
	});

	test("endereço padrão da API vem da variável de repositório, no passo de build (FR-007)", () => {
		const build = job(workflow(), "build");
		const line = "VITE_OPSPILOT_API_URL: ${{ vars.OPSPILOT_API_URL }}";
		const at = build.indexOf(line);
		expect(at, "variável ausente").toBeGreaterThan(build.indexOf("npm --prefix web run build"));
		expect(at).toBeLessThan(build.indexOf("uses: actions/upload-pages-artifact@"));
	});
});

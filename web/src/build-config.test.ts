// @vitest-environment node
import { describe, expect, test } from "vitest";
import { DEFAULT_BASE, resolveBuildConfig } from "./build-config.js";

/** contracts/build-config.md (specs/019). */
describe("OPSPILOT_WEB_BASE", () => {
	test.each([
		[undefined, "/opspilot/"],
		["", "/opspilot/"],
		["   ", "/opspilot/"],
		["/", "/"],
		["//", "/"],
		["/ops-pilot-claude", "/ops-pilot-claude/"],
		["/ops-pilot-claude/", "/ops-pilot-claude/"],
		["/a/b.c_d~e/", "/a/b.c_d~e/"],
	])("%j → %s", (value, base) => {
		expect(resolveBuildConfig({ OPSPILOT_WEB_BASE: value })).toEqual({ ok: true, config: { base, apiUrl: undefined } });
	});

	test.each(["ops", "/a/../b/", "/./", "https://x/", "/a?b", "/a b/", "/a#b"])("%j é inválido", (value) => {
		expect(resolveBuildConfig({ OPSPILOT_WEB_BASE: value })).toEqual({ ok: false, invalid: ["OPSPILOT_WEB_BASE"] });
	});

	test("padrão é o da 018", () => {
		expect(DEFAULT_BASE).toBe("/opspilot/");
	});
});

describe("VITE_OPSPILOT_API_URL", () => {
	test.each([
		[undefined, undefined],
		["", undefined],
		["https://api.example.com/", "https://api.example.com"],
		["http://localhost:3000", "http://localhost:3000"],
	])("%j → %j", (value, apiUrl) => {
		expect(resolveBuildConfig({ VITE_OPSPILOT_API_URL: value })).toEqual({ ok: true, config: { base: "/opspilot/", apiUrl } });
	});

	test.each(["ftp://x", "nada"])("%j é inválido", (value) => {
		expect(resolveBuildConfig({ VITE_OPSPILOT_API_URL: value })).toEqual({ ok: false, invalid: ["VITE_OPSPILOT_API_URL"] });
	});
});

test("as duas inválidas: só os nomes, nunca os valores", () => {
	const result = resolveBuildConfig({ OPSPILOT_WEB_BASE: "segredo-base", VITE_OPSPILOT_API_URL: "segredo-url" });
	expect(result).toEqual({ ok: false, invalid: ["OPSPILOT_WEB_BASE", "VITE_OPSPILOT_API_URL"] });
	expect(JSON.stringify(result)).not.toContain("segredo");
});

test("ignora variáveis que não são de build", () => {
	expect(resolveBuildConfig({ PATH: "/usr/bin", HOME: "x" })).toEqual({ ok: true, config: { base: "/opspilot/", apiUrl: undefined } });
});

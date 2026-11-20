import { z } from "zod";
import { apiUrlSchema } from "./config.js";

/**
 * Configuração do build da war room (specs/019, contracts/build-config.md).
 * Função pura: as variáveis de build são entrada externa e passam por zod.
 */

/** Caminho de publicação da 018 (FR-017), usado quando nada é configurado. */
export const DEFAULT_BASE = "/opspilot/";

export interface BuildConfig {
	base: string;
	apiUrl: string | undefined;
}

export type BuildConfigResult = { ok: true; config: BuildConfig } | { ok: false; invalid: string[] };

const SEGMENT = /^[A-Za-z0-9._~-]+$/;

/** Caminho absoluto, normalizado com `/` no início e no fim; `//` repetidos colapsam. */
const baseSchema = z
	.string()
	.transform((raw) => raw.replace(/\/{2,}/g, "/"))
	.refine((path) => path.startsWith("/"))
	.transform((path) => (path.endsWith("/") ? path : `${path}/`))
	.refine((path) => path.split("/").slice(1, -1).every((s) => SEGMENT.test(s) && s !== "." && s !== ".."));

/** Vazio, só espaços ou ausente → não configurado. */
function present(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

export function resolveBuildConfig(env: Record<string, string | undefined>): BuildConfigResult {
	const invalid: string[] = [];

	const rawBase = present(env.OPSPILOT_WEB_BASE);
	const base = rawBase === undefined ? { success: true as const, data: DEFAULT_BASE } : baseSchema.safeParse(rawBase);
	if (!base.success) {
		invalid.push("OPSPILOT_WEB_BASE");
	}

	const rawUrl = present(env.VITE_OPSPILOT_API_URL);
	const apiUrl = rawUrl === undefined ? { success: true as const, data: undefined } : apiUrlSchema.safeParse(rawUrl);
	if (!apiUrl.success) {
		invalid.push("VITE_OPSPILOT_API_URL");
	}

	if (!base.success || !apiUrl.success) {
		return { ok: false, invalid };
	}
	return { ok: true, config: { base: base.data, apiUrl: apiUrl.data } };
}

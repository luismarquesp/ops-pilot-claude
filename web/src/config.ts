import { z } from "zod";

/** As únicas chaves que a war room grava no navegador (FR-021). */
export const STORAGE_KEYS = {
	apiUrl: "opspilot.apiUrl",
	theme: "opspilot.theme",
	conversationId: "opspilot.conversationId",
} as const;

export type Theme = "light" | "dark" | "system";

export interface Settings {
	apiUrl: string;
	theme: Theme;
}

export type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Endereço da API: http(s) válido, sem barra final (FR-014). */
export const apiUrlSchema = z
	.string()
	.trim()
	.pipe(z.url({ protocol: /^https?$/, hostname: z.regexes.hostname }))
	.transform((url) => url.replace(/\/+$/, ""));

const themeSchema = z.enum(["light", "dark", "system"]);
const conversationIdSchema = z.uuid();

/** Padrão do endereço da API (pura, research §9). */
export function defaultApiUrl({ envUrl, dev, origin }: { envUrl: string | undefined; dev: boolean; origin: string }): string {
	const fromEnv = envUrl?.trim().replace(/\/+$/, "");
	if (fromEnv) {
		return fromEnv;
	}
	return dev ? "http://localhost:3000" : origin;
}

/** `localStorage` do navegador, ou `undefined` se o acesso lança (modo privado, bloqueio). */
export function browserStorage(): KeyValueStorage | undefined {
	try {
		return window.localStorage;
	} catch {
		return undefined;
	}
}

function read(storage: KeyValueStorage | undefined, key: string): string | null {
	try {
		return storage?.getItem(key) ?? null;
	} catch {
		return null;
	}
}

function write(storage: KeyValueStorage | undefined, key: string, value: string | undefined): void {
	try {
		if (value === undefined) {
			storage?.removeItem(key);
		} else {
			storage?.setItem(key, value);
		}
	} catch {
		// Armazenamento indisponível: a war room segue com o valor em memória.
	}
}

/** Configurações salvas; valor ausente ou inválido → padrão. Nunca lança. */
export function loadSettings(storage: KeyValueStorage | undefined, defaults: Settings): Settings {
	const apiUrl = apiUrlSchema.safeParse(read(storage, STORAGE_KEYS.apiUrl) ?? "");
	const theme = themeSchema.safeParse(read(storage, STORAGE_KEYS.theme));
	return { apiUrl: apiUrl.success ? apiUrl.data : defaults.apiUrl, theme: theme.success ? theme.data : defaults.theme };
}

export function saveSettings(storage: KeyValueStorage | undefined, settings: Settings): void {
	write(storage, STORAGE_KEYS.apiUrl, settings.apiUrl);
	write(storage, STORAGE_KEYS.theme, settings.theme);
}

export function loadConversationId(storage: KeyValueStorage | undefined): string | undefined {
	const parsed = conversationIdSchema.safeParse(read(storage, STORAGE_KEYS.conversationId));
	return parsed.success ? parsed.data : undefined;
}

export function saveConversationId(storage: KeyValueStorage | undefined, conversationId: string | undefined): void {
	write(storage, STORAGE_KEYS.conversationId, conversationId);
}

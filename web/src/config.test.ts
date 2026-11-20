import { describe, expect, test } from "vitest";
import {
	apiUrlSchema,
	defaultApiUrl,
	loadConversationId,
	loadSettings,
	saveConversationId,
	saveSettings,
	STORAGE_KEYS,
	type KeyValueStorage,
} from "./config.js";

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
	const data = new Map<string, string>();
	return {
		data,
		getItem: (k) => data.get(k) ?? null,
		setItem: (k, v) => void data.set(k, v),
		removeItem: (k) => void data.delete(k),
	};
}

const throwing: KeyValueStorage = {
	getItem: () => {
		throw new Error("bloqueado");
	},
	setItem: () => {
		throw new Error("bloqueado");
	},
	removeItem: () => {
		throw new Error("bloqueado");
	},
};

const DEFAULTS = { apiUrl: "http://localhost:3000", theme: "system" as const };

describe("defaultApiUrl", () => {
	test("usa VITE_OPSPILOT_API_URL quando definido no build", () => {
		expect(defaultApiUrl({ envUrl: " https://api.ops.test/ ", dev: true, origin: "http://x" })).toBe("https://api.ops.test");
	});
	test("em dev sem env → localhost:3000; em produção → a própria origem", () => {
		expect(defaultApiUrl({ envUrl: undefined, dev: true, origin: "http://x" })).toBe("http://localhost:3000");
		expect(defaultApiUrl({ envUrl: "", dev: false, origin: "https://host.test" })).toBe("https://host.test");
	});
});

describe("apiUrlSchema", () => {
	test("aceita http/https e remove a barra final", () => {
		expect(apiUrlSchema.parse("http://localhost:3000/")).toBe("http://localhost:3000");
		expect(apiUrlSchema.parse("https://ops.test/api")).toBe("https://ops.test/api");
	});
	test.each(["", "ftp://ops.test", "localhost:3000", "lixo", "javascript:alert(1)"])("recusa %j", (value) => {
		expect(apiUrlSchema.safeParse(value).success).toBe(false);
	});
});

describe("settings em localStorage", () => {
	test("sem nada salvo devolve o padrão; salvar e ler de volta", () => {
		const storage = memoryStorage();
		expect(loadSettings(storage, DEFAULTS)).toEqual(DEFAULTS);

		saveSettings(storage, { apiUrl: "https://ops.test", theme: "dark" });

		expect(loadSettings(storage, DEFAULTS)).toEqual({ apiUrl: "https://ops.test", theme: "dark" });
	});

	test("valor corrompido cai no padrão", () => {
		const storage = memoryStorage();
		storage.setItem(STORAGE_KEYS.apiUrl, "ftp://x");
		storage.setItem(STORAGE_KEYS.theme, "roxo");

		expect(loadSettings(storage, DEFAULTS)).toEqual(DEFAULTS);
	});

	test("storage que lança ou ausente nunca quebra", () => {
		expect(loadSettings(throwing, DEFAULTS)).toEqual(DEFAULTS);
		expect(() => saveSettings(throwing, DEFAULTS)).not.toThrow();
		expect(loadSettings(undefined, DEFAULTS)).toEqual(DEFAULTS);
		expect(loadConversationId(throwing)).toBeUndefined();
		expect(() => saveConversationId(throwing, "x")).not.toThrow();
	});

	test("conversationId: salva, lê, e undefined remove; só UUID é aceito", () => {
		const storage = memoryStorage();
		const id = "5b1f3c2e-0000-4000-8000-000000000001";

		saveConversationId(storage, id);
		expect(loadConversationId(storage)).toBe(id);
		saveConversationId(storage, undefined);
		expect(loadConversationId(storage)).toBeUndefined();
		storage.setItem(STORAGE_KEYS.conversationId, "nao-uuid");
		expect(loadConversationId(storage)).toBeUndefined();
	});

	test("só as três chaves documentadas são usadas (FR-021)", () => {
		const storage = memoryStorage();
		saveSettings(storage, { apiUrl: "https://ops.test", theme: "light" });
		saveConversationId(storage, "5b1f3c2e-0000-4000-8000-000000000001");

		expect([...storage.data.keys()].sort()).toEqual(["opspilot.apiUrl", "opspilot.conversationId", "opspilot.theme"]);
	});
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./server.js";
import type { ReasoningStrategy, StrategyResult } from "../agents/strategy.js";
import { createMockConversationStore } from "../store/mock-conversation-store.js";
import { SqliteMemoryStore } from "../memory/memory-store.js";
import { createFakeEmbedder } from "../memory/fake-embedder.js";

/** Estratégia espiã: registra as perguntas recebidas (para a integração com o /chat). */
function spyStrategy(questions: string[]): ReasoningStrategy {
	return {
		name: "react",
		async run(input): Promise<StrategyResult> {
			questions.push(input.question);
			return { answer: "ok", trace: [], metrics: { llmCalls: 1, latencyMs: 1 } };
		},
	};
}

interface MemoryServerContext {
	baseUrl: string;
	memory: SqliteMemoryStore;
	questions: string[];
}

async function withMemoryServer(
	callback: (context: MemoryServerContext) => Promise<void>,
	{ table = {}, withMemory = true }: { table?: Record<string, number[]>; withMemory?: boolean } = {},
): Promise<void> {
	const memory = new SqliteMemoryStore(createFakeEmbedder(table), ":memory:");
	const questions: string[] = [];
	const registry = new Map([["react", spyStrategy(questions)]]);
	const app = createApp({
		strategiesFor: () => registry,
		conversations: createMockConversationStore(),
		memory: withMemory ? memory : undefined,
	});
	const server = app.listen(0);
	await new Promise<void>((resolve) => server.once("listening", resolve));

	const address = server.address();
	if (address === null || typeof address === "string") {
		throw new Error("Falha ao obter a porta do servidor de teste");
	}

	try {
		await callback({ baseUrl: `http://127.0.0.1:${address.port}`, memory, questions });
	} finally {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
		memory.close();
	}
}

async function request(baseUrl: string, method: string, path: string, body?: unknown): Promise<Response> {
	return fetch(`${baseUrl}${path}`, {
		method,
		headers: body === undefined ? {} : { "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

test("sem memory no createApp, /memories não existe", async () => {
	await withMemoryServer(
		async ({ baseUrl }) => {
			assert.equal((await request(baseUrl, "GET", "/memories?userId=luis")).status, 404);
		},
		{ withMemory: false },
	);
});

// --- POST /memories (US1) ---

const FACT = "É responsável pelo checkout.";
const TABLE = {
	[FACT]: [1, 0, 0],
	"Prefere respostas em tópicos.": [0, 1, 0],
	"Tem algo pegando no meu serviço?": [0.9, 0.1, 0],
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface MemoryBody {
	memory: { id: string; userId: string; fact: string; createdAt: string };
}

test("POST /memories cria o fato (201), sem embedding, com trim", async () => {
	await withMemoryServer(
		async ({ baseUrl }) => {
			const response = await request(baseUrl, "POST", "/memories", { userId: "luis", fact: `  ${FACT}  ` });

			assert.equal(response.status, 201);
			const body = (await response.json()) as MemoryBody;
			assert.match(body.memory.id, UUID);
			assert.equal(body.memory.userId, "luis");
			assert.equal(body.memory.fact, FACT);
			assert.ok(!Number.isNaN(Date.parse(body.memory.createdAt)));
			assert.deepEqual(Object.keys(body.memory).sort(), ["createdAt", "fact", "id", "userId"]);
		},
		{ table: TABLE },
	);
});

test("POST /memories repetido responde 200 com o mesmo id; outro usuário ganha o seu (201)", async () => {
	await withMemoryServer(
		async ({ baseUrl }) => {
			const first = (await (await request(baseUrl, "POST", "/memories", { userId: "luis", fact: FACT })).json()) as MemoryBody;
			const again = await request(baseUrl, "POST", "/memories", { userId: "luis", fact: FACT });
			const other = await request(baseUrl, "POST", "/memories", { userId: "ana", fact: FACT });

			assert.equal(again.status, 200);
			assert.equal(((await again.json()) as MemoryBody).memory.id, first.memory.id);
			assert.equal(other.status, 201);
		},
		{ table: TABLE },
	);
});

test("POST /memories com segredo responde 422 sem ecoar o texto e não grava", async () => {
	await withMemoryServer(
		async ({ baseUrl, memory }) => {
			const response = await request(baseUrl, "POST", "/memories", { userId: "luis", fact: "minha senha: hunter2" });

			assert.equal(response.status, 422);
			const text = await response.text();
			assert.deepEqual(JSON.parse(text), { error: "secret_detected" });
			assert.ok(!text.includes("hunter2"));
			assert.deepEqual(await memory.recall("luis", FACT), []);
		},
		{ table: TABLE },
	);
});

test("POST /memories com entrada inválida responde 400 com issues", async () => {
	await withMemoryServer(
		async ({ baseUrl }) => {
			const invalid = [
				{ fact: FACT },
				{ userId: "", fact: FACT },
				{ userId: "luis" },
				{ userId: "luis", fact: "   " },
				{ userId: "luis", fact: "x".repeat(501) },
			];
			for (const body of invalid) {
				const response = await request(baseUrl, "POST", "/memories", body);

				assert.equal(response.status, 400, JSON.stringify(body).slice(0, 60));
				assert.ok(((await response.json()) as { issues: unknown[] }).issues.length > 0);
			}
		},
		{ table: TABLE },
	);
});

test("POST /memories com falha do embedder responde 500 internal_error", async (context) => {
	context.mock.method(console, "error", () => {});

	await withMemoryServer(
		async ({ baseUrl }) => {
			const response = await request(baseUrl, "POST", "/memories", { userId: "luis", fact: "texto sem vetor no fake" });

			assert.equal(response.status, 500);
			assert.deepEqual(await response.json(), { error: "internal_error" });
		},
		{ table: TABLE },
	);
});

test("fato cadastrado por POST /memories é lembrado pelo /chat do mesmo usuário", async () => {
	await withMemoryServer(
		async ({ baseUrl, questions }) => {
			await request(baseUrl, "POST", "/memories", { userId: "luis", fact: FACT });
			const response = await request(baseUrl, "POST", "/chat", {
				userId: "luis",
				message: "Tem algo pegando no meu serviço?",
			});

			assert.equal(response.status, 200);
			assert.ok(questions[0]?.includes(`\n- ${FACT}\n`), String(questions[0]));
		},
		{ table: TABLE },
	);
});

// --- GET /memories (US2) ---

interface MemoriesBody {
	memories: Array<{ id: string; userId: string; fact: string; createdAt: string }>;
}

test("GET /memories lista só os fatos do usuário, do mais recente primeiro, sem embedding", async () => {
	await withMemoryServer(
		async ({ baseUrl }) => {
			await request(baseUrl, "POST", "/memories", { userId: "luis", fact: FACT });
			await request(baseUrl, "POST", "/memories", { userId: "luis", fact: "Prefere respostas em tópicos." });
			await request(baseUrl, "POST", "/memories", { userId: "ana", fact: FACT });

			const response = await request(baseUrl, "GET", "/memories?userId=luis");

			assert.equal(response.status, 200);
			const body = (await response.json()) as MemoriesBody;
			assert.deepEqual(
				body.memories.map((memory) => [memory.userId, memory.fact]),
				[
					["luis", "Prefere respostas em tópicos."],
					["luis", FACT],
				],
			);
			assert.ok(body.memories.every((memory) => !("embedding" in memory)));
		},
		{ table: TABLE },
	);
});

test("GET /memories de usuário sem fatos devolve lista vazia", async () => {
	await withMemoryServer(async ({ baseUrl }) => {
		const response = await request(baseUrl, "GET", "/memories?userId=ninguem");

		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), { memories: [] });
	});
});

test("GET /memories sem userId válido responde 400 com issues", async () => {
	await withMemoryServer(async ({ baseUrl }) => {
		for (const path of ["/memories", "/memories?userId=", "/memories?userId=%20%20"]) {
			const response = await request(baseUrl, "GET", path);

			assert.equal(response.status, 400, path);
			assert.ok(((await response.json()) as { issues: unknown[] }).issues.length > 0);
		}
	});
});

// --- DELETE /memories/:id (US3) ---

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

test("DELETE /memories/:id do dono responde 204 e o fato some da listagem", async () => {
	await withMemoryServer(
		async ({ baseUrl }) => {
			const { memory } = (await (await request(baseUrl, "POST", "/memories", { userId: "luis", fact: FACT })).json()) as MemoryBody;

			const response = await request(baseUrl, "DELETE", `/memories/${memory.id}?userId=luis`);

			assert.equal(response.status, 204);
			assert.equal(await response.text(), "");
			const listed = (await (await request(baseUrl, "GET", "/memories?userId=luis")).json()) as MemoriesBody;
			assert.deepEqual(listed.memories, []);
		},
		{ table: TABLE },
	);
});

test("DELETE /memories/:id alheio ou inexistente responde o mesmo 404 e não remove nada", async () => {
	await withMemoryServer(
		async ({ baseUrl }) => {
			const { memory } = (await (await request(baseUrl, "POST", "/memories", { userId: "luis", fact: FACT })).json()) as MemoryBody;

			const foreign = await request(baseUrl, "DELETE", `/memories/${memory.id}?userId=ana`);
			const missing = await request(baseUrl, "DELETE", `/memories/${MISSING_ID}?userId=luis`);

			assert.equal(foreign.status, 404);
			assert.deepEqual(await foreign.json(), { error: "memory_not_found", id: memory.id });
			assert.equal(missing.status, 404);
			assert.deepEqual(await missing.json(), { error: "memory_not_found", id: MISSING_ID });
			const listed = (await (await request(baseUrl, "GET", "/memories?userId=luis")).json()) as MemoriesBody;
			assert.equal(listed.memories.length, 1);
		},
		{ table: TABLE },
	);
});

test("DELETE /memories/:id com id não-UUID ou sem userId responde 400", async () => {
	await withMemoryServer(async ({ baseUrl }) => {
		for (const path of ["/memories/abc?userId=luis", `/memories/${MISSING_ID}`, `/memories/${MISSING_ID}?userId=`]) {
			const response = await request(baseUrl, "DELETE", path);

			assert.equal(response.status, 400, path);
			assert.ok(((await response.json()) as { issues: unknown[] }).issues.length > 0);
		}
	});
});

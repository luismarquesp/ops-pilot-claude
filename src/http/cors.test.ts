import { test } from "node:test";
import assert from "node:assert/strict";
import { corsHeaders, parseCorsOrigins } from "./cors.js";

const ALLOWED = ["http://localhost:5173", "https://ops.example.com"];

test("corsHeaders: origem na lista ganha Allow-Origin, Vary e expõe X-Request-Id", () => {
	assert.deepEqual(corsHeaders("http://localhost:5173", ALLOWED, "POST"), {
		"Access-Control-Allow-Origin": "http://localhost:5173",
		Vary: "Origin",
		"Access-Control-Expose-Headers": "X-Request-Id",
	});
});

test("corsHeaders: preflight de origem na lista traz métodos, cabeçalhos e Max-Age", () => {
	assert.deepEqual(corsHeaders("https://ops.example.com", ALLOWED, "OPTIONS"), {
		"Access-Control-Allow-Origin": "https://ops.example.com",
		Vary: "Origin",
		"Access-Control-Expose-Headers": "X-Request-Id",
		"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Access-Control-Max-Age": "600",
	});
});

test("corsHeaders: comparação sem diferenciar maiúsculas, mas devolve a origem pedida", () => {
	assert.equal(corsHeaders("HTTP://LOCALHOST:5173", ALLOWED, "GET")["Access-Control-Allow-Origin"], "HTTP://LOCALHOST:5173");
});

test("corsHeaders: fora da lista, sem Origin ou lista vazia → nenhum cabeçalho; nunca * nem credentials", () => {
	assert.deepEqual(corsHeaders("http://evil.test", ALLOWED, "POST"), {});
	assert.deepEqual(corsHeaders(undefined, ALLOWED, "POST"), {});
	assert.deepEqual(corsHeaders("http://localhost:5173", [], "OPTIONS"), {});
	const headers = corsHeaders("http://localhost:5173", ALLOWED, "OPTIONS");
	assert.equal(Object.values(headers).includes("*"), false);
	assert.equal("Access-Control-Allow-Credentials" in headers, false);
});

test("parseCorsOrigins: lista por vírgula, trim, minúsculas, sem vazios nem repetidos", () => {
	assert.deepEqual(parseCorsOrigins({ CORS_ORIGINS: " http://localhost:5173 , HTTPS://Ops.Example.com,,http://localhost:5173" }), {
		origins: ["http://localhost:5173", "https://ops.example.com"],
		invalid: [],
	});
	assert.deepEqual(parseCorsOrigins({}), { origins: [], invalid: [] });
});

test("parseCorsOrigins: item inválido, com caminho, barra final ou * é ignorado e aponta a variável", () => {
	assert.deepEqual(
		parseCorsOrigins({ CORS_ORIGINS: "http://ok.test:8080,ftp://x.test,http://a.test/path,http://b.test/,*,lixo" }),
		{ origins: ["http://ok.test:8080"], invalid: ["CORS_ORIGINS"] },
	);
});

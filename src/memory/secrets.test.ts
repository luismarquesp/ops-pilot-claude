import { test } from "node:test";
import assert from "node:assert/strict";
import { containsSecret } from "./secrets.js";

const POSITIVES = [
	"minha senha: hunter2",
	"password=abc123",
	"API_KEY = xyz",
	"client-secret: s3cr3t",
	"postgres://admin:pa55@db.internal:5432/app",
	"-----BEGIN RSA PRIVATE KEY-----",
	"-----BEGIN OPENSSH PRIVATE KEY-----",
	"sk-or-v1-0123456789abcdef0123",
	"ghp_0123456789abcdefABCDEF0123",
	"AKIAABCDEFGHIJKLMNOP",
	"xoxb-1234567890-abcdef",
	"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc",
	"a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0",
];

const NEGATIVES = [
	"sou do time de pagamentos",
	"o token de deploy fica no vault",
	"prefiro respostas em tópicos",
	"5b1f3c2e-8a4d-4f7e-9c1a-2d3e4f5a6b7c",
	"a1b2c3d",
	"https://grafana.internal/d/abc",
	"minha senha expirou ontem",
];

test("containsSecret reconhece cada padrão de segredo", () => {
	for (const text of POSITIVES) {
		assert.equal(containsSecret(text), true, text);
	}
});

test("containsSecret não acusa textos comuns de plantão", () => {
	for (const text of NEGATIVES) {
		assert.equal(containsSecret(text), false, text);
	}
});

test("containsSecret dá o mesmo resultado em chamadas repetidas (regex sem estado)", () => {
	assert.equal(containsSecret("password=abc123"), true);
	assert.equal(containsSecret("password=abc123"), true);
});

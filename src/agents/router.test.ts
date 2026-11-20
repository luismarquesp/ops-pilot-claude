import { test } from "node:test";
import assert from "node:assert/strict";
import { logRouteFailure, parseRouteDecision, ROUTE_TABLE, ROUTES, routerSystemPrompt } from "./router.js";

test("ROUTE_TABLE é a fonte única das rotas, na ordem de ROUTES", () => {
	assert.deepEqual(ROUTES, ["react", "plan-and-execute", "reflection"]);
	assert.deepEqual(
		ROUTE_TABLE.map((spec) => spec.name),
		[...ROUTES],
	);
});

test("routerSystemPrompt traz a tabela com uma linha por rota", () => {
	const prompt = routerSystemPrompt(ROUTE_TABLE);

	assert.ok(prompt.includes("| rota | quando usar |"));
	for (const spec of ROUTE_TABLE) {
		assert.ok(prompt.includes(`| ${spec.name} | ${spec.when} |`), spec.name);
	}
});

test("routerSystemPrompt lista só as rotas recebidas", () => {
	const routes = ROUTE_TABLE.filter((spec) => spec.name !== "reflection");

	assert.ok(!routerSystemPrompt(routes).includes("reflection"));
});

test("parseRouteDecision aceita uma decisão válida", () => {
	assert.deepEqual(parseRouteDecision({ route: "plan-and-execute", reason: "vários passos" }, ROUTE_TABLE), {
		route: "plan-and-execute",
		reason: "vários passos",
	});
});

test("parseRouteDecision devolve null para saída fora do contrato", () => {
	const onlyReact = ROUTE_TABLE.filter((spec) => spec.name === "react");

	assert.equal(parseRouteDecision({ route: "foo", reason: "x" }, ROUTE_TABLE), null);
	assert.equal(parseRouteDecision({ route: "plan-and-execute", reason: "x" }, onlyReact), null);
	assert.equal(parseRouteDecision({ route: "react", reason: "  " }, ROUTE_TABLE), null);
	assert.equal(parseRouteDecision(null, ROUTE_TABLE), null);
	assert.equal(parseRouteDecision(undefined, ROUTE_TABLE), null);
	assert.equal(parseRouteDecision("react", ROUTE_TABLE), null);
});

test("logRouteFailure loga só o nome do erro", (t) => {
	const warn = t.mock.method(console, "warn", () => {});

	logRouteFailure(new TypeError("segredo do usuário"));

	const logged = warn.mock.calls.map((call) => call.arguments.join(" ")).join("\n");
	assert.match(logged, /TypeError/);
	assert.doesNotMatch(logged, /segredo/);
});

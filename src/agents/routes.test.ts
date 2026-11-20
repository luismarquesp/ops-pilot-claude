import { test } from "node:test";
import assert from "node:assert/strict";
import { availableRoutes, routeStrategies } from "./routes.js";
import type { ReasoningStrategy, StrategyResult } from "./strategy.js";
import type { Critic } from "./reflection.js";

function fakeStrategy(name: string): ReasoningStrategy {
	return {
		name,
		async run(): Promise<StrategyResult> {
			return { answer: name, trace: [{ type: "answer", content: name }], metrics: { llmCalls: 1, latencyMs: 1 } };
		},
	};
}

function registryWith(...names: string[]): Map<string, ReasoningStrategy> {
	return new Map(names.map((name) => [name, fakeStrategy(name)]));
}

test("routeStrategies acrescenta reflection = react com reflexão", () => {
	const registry = registryWith("react", "plan-and-execute");

	const strategies = routeStrategies(registry);

	assert.deepEqual(Object.keys(strategies).sort(), ["plan-and-execute", "react", "reflection"]);
	assert.equal(strategies.reflection?.name, "reflect:react");
	assert.equal(strategies.react, registry.get("react"));
	assert.equal(strategies["plan-and-execute"], registry.get("plan-and-execute"));
});

test("com reflect, react e plan-and-execute ganham reflexão e reflection não é embrulhada duas vezes", () => {
	const strategies = routeStrategies(registryWith("react", "plan-and-execute"), { reflect: true });

	assert.equal(strategies.react?.name, "reflect:react");
	assert.equal(strategies["plan-and-execute"]?.name, "reflect:plan-and-execute");
	assert.equal(strategies.reflection?.name, "reflect:react");
});

test("sem react no registry não há react nem reflection", () => {
	const strategies = routeStrategies(registryWith("plan-and-execute"));

	assert.deepEqual(Object.keys(strategies), ["plan-and-execute"]);
});

test("availableRoutes segue a ordem de ROUTE_TABLE", () => {
	const strategies = routeStrategies(registryWith("plan-and-execute", "react"));

	assert.deepEqual(
		availableRoutes(strategies).map((spec) => spec.name),
		["react", "plan-and-execute", "reflection"],
	);
	assert.deepEqual(
		availableRoutes(routeStrategies(registryWith("plan-and-execute"))).map((spec) => spec.name),
		["plan-and-execute"],
	);
});

test("reflectionOptions chega ao withReflection da rota reflection", async () => {
	let criticCalls = 0;
	const critic: Critic = async () => {
		criticCalls += 1;
		return { approved: true };
	};

	const strategies = routeStrategies(registryWith("react"), { reflectionOptions: { critic } });
	await strategies.reflection?.run({ question: "oi" });

	assert.equal(criticCalls, 1);
});

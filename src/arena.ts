import { SqliteOpsStore } from "./store/sqlite-ops-store.js";
import { createOpsTools } from "./agents/tools.js";
import { createProviderStatusTool } from "./agents/provider-status-tool.js";
import { createReactStrategy } from "./agents/react.js";
import { createPlanAndExecuteStrategy } from "./agents/plan-and-execute.js";
import { withReflection } from "./agents/reflection.js";
import { formatTrace } from "./agents/trace.js";
import { DEFAULT_MAX_ITERATIONS, type ReasoningStrategy } from "./agents/strategy.js";

const DEFAULT_QUESTION = "Como está o plantão? Liste os incidentes em aberto.";

interface Args {
	strategies: string[];
	maxIterations: number;
	question: string;
}

function parseArgs(argv: string[]): Args {
	let strategies: string[] | undefined;
	let maxIterations = DEFAULT_MAX_ITERATIONS;
	let question = DEFAULT_QUESTION;

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--strategies") {
			const value = argv[i + 1];
			if (!value) {
				throw new Error("--strategies exige uma lista separada por vírgula, ex.: react,plan-and-execute");
			}
			strategies = value.split(",").map((name) => name.trim()).filter(Boolean);
			i += 1;
		} else if (arg === "--max-iterations") {
			const value = argv[i + 1];
			const parsed = value ? Number(value) : Number.NaN;
			if (!Number.isInteger(parsed) || parsed <= 0) {
				throw new Error("--max-iterations exige um inteiro positivo");
			}
			maxIterations = parsed;
			i += 1;
		} else if (arg === "--question") {
			const value = argv[i + 1];
			if (!value) {
				throw new Error("--question exige um valor");
			}
			question = value;
			i += 1;
		}
	}

	return { strategies: strategies ?? [], maxIterations, question };
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	const store = new SqliteOpsStore();
	const tools = [...createOpsTools(store), createProviderStatusTool()];

	const reactStrategy = createReactStrategy(tools);
	const planAndExecuteStrategy = createPlanAndExecuteStrategy(tools);

	const available: ReasoningStrategy[] = [
		reactStrategy,
		planAndExecuteStrategy,
		withReflection(reactStrategy),
		withReflection(planAndExecuteStrategy),
	];
	const byName = new Map(available.map((strategy) => [strategy.name, strategy]));

	const selected =
		args.strategies.length > 0
			? args.strategies.map((name) => {
					const strategy = byName.get(name);
					if (!strategy) {
						const known = [...byName.keys()].join(", ");
						throw new Error(`Estratégia desconhecida: "${name}". Disponíveis: ${known}`);
					}
					return strategy;
				})
			: available;

	for (const strategy of selected) {
		console.log(`\n=== ${strategy.name} ===`);
		const result = await strategy.run({ question: args.question, maxIterations: args.maxIterations });
		console.log(formatTrace(result.trace));
		console.log(`\nMétricas: ${result.metrics.llmCalls} chamada(s) ao LLM, ${result.metrics.latencyMs}ms`);
		console.log(`Resposta: ${result.answer}`);
	}
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});

import { createMockOpsStore } from "./store/mock-ops-store.js";
import type { MockOpsStoreData, SeedIncident } from "./store/mock-ops-store.js";
import type { SeedAlert, SeedService } from "./store/mercadinho-seed.js";
import type { OpsStore } from "./store/ops-store.js";
import { createOpsTools } from "./agents/tools.js";
import { createProviderStatusTool } from "./agents/provider-status-tool.js";
import { createReactStrategy } from "./agents/react.js";
import { createPlanAndExecuteStrategy } from "./agents/plan-and-execute.js";
import type { ReasoningStrategy } from "./agents/strategy.js";

/**
 * Dataset dedicado do bench — não é o cenário "Mercadinho" de
 * `src/store/mercadinho-seed.ts`. Os nomes dos serviços casam de propósito
 * com o texto dos cenários (ex.: "payment" no singular, "catalog") para
 * eliminar qualquer ambiguidade de correspondência fuzzy na hora de checar o
 * acerto. `createMockOpsStore` já devolve uma instância nova e isolada a
 * cada chamada — não precisa de `structuredClone` entre combinações.
 *
 * Severidade "sevN" usada nos cenários mapeia para o enum do sistema como
 * convenção padrão de mercado (SEV1 = mais grave): sev1=critical, sev2=high,
 * sev3=medium, sev4=low.
 *
 * `alerts` (sinal de monitoramento, só leitura) e `incidents` (ação do
 * operador, aberto/resolvido pelas tools) são baselines independentes: C1 lê
 * `alerts`; C2/C3 leem/escrevem `incidents` — nenhum dos dois se mistura.
 */
const BENCH_SERVICES: SeedService[] = [
	{ name: "checkout", tier: "tier1" },
	{ name: "payment", tier: "tier1" },
	{ name: "catalog", tier: "tier2" },
	{ name: "auth", tier: "tier1" },
	{ name: "search", tier: "tier2" },
];

const BENCH_ALERTS: SeedAlert[] = [
	{ title: "Fila de pagamento travada", service: "checkout", severity: "critical", status: "firing" },
	{ title: "Latência alta no gateway", service: "payment", severity: "high", status: "firing" },
	{ title: "Preço incorreto", service: "catalog", severity: "low", status: "resolved" },
	{ title: "Erro 500 no login", service: "auth", severity: "critical", status: "firing" },
	{ title: "Índice desatualizado", service: "search", severity: "medium", status: "resolved" },
];

/** Baseline de incidentes pré-existentes, compartilhado por C2 e C3 — id 1 é o mais antigo (usado pelo C3). */
const BENCH_INCIDENTS: SeedIncident[] = [
	{ title: "Fila de pagamento travada", service: "checkout", severity: "critical", status: "open" },
	{ title: "Latência alta no gateway", service: "payment", severity: "high", status: "open" },
	{ title: "Erro 500 no login", service: "auth", severity: "critical", status: "open" },
];

function benchData(): MockOpsStoreData {
	return { services: BENCH_SERVICES, alerts: BENCH_ALERTS, incidents: BENCH_INCIDENTS };
}

const BASELINE_INCIDENT_IDS = new Set(BENCH_INCIDENTS.map((_incident, index) => index + 1));
const BASELINE_OPEN_COUNT = BENCH_INCIDENTS.filter((incident) => incident.status === "open").length;
const OLDEST_INCIDENT_ID = 1;

interface Scenario {
	id: string;
	title: string;
	question: string;
	/** Acerto verificado no ESTADO do store após rodar — nunca no texto da resposta. */
	check(store: OpsStore): Promise<boolean>;
}

/** C1 — pergunta direta, somente leitura sobre alertas: o store não deve ser tocado. */
async function checkC1(store: OpsStore): Promise<boolean> {
	const after = await store.listAlerts();
	if (after.length !== BENCH_ALERTS.length) {
		return false;
	}
	return after.every((alert, index) => {
		const original = BENCH_ALERTS[index];
		return original !== undefined && original.status === alert.status && original.severity === alert.severity;
	});
}

/** C2 — três incidentes novos, na ordem certa, com o primeiro resolvido. */
async function checkC2(store: OpsStore): Promise<boolean> {
	const after = await store.listIncidents();

	const preexisting = after.filter((incident) => BASELINE_INCIDENT_IDS.has(incident.id));
	const nothingElseChanged = preexisting.every((incident, index) => {
		const original = BENCH_INCIDENTS[index];
		return original !== undefined && original.status === incident.status;
	});
	if (preexisting.length !== BENCH_INCIDENTS.length || !nothingElseChanged) {
		return false;
	}

	const created = after
		.filter((incident) => !BASELINE_INCIDENT_IDS.has(incident.id))
		.sort((a, b) => a.id - b.id);
	if (created.length !== 3) {
		return false;
	}
	const [first, second, third] = created;
	if (!first || !second || !third) {
		return false;
	}

	const orderMatches = first.service === "checkout" && second.service === "payment" && third.service === "catalog";
	const severityMatches = [first, second, third].every((incident) => incident.severity === "high");
	const resolutionMatches = first.status === "resolved" && second.status === "open" && third.status === "open";

	return orderMatches && severityMatches && resolutionMatches;
}

/** C3 — o incidente aberto mais antigo foi resolvido, e sobra exatamente 1 a menos em aberto. */
async function checkC3(store: OpsStore): Promise<boolean> {
	const after = await store.listIncidents();
	if (after.length !== BENCH_INCIDENTS.length) {
		return false; // nenhum incidente novo deveria ter sido criado
	}
	const oldest = after.find((incident) => incident.id === OLDEST_INCIDENT_ID);
	if (!oldest || oldest.status !== "resolved") {
		return false;
	}
	const stillOpen = after.filter((incident) => incident.status === "open").length;
	return stillOpen === BASELINE_OPEN_COUNT - 1;
}

const SCENARIOS: Scenario[] = [
	{
		id: "C1",
		title: "Direto",
		question: "Quantos alertas de severidade crítica estão em status firing (disparando) agora?",
		check: checkC1,
	},
	{
		id: "C2",
		title: "Estruturado",
		question:
			'Abra três incidentes de severidade "sev2" (equivalente a "high" neste sistema) para os ' +
			"serviços checkout, payment e catalog, nessa mesma ordem. Em seguida, resolva o primeiro " +
			"incidente que você abriu (o de checkout).",
		check: checkC2,
	},
	{
		id: "C3",
		title: "Dinâmico",
		question:
			"Dos incidentes em aberto, identifique o mais antigo e resolva-o. Depois, diga quantos " +
			"incidentes continuam em aberto.",
		check: checkC3,
	},
];

interface BenchArgs {
	scenario?: string;
	noReplanner: boolean;
}

function parseArgs(argv: string[]): BenchArgs {
	let scenario: string | undefined;
	let noReplanner = false;

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--scenario") {
			const value = argv[i + 1];
			if (!value) {
				throw new Error("--scenario exige um id (C1, C2 ou C3)");
			}
			scenario = value.trim().toUpperCase();
			i += 1;
		} else if (arg === "--no-replanner") {
			noReplanner = true;
		}
	}

	return { scenario, noReplanner };
}

interface BenchRow {
	cenario: string;
	estrategia: string;
	acerto: boolean;
	llmCalls: number;
	latencyMs: number;
}

async function runOne(scenario: Scenario, strategy: ReasoningStrategy, store: OpsStore): Promise<BenchRow> {
	const result = await strategy.run({ question: scenario.question });
	const acerto = await scenario.check(store);
	return {
		cenario: scenario.id,
		estrategia: strategy.name,
		acerto,
		llmCalls: result.metrics.llmCalls,
		latencyMs: result.metrics.latencyMs,
	};
}

function printTable(rows: BenchRow[]): void {
	const headers = ["cenário", "estratégia", "acerto", "llmCalls", "latencyMs"];
	const cells = rows.map((row) => [
		row.cenario,
		row.estrategia,
		row.acerto ? "✅" : "❌",
		String(row.llmCalls),
		String(row.latencyMs),
	]);

	const widths = headers.map((header, col) =>
		Math.max(header.length, ...cells.map((row) => row[col]?.length ?? 0)),
	);
	const formatRow = (values: string[]): string =>
		values.map((value, col) => value.padEnd(widths[col] ?? 0)).join("  ");

	console.log(formatRow(headers));
	console.log(widths.map((width) => "-".repeat(width)).join("  "));
	for (const row of cells) {
		console.log(formatRow(row));
	}

	const passed = rows.filter((row) => row.acerto).length;
	console.log(`\n${passed}/${rows.length} combinação(ões) cenário×estratégia corretas.`);
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	const scenarios = args.scenario ? SCENARIOS.filter((scenario) => scenario.id === args.scenario) : SCENARIOS;
	if (scenarios.length === 0) {
		const known = SCENARIOS.map((scenario) => scenario.id).join(", ");
		throw new Error(`Cenário desconhecido: "${args.scenario}". Disponíveis: ${known}`);
	}

	if (args.noReplanner) {
		console.log("(--no-replanner: plan-and-execute segue o plano original sem revisar)\n");
	}

	const rows: BenchRow[] = [];

	for (const scenario of scenarios) {
		for (const strategyName of ["react", "plan-and-execute"] as const) {
			// Store novo, isolado, a partir do baseline fixo — cada combinação
			// cenário×estratégia roda sem vazar mutações entre execuções.
			const store = createMockOpsStore(benchData());
			const tools = [...createOpsTools(store), createProviderStatusTool()];
			const strategy: ReasoningStrategy =
				strategyName === "react"
					? createReactStrategy(tools)
					: createPlanAndExecuteStrategy(tools, { useReplanner: !args.noReplanner });

			rows.push(await runOne(scenario, strategy, store));
		}
	}

	printTable(rows);
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { TraceStep } from "./TraceStep.js";
import { TraceDrawer } from "./TraceDrawer.js";
import { TRACE_STEP_META } from "./traceMeta.js";
import { KNOWN_TRACE_TYPES, chatOkSchema, type TraceEvent } from "../api/schemas.js";
import { expectNoA11yViolations } from "../test/axe.js";
import { METRICS } from "../test/bodies.js";
import planFixture from "../test/fixtures/chat-plan.json";

const SAMPLES: Record<string, TraceEvent> = {
	thought: { type: "thought", content: "Vou listar os alertas.", node: "react" },
	observation: { type: "observation", content: '[{"id":1}]', node: "react" },
	critique: { type: "critique", content: "Falta citar o runbook.", node: "reflection" },
	answer: { type: "answer", content: "Nada disparando.", node: "react" },
	action: { type: "action", tool: "list_alerts", args: { status: "firing" }, node: "react" },
	plan: { type: "plan", steps: ["Listar", "Resumir"], node: "plan-and-execute" },
	summarize: { type: "summarize", content: "- turnos antigos", messagesSummarized: 8, node: "contexto" },
	route: { type: "route", route: "react", reason: "Uma tool basta.", source: "router", node: "roteador" },
	fallback: { type: "fallback", from: "modelo/a", to: "modelo/b:free", reason: "RateLimitError", node: "react" },
	approval: { type: "approval", approvalId: "ap-1", tool: "resolve_incident", args: { id: 3 }, summary: "Resolver o incidente #3", node: "react" },
	decision: { type: "decision", approvalId: "ap-1", decision: "approved", result: '{"id":3}', node: "contexto" },
};

function renderStep(event: TraceEvent) {
	return render(
		<ol>
			<TraceStep event={event} />
		</ol>,
	);
}

describe("TraceStep", () => {
	test("todo tipo conhecido tem rótulo e ícone na tabela", () => {
		for (const type of KNOWN_TRACE_TYPES) {
			expect(TRACE_STEP_META[type].label.length).toBeGreaterThan(0);
			expect(SAMPLES[type], `amostra para ${type}`).toBeDefined();
		}
	});

	test.each(Object.values(SAMPLES))("$type mostra rótulo de texto e a etapa (node)", (event) => {
		renderStep(event);
		const step = screen.getAllByRole("listitem")[0]!;

		expect(within(step).getByText(TRACE_STEP_META[event.type as keyof typeof TRACE_STEP_META].label)).toBeInTheDocument();
		expect(within(step).getByText(event.node!)).toBeInTheDocument();
	});

	test("action mostra a tool e os argumentos formatados", () => {
		renderStep(SAMPLES.action!);

		expect(screen.getByText("list_alerts")).toBeInTheDocument();
		expect(screen.getByText(/"status": "firing"/)).toBeInTheDocument();
	});

	test("plan vira lista numerada; fallback aparece como aviso; route mostra a razão", () => {
		const { unmount } = renderStep(SAMPLES.plan!);
		expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toContain("Listar");
		unmount();

		renderStep(SAMPLES.fallback!);
		expect(screen.getByText("modelo/a → modelo/b:free")).toBeInTheDocument();
		expect(screen.getByRole("listitem")).toHaveClass("trace-step-warning");
	});

	test("tipo desconhecido usa a forma genérica, sem quebrar", () => {
		renderStep({ type: "novo", node: "react", unknown: true, raw: { type: "novo", node: "react", x: 1 } });

		expect(screen.getByText("Outro passo (novo)")).toBeInTheDocument();
		expect(screen.getByText(/"x": 1/)).toBeInTheDocument();
	});

	test("conteúdo longo começa recolhido e pode ser expandido", async () => {
		const user = userEvent.setup();
		renderStep({ type: "observation", content: "x".repeat(2000), node: "react" });

		const toggle = screen.getByText("Mostrar tudo");
		expect(toggle.closest("details")).not.toHaveAttribute("open");
		await user.click(toggle);
		expect(toggle.closest("details")).toHaveAttribute("open");
	});
});

describe("TraceDrawer", () => {
	test("mostra as métricas no topo e os passos na ordem", async () => {
		const data = chatOkSchema.parse(planFixture);
		const { baseElement } = render(<TraceDrawer open onClose={() => {}} trace={data.trace} metrics={data.metrics} />);

		const dialog = screen.getByRole("dialog", { name: "Raciocínio" });
		expect(within(dialog).getByText("Chamadas ao modelo")).toBeInTheDocument();
		expect(within(dialog).getByText("openrouter/free")).toBeInTheDocument();
		const labels = within(dialog)
			.getAllByRole("listitem")
			.filter((li) => li.classList.contains("trace-step"))
			.map((li) => li.querySelector(".trace-step-label")?.textContent);
		expect(labels).toEqual(["Rota", "Troca de modelo", "Plano", "Ação", "Observação", "Resposta"]);
		await expectNoA11yViolations(baseElement);
	});

	test("tokens nulos e modelo nulo aparecem como 'não informado'; cortes listados", () => {
		const metrics = { ...METRICS, promptTokens: null, modelUsed: null, contextTrimmed: { historyMessages: 2, memoryFacts: 0, summaryTruncated: true } };
		render(<TraceDrawer open onClose={() => {}} trace={[]} metrics={metrics} />);

		expect(screen.getAllByText("não informado")).toHaveLength(2);
		expect(screen.getByText("2 mensagens, resumo truncado")).toBeInTheDocument();
		expect(screen.getByText("Nenhum passo registrado neste turno.")).toBeInTheDocument();
	});
});

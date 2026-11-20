import type { FallbackEvent } from "./resilience.js";
import type { RouteEvent } from "./router.js";
import type { TraceEvent } from "./strategy.js";

/** Eventos formatáveis: os das estratégias + a decisão de rota (specs/014) + a troca de modelo (specs/015). */
type FormattableEvent = TraceEvent | RouteEvent | FallbackEvent;

const LABELS: Record<FormattableEvent["type"], string> = {
	thought: "Pensamento",
	action: "Ação",
	observation: "Observação",
	plan: "Plano",
	critique: "Crítica",
	answer: "Resposta",
	summarize: "Resumo",
	route: "Rota",
	fallback: "Troca de modelo",
	approval: "Aguardando aprovação",
	decision: "Decisão",
};

function formatEvent(event: FormattableEvent): string {
	switch (event.type) {
		case "action":
			return `[${LABELS.action}] ${event.tool}(${JSON.stringify(event.args)})`;
		case "plan":
			return [
				`[${LABELS.plan}]`,
				...event.steps.map((step, index) => `  ${index + 1}. ${step}`),
			].join("\n");
		case "fallback":
			return `[${LABELS.fallback}] ${event.from} → ${event.to} (${event.reason})`;
		case "route":
			return `[${LABELS.route}] ${event.route} (${event.source}): ${event.reason}`;
		case "approval":
			return `[${LABELS.approval}] ${event.summary}`;
		case "decision":
			return `[${LABELS.decision}] ${event.decision}${event.result === undefined ? "" : `: ${event.result}`}`;
		default:
			return `[${LABELS[event.type]}] ${event.content}`;
	}
}

/** Formata um rastro completo em texto legível, uma linha (ou bloco) por evento, na ordem original. */
export function formatTrace(trace: readonly FormattableEvent[]): string {
	return trace.map(formatEvent).join("\n");
}

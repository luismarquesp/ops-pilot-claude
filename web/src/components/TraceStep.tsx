import type { ReactNode } from "react";
import type { KnownTraceEvent, TraceEvent } from "../api/schemas.js";
import { decisionLabel, TRACE_STEP_META, UNKNOWN_STEP_META, type TraceStepMeta } from "./traceMeta.js";

const LONG = 600;

function json(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2) ?? String(value);
	} catch {
		return String(value);
	}
}

/** Texto longo começa recolhido (edge case: observação enorme). */
function Text({ value, pre = false }: { value: string; pre?: boolean }) {
	const body = pre ? <pre>{value}</pre> : <p style={{ whiteSpace: "pre-wrap" }}>{value}</p>;
	if (value.length <= LONG) {
		return body;
	}
	return (
		<details>
			<summary>Mostrar tudo</summary>
			{body}
		</details>
	);
}

function bodyOf(event: KnownTraceEvent): ReactNode {
	switch (event.type) {
		case "thought":
		case "critique":
		case "answer":
			return <Text value={event.content} />;
		case "observation":
			return <Text value={event.content} pre />;
		case "action":
			return (
				<>
					<code className="mono">{event.tool}</code>
					<Text value={json(event.args)} pre />
				</>
			);
		case "plan":
			return (
				<ol>
					{event.steps.map((step, i) => (
						<li key={i}>{step}</li>
					))}
				</ol>
			);
		case "summarize":
			return (
				<>
					<p className="muted numeric">{event.messagesSummarized} mensagens resumidas</p>
					<Text value={event.content} />
				</>
			);
		case "route":
			return (
				<>
					<p>
						<code className="mono">{event.route}</code> <span className="muted">· {event.source}</span>
					</p>
					<Text value={event.reason} />
				</>
			);
		case "fallback":
			return (
				<p>
					<span className="mono">
						{event.from} → {event.to}
					</span>{" "}
					<span className="muted">({event.reason})</span>
				</p>
			);
		case "approval":
			return (
				<>
					<p>{event.summary}</p>
					<code className="mono">{event.tool}</code>
				</>
			);
		case "decision":
			return (
				<>
					<p>{decisionLabel(event.decision)}</p>
					{event.result !== undefined ? <Text value={event.result} pre /> : null}
				</>
			);
		default: {
			const exhaustive: never = event;
			return exhaustive;
		}
	}
}

function isUnknown(event: TraceEvent): event is Extract<TraceEvent, { unknown: true }> {
	return "unknown" in event;
}

/** Um passo do raciocínio: ícone (decorativo) + rótulo de texto + etapa + conteúdo do tipo. */
export function TraceStep({ event }: { event: TraceEvent }) {
	const meta: TraceStepMeta = isUnknown(event) ? UNKNOWN_STEP_META : TRACE_STEP_META[event.type];
	const label = isUnknown(event) ? `${meta.label} (${event.type})` : meta.label;

	return (
		<li className={`trace-step${meta.tone === "warning" ? " trace-step-warning" : ""}`}>
			<div className="trace-step-head">
				<span aria-hidden="true">{meta.icon}</span>
				<span className="trace-step-label">{label}</span>
				{event.node ? <span className="trace-step-node">{event.node}</span> : null}
			</div>
			{isUnknown(event) ? <Text value={json(event.raw)} pre /> : bodyOf(event)}
		</li>
	);
}

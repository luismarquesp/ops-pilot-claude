import type { KnownTraceType } from "../api/schemas.js";

export interface TraceStepMeta {
	label: string;
	/** Decorativo: o rótulo de texto é o que identifica o tipo (nunca só ícone/cor). */
	icon: string;
	tone?: "warning";
}

/** Tipo de passo → rótulo e ícone (pura, research §10). */
export const TRACE_STEP_META: Record<KnownTraceType, TraceStepMeta> = {
	route: { label: "Rota", icon: "⤳" },
	plan: { label: "Plano", icon: "☰" },
	thought: { label: "Pensamento", icon: "💭" },
	action: { label: "Ação", icon: "⚙" },
	observation: { label: "Observação", icon: "👁" },
	critique: { label: "Crítica", icon: "✎" },
	fallback: { label: "Troca de modelo", icon: "⚠", tone: "warning" },
	summarize: { label: "Resumo do histórico", icon: "≡" },
	approval: { label: "Aguardando aprovação", icon: "✋", tone: "warning" },
	decision: { label: "Decisão do plantonista", icon: "✔" },
	answer: { label: "Resposta", icon: "✦" },
};

export const UNKNOWN_STEP_META: TraceStepMeta = { label: "Outro passo", icon: "•" };

const DECISION_LABEL = { approved: "Aprovada", denied: "Negada", expired: "Expirada" } as const;

export function decisionLabel(decision: keyof typeof DECISION_LABEL): string {
	return DECISION_LABEL[decision];
}

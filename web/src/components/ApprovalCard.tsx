import { useEffect, useId, useRef, useState } from "react";
import type { ApprovalCardState } from "../state/chat.js";
import { describeError } from "../api/errors.js";

export interface ApprovalCardProps {
	card: ApprovalCardState;
	onDecide: (decision: "approve" | "deny") => void;
	onExpire: () => void;
	apiUrl?: string;
	/** Relógio injetável (testes). */
	now?: () => number;
}

function countdown(ms: number): string {
	const total = Math.max(0, Math.ceil(ms / 1000));
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const DONE_TEXT = {
	deciding: "Registrando a decisão…",
	approved: "Aprovada — ação executada.",
	denied: "Negada — nada foi executado.",
	expired: "Expirada — nada foi executado. Pergunte de novo se ainda precisar da ação.",
} as const;

/**
 * Cartão de aprovação (US3): a ação em linguagem humana, detalhes técnicos sob
 * demanda, Aprovar (primária) e Negar. Uma decisão por cartão; contagem até
 * expirar.
 */
export function ApprovalCard({ card, onDecide, onExpire, apiUrl = "", now = Date.now }: ApprovalCardProps) {
	const titleId = useId();
	const [clock, setClock] = useState(now);
	const decidedOnce = useRef(false);
	const expiresAt = Date.parse(card.approval.expiresAt);
	const pending = card.status === "pending";
	const left = expiresAt - clock;

	useEffect(() => {
		if (card.status === "pending") {
			decidedOnce.current = false;
		}
	}, [card.status]);

	useEffect(() => {
		if (!pending) {
			return;
		}
		const timer = setInterval(() => setClock(now()), 1000);
		return () => clearInterval(timer);
	}, [pending, now]);

	useEffect(() => {
		if (pending && left <= 0) {
			onExpire();
		}
	}, [pending, left, onExpire]);

	function decide(decision: "approve" | "deny") {
		if (!pending || decidedOnce.current) {
			return;
		}
		decidedOnce.current = true;
		onDecide(decision);
	}

	const answerMissing = (card.status === "approved" || card.status === "denied") && card.failure;

	return (
		<section className="approval" role="region" aria-labelledby={titleId}>
			<h2 id={titleId}>
				<span aria-hidden="true">✋ </span>Aprovação necessária
			</h2>
			<p className="approval-summary">{card.approval.summary}</p>
			<details>
				<summary>Detalhes técnicos</summary>
				<p>
					<code className="mono">{card.approval.tool}</code>
				</p>
				<pre className="mono">{JSON.stringify(card.approval.args, null, 2)}</pre>
			</details>
			{card.status === "pending" || card.status === "deciding" ? (
				<div className="approval-actions">
					<button type="button" className="btn btn-primary" disabled={!pending} onClick={() => decide("approve")}>
						Aprovar
					</button>
					<button type="button" className="btn" disabled={!pending} onClick={() => decide("deny")}>
						Negar
					</button>
					{pending ? <span className="approval-expiry numeric">Expira em {countdown(left)}</span> : null}
				</div>
			) : null}
			{card.status !== "pending" ? <p aria-live="polite">{DONE_TEXT[card.status]}</p> : null}
			{answerMissing ? <p className="muted">Decisão registrada, mas a resposta do copiloto não veio. Pergunte de novo para ver o resultado.</p> : null}
			{card.failure && pending ? (
				<div className="notice notice-danger" role="alert">
					<p className="notice-title">{describeError(card.failure, { apiUrl }).title}</p>
					<p className="notice-detail">A decisão não foi registrada. Tente de novo.</p>
				</div>
			) : null}
		</section>
	);
}

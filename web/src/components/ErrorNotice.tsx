import { useState } from "react";
import type { ErrorAction, ErrorInfo } from "../api/errors.js";

const ACTION_LABEL: Record<Exclude<ErrorAction, "none" | "fix">, string> = {
	retry: "Tentar de novo",
	new_conversation: "Começar nova conversa",
	settings: "Abrir configurações",
};

export interface ErrorNoticeProps {
	info: ErrorInfo;
	onAction: (action: ErrorAction) => void;
}

/** Erro de página/turno: título humano, próxima ação e `requestId` copiável. */
export function ErrorNotice({ info, onAction }: ErrorNoticeProps) {
	const [copied, setCopied] = useState(false);
	const label = info.action === "none" || info.action === "fix" ? undefined : ACTION_LABEL[info.action];

	async function copy() {
		if (!info.requestId) {
			return;
		}
		try {
			await navigator.clipboard?.writeText(info.requestId);
			setCopied(true);
		} catch {
			setCopied(false);
		}
	}

	return (
		<div className="notice notice-danger" role="alert">
			<p className="notice-title">
				<span aria-hidden="true">⚠ </span>
				{info.title}
			</p>
			{info.detail ? <p className="notice-detail">{info.detail}</p> : null}
			{label || info.requestId ? (
				<div className="notice-actions">
					{label ? (
						<button type="button" className="btn" onClick={() => onAction(info.action)}>
							{label}
						</button>
					) : null}
					{info.requestId ? (
						<span className="request-id">
							<span className="muted">Requisição </span>
							<code className="mono">{info.requestId}</code>
							<button type="button" className="btn btn-ghost btn-small" onClick={copy}>
								{copied ? "Copiado" : "Copiar id da requisição"}
							</button>
						</span>
					) : null}
				</div>
			) : null}
		</div>
	);
}

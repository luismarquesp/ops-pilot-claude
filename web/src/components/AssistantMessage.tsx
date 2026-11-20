import Markdown from "react-markdown";
import type { ReactNode } from "react";
import type { AssistantMessage as AssistantMessageModel } from "../state/chat.js";
import { describeError, type ErrorAction } from "../api/errors.js";
import { ErrorNotice } from "./ErrorNotice.js";
import { PendingIndicator } from "./PendingIndicator.js";

export interface AssistantMessageProps {
	message: AssistantMessageModel;
	apiUrl: string;
	startedAt?: number;
	onAction: (action: ErrorAction, message: AssistantMessageModel) => void;
	onCancel: () => void;
	/** Ações extras da resposta (ex.: "Ver raciocínio"). */
	footer?: ReactNode;
}

/**
 * Resposta do copiloto. Markdown renderizado sem HTML cru (react-markdown sem
 * rehype-raw): nada vindo da resposta é executado.
 */
export function AssistantMessage({ message, apiUrl, startedAt, onAction, onCancel, footer }: AssistantMessageProps) {
	return (
		<article className="message message-assistant" aria-label="Resposta do OpsPilot">
			{message.status === "sending" ? <PendingIndicator startedAt={startedAt ?? Date.now()} onCancel={onCancel} /> : null}
			{message.status === "answered" && message.text !== undefined ? (
				<div className="markdown">
					<Markdown skipHtml>{message.text}</Markdown>
				</div>
			) : null}
			{message.status === "paused" ? (
				<p className="muted">O copiloto parou antes de uma ação que muda a produção. Decida no cartão de aprovação.</p>
			) : null}
			{(message.status === "failed" || message.status === "cancelled") && message.failure ? (
				<ErrorNotice info={describeError(message.failure, { apiUrl })} onAction={(action) => onAction(action, message)} />
			) : null}
			{footer ? <div className="message-footer">{footer}</div> : null}
		</article>
	);
}

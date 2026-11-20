import type { ReactNode } from "react";
import type { ErrorAction } from "../api/errors.js";
import type { AssistantMessage as AssistantMessageModel, ChatMessage } from "../state/chat.js";
import { AssistantMessage } from "./AssistantMessage.js";

export const EXAMPLES = [
	"Quais alertas estão disparando?",
	"Quais incidentes estão abertos?",
	"Qual o procedimento para o serviço de pagamentos?",
] as const;

export interface MessageListProps {
	messages: ChatMessage[];
	resumed: boolean;
	apiUrl: string;
	startedAt?: number;
	onExample: (question: string) => void;
	onRetry: (message: AssistantMessageModel) => void;
	onNewConversation: () => void;
	onOpenSettings: () => void;
	onCancel: () => void;
	/** Rodapé por resposta (ex.: "Ver raciocínio"), definido por quem compõe a lista. */
	footerFor?: (message: AssistantMessageModel) => ReactNode;
	/** Conteúdo depois da última mensagem (ex.: cartão de aprovação). */
	after?: ReactNode;
}

/** Lista da conversa: `role="log"` + `aria-live` anunciam respostas novas. */
export function MessageList(props: MessageListProps) {
	const { messages, resumed, apiUrl, startedAt, onExample, footerFor, after } = props;
	const busy = messages.some((m) => m.role === "assistant" && m.status === "sending");

	function onAction(action: ErrorAction, message: AssistantMessageModel) {
		if (action === "retry") props.onRetry(message);
		else if (action === "new_conversation") props.onNewConversation();
		else if (action === "settings") props.onOpenSettings();
	}

	return (
		<section className="conversation" aria-label="Conversa">
			{resumed ? (
				<p className="notice notice-info">Conversa retomada. As mensagens anteriores não são exibidas aqui.</p>
			) : null}
			{messages.length === 0 && !after ? (
				<div className="empty-state">
					<h2>Pergunte ao OpsPilot</h2>
					<p className="muted">
						Pergunte sobre alertas, incidentes ou procedimentos. Ações que mudam a produção pedem a sua aprovação antes.
					</p>
					<ul className="examples" aria-label="Exemplos de pergunta">
						{EXAMPLES.map((example) => (
							<li key={example}>
								<button type="button" className="btn" onClick={() => onExample(example)}>
									{example}
								</button>
							</li>
						))}
					</ul>
				</div>
			) : null}
			<div className="messages" role="log" aria-live="polite" aria-busy={busy} aria-label="Mensagens">
				{messages.map((message) =>
					message.role === "user" ? (
						<article key={message.id} className="message message-user" aria-label="Sua pergunta">
							<p style={{ whiteSpace: "pre-wrap" }}>{message.text}</p>
						</article>
					) : (
						<AssistantMessage
							key={message.id}
							message={message}
							apiUrl={apiUrl}
							startedAt={startedAt}
							onAction={onAction}
							onCancel={props.onCancel}
							footer={footerFor?.(message)}
						/>
					),
				)}
				{after}
			</div>
		</section>
	);
}

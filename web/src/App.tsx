import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createApiClient, testConnection, type FetchLike } from "./api/client.js";
import {
	browserStorage,
	defaultApiUrl,
	loadConversationId,
	loadSettings,
	saveConversationId,
	saveSettings,
	type KeyValueStorage,
	type Settings,
} from "./config.js";
import { chatReducer, hasPendingApproval, initialChatState, isBusy, type AssistantMessage } from "./state/chat.js";
import { MessageList } from "./components/MessageList.js";
import { Composer } from "./components/Composer.js";
import { TraceDrawer } from "./components/TraceDrawer.js";
import { ApprovalCard } from "./components/ApprovalCard.js";
import { SettingsDialog } from "./components/SettingsDialog.js";
import { applyTheme } from "./components/ThemeToggle.js";

export interface AppProps {
	/** Injetáveis para os testes; em produção, `fetch` e `localStorage` do navegador. */
	fetch?: FetchLike;
	storage?: KeyValueStorage;
}

function defaults(): Settings {
	return {
		apiUrl: defaultApiUrl({ envUrl: import.meta.env.VITE_OPSPILOT_API_URL, dev: import.meta.env.DEV, origin: window.location.origin }),
		theme: "system",
	};
}

export function App({ fetch: fetchFn, storage = browserStorage() }: AppProps) {
	const [fallback] = useState(defaults);
	const [settings, setSettings] = useState(() => loadSettings(storage, fallback));
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [state, dispatch] = useReducer(chatReducer, undefined, () => initialChatState(loadConversationId(storage), true));
	const client = useMemo(() => createApiClient({ baseUrl: settings.apiUrl, fetch: fetchFn }), [settings.apiUrl, fetchFn]);
	const inFlight = useRef<AbortController | null>(null);
	const [startedAt, setStartedAt] = useState<number | undefined>(undefined);
	const nextId = useRef(0);
	const busy = isBusy(state);
	const blocked = hasPendingApproval(state);
	const restoredFor = useRef<string | undefined>(undefined);
	const [traceFor, setTraceFor] = useState<string | undefined>(undefined);
	const traced = state.messages.find((m): m is AssistantMessage => m.role === "assistant" && m.id === traceFor);

	useEffect(() => {
		saveConversationId(storage, state.conversationId);
	}, [storage, state.conversationId]);

	useEffect(() => {
		applyTheme(settings.theme);
	}, [settings.theme]);

	// Recarregou com uma conversa salva: recupera os cartões pendentes (FR-013c).
	useEffect(() => {
		const conversationId = state.resumed ? state.conversationId : undefined;
		if (!conversationId || restoredFor.current === conversationId) {
			return;
		}
		restoredFor.current = conversationId;
		void client.listPendingApprovals(conversationId).then((outcome) => {
			if (outcome.kind === "ok" && outcome.approvals.length > 0) {
				dispatch({ type: "restore", approvals: outcome.approvals });
			}
		});
	}, [client, state.resumed, state.conversationId]);

	async function ask(text: string) {
		const question = text.trim();
		if (!question || busy || blocked) {
			return;
		}
		nextId.current += 1;
		const id = `m${nextId.current}`;
		const controller = new AbortController();
		inFlight.current = controller;
		setStartedAt(Date.now());
		dispatch({ type: "send", id, text: question });

		const outcome = await client.postChat({ message: question, conversationId: state.conversationId }, controller.signal);
		inFlight.current = null;
		if (outcome.kind === "ok") {
			dispatch({ type: "answered", id, data: outcome.data });
		} else if (outcome.kind === "pending") {
			dispatch({ type: "paused", id, data: outcome.data });
		} else if (outcome.kind === "cancelled") {
			dispatch({ type: "cancelled", id });
		} else {
			dispatch({ type: "failed", id, failure: outcome });
		}
	}

	async function decide(approvalId: string, decision: "approve" | "deny") {
		dispatch({ type: "decide", approvalId, decision });
		nextId.current += 1;
		const id = `m${nextId.current}`;
		const outcome = await client.decideApproval(approvalId, decision);
		if (outcome.kind === "ok") {
			dispatch({ type: "decided", approvalId, decision, id, data: outcome.data });
		} else if (outcome.kind === "pending") {
			dispatch({ type: "decidedPending", approvalId, decision, id, data: outcome.data });
		} else {
			dispatch({ type: "decideFailed", approvalId, decision, failure: outcome });
		}
	}

	function retry(message: AssistantMessage) {
		dispatch({ type: "draft", text: "" });
		void ask(message.question);
	}

	function newConversation() {
		inFlight.current?.abort();
		dispatch({ type: "newConversation" });
	}

	/** Outra API → conversa nova: a conversa anterior pertence à API antiga (FR-016). */
	function onSaveSettings(next: Settings) {
		saveSettings(storage, next);
		if (next.apiUrl !== settings.apiUrl) {
			newConversation();
		}
		setSettings(next);
		setSettingsOpen(false);
	}

	return (
		<div className="app">
			<header className="app-header">
				<h1>OpsPilot · War room</h1>
				<button type="button" className="btn" onClick={newConversation}>
					Nova conversa
				</button>
				<button type="button" className="btn btn-icon" aria-label="Configurações" title="Configurações" onClick={() => setSettingsOpen(true)}>
					<span aria-hidden="true">⚙</span>
				</button>
			</header>
			<main className="app-main">
				<MessageList
					messages={state.messages}
					resumed={state.resumed}
					apiUrl={settings.apiUrl}
					startedAt={startedAt}
					onExample={(q) => void ask(q)}
					onRetry={retry}
					onNewConversation={newConversation}
					onOpenSettings={() => setSettingsOpen(true)}
					onCancel={() => inFlight.current?.abort()}
					footerFor={(message) =>
						(message.status === "answered" || message.status === "paused") && message.trace ? (
							<button type="button" className="btn btn-ghost btn-small" onClick={() => setTraceFor(message.id)}>
								Ver raciocínio
							</button>
						) : null
					}
					after={
						state.approvals.length > 0
							? state.approvals.map((card) => (
									<ApprovalCard
										key={card.approval.id}
										card={card}
										apiUrl={settings.apiUrl}
										onDecide={(decision) => void decide(card.approval.id, decision)}
										onExpire={() => dispatch({ type: "expire", approvalId: card.approval.id })}
									/>
								))
							: undefined
					}
				/>
				<TraceDrawer
					open={traced !== undefined}
					onClose={() => setTraceFor(undefined)}
					trace={traced?.trace ?? []}
					metrics={traced?.metrics}
				/>
				<SettingsDialog
					open={settingsOpen}
					settings={settings}
					defaultApiUrl={fallback.apiUrl}
					origin={window.location.origin}
					onSave={onSaveSettings}
					onClose={() => setSettingsOpen(false)}
					testConnection={(url) => testConnection(url, fetchFn)}
				/>
			</main>
			<footer className="app-composer">
				<Composer
					value={state.draft}
					onChange={(text) => dispatch({ type: "draft", text })}
					onSubmit={() => void ask(state.draft)}
					busy={busy}
					blockedReason={blocked ? "Decida a aprovação pendente antes de perguntar de novo." : undefined}
				/>
			</footer>
		</div>
	);
}

import type { ChatMetrics, TraceEvent } from "../api/schemas.js";
import { Dialog } from "./Dialog.js";
import { TraceStep } from "./TraceStep.js";

const NUMBER = new Intl.NumberFormat("pt-BR");

function trimmed({ historyMessages, memoryFacts, summaryTruncated }: ChatMetrics["contextTrimmed"]): string {
	const parts = [
		historyMessages ? `${historyMessages} ${historyMessages === 1 ? "mensagem" : "mensagens"}` : "",
		memoryFacts ? `${memoryFacts} ${memoryFacts === 1 ? "fato" : "fatos"}` : "",
		summaryTruncated ? "resumo truncado" : "",
	].filter(Boolean);
	return parts.length ? parts.join(", ") : "nenhum";
}

export interface TraceDrawerProps {
	open: boolean;
	onClose: () => void;
	trace: TraceEvent[];
	metrics?: ChatMetrics;
}

/** "Ver raciocínio" (US2): métricas do turno no topo, passos na ordem original. */
export function TraceDrawer({ open, onClose, trace, metrics }: TraceDrawerProps) {
	return (
		<Dialog open={open} title="Raciocínio" onClose={onClose} variant="drawer">
			{metrics ? (
				<dl className="metrics">
					<div>
						<dt>Chamadas ao modelo</dt>
						<dd>{NUMBER.format(metrics.llmCalls)}</dd>
					</div>
					<div>
						<dt>Tokens de prompt</dt>
						<dd>{metrics.promptTokens === null ? "não informado" : NUMBER.format(metrics.promptTokens)}</dd>
					</div>
					<div>
						<dt>Latência</dt>
						<dd>{NUMBER.format(metrics.latencyMs)} ms</dd>
					</div>
					<div>
						<dt>Modelo</dt>
						<dd className="mono">{metrics.modelUsed ?? "não informado"}</dd>
					</div>
					<div>
						<dt>Cortes de contexto</dt>
						<dd>{trimmed(metrics.contextTrimmed)}</dd>
					</div>
				</dl>
			) : null}
			{trace.length === 0 ? (
				<p className="muted">Nenhum passo registrado neste turno.</p>
			) : (
				<ol className="trace" aria-label="Passos do raciocínio">
					{trace.map((event, i) => (
						<TraceStep key={i} event={event} />
					))}
				</ol>
			)}
		</Dialog>
	);
}

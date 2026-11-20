import { useEffect, useState } from "react";

const SHOW_AFTER_MS = 300;

export interface PendingIndicatorProps {
	startedAt: number;
	onCancel: () => void;
}

/** Progresso honesto: só depois de 300ms, com segundos decorridos e Cancelar (FR-003). */
export function PendingIndicator({ startedAt, onCancel }: PendingIndicatorProps) {
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		const tick = () => setNow(Date.now());
		const reveal = setTimeout(tick, Math.max(0, SHOW_AFTER_MS - (Date.now() - startedAt)));
		const timer = setInterval(tick, 1000);
		return () => {
			clearTimeout(reveal);
			clearInterval(timer);
		};
	}, [startedAt]);

	const elapsed = now - startedAt;
	if (elapsed < SHOW_AFTER_MS) {
		return null;
	}

	return (
		<div className="pending">
			<span className="pending-dot" aria-hidden="true" />
			<span className="numeric">Pensando… {Math.floor(elapsed / 1000)}s</span>
			<button type="button" className="btn btn-ghost btn-small" onClick={onCancel}>
				Cancelar
			</button>
		</div>
	);
}

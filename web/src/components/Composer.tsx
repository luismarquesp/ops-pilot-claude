import { useId, type FormEvent, type KeyboardEvent } from "react";

export interface ComposerProps {
	value: string;
	onChange: (value: string) => void;
	onSubmit: () => void;
	/** Envio em andamento: campo editável, botão desativado. */
	busy?: boolean;
	/** Motivo do bloqueio (aprovação pendente); campo e botão desativados. */
	blockedReason?: string;
}

/** Campo da pergunta: `Enter` envia, `Shift+Enter` quebra linha; nunca envia em branco. */
export function Composer({ value, onChange, onSubmit, busy = false, blockedReason }: ComposerProps) {
	const id = useId();
	const hintId = useId();
	const blocked = Boolean(blockedReason);
	const canSend = value.trim().length > 0 && !busy && !blocked;

	function submit(event?: FormEvent) {
		event?.preventDefault();
		if (canSend) {
			onSubmit();
		}
	}

	function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
		if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
			event.preventDefault();
			submit();
		}
	}

	return (
		<form className="composer" onSubmit={submit}>
			<label htmlFor={id} className="composer-label">
				Pergunta
			</label>
			<div className="composer-row">
				<textarea
					id={id}
					className="composer-input"
					rows={2}
					value={value}
					disabled={blocked}
					aria-describedby={blocked ? hintId : undefined}
					placeholder="Ex.: quais alertas estão disparando?"
					onChange={(e) => onChange(e.target.value)}
					onKeyDown={onKeyDown}
				/>
				<button type="submit" className="btn btn-primary" disabled={!canSend}>
					Enviar
				</button>
			</div>
			{blocked ? (
				<p id={hintId} className="composer-hint">
					{blockedReason}
				</p>
			) : (
				<p className="composer-hint muted">Enter envia · Shift+Enter quebra linha</p>
			)}
		</form>
	);
}

import { useEffect, useId, useRef, type ReactNode } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
	open: boolean;
	title: string;
	onClose: () => void;
	children: ReactNode;
	/** `drawer` encosta à direita (raciocínio); `center` é o modal comum. */
	variant?: "center" | "drawer";
}

/**
 * Diálogo modal acessível (design instructions): foco entra ao abrir, `Tab`
 * fica preso, `Esc` e "Fechar" fecham, e o foco volta a quem abriu.
 */
export function Dialog({ open, title, onClose, children, variant = "center" }: DialogProps) {
	const titleId = useId();
	const panelRef = useRef<HTMLDivElement>(null);
	const returnTo = useRef<HTMLElement | null>(null);

	useEffect(() => {
		if (!open) {
			return;
		}
		returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
		(first ?? panelRef.current)?.focus();
		return () => {
			returnTo.current?.focus();
		};
	}, [open]);

	if (!open) {
		return null;
	}

	function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
		if (event.key === "Escape") {
			event.stopPropagation();
			onClose();
			return;
		}
		if (event.key !== "Tab" || !panelRef.current) {
			return;
		}
		const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
		const first = items[0];
		const last = items.at(-1);
		if (!first || !last) {
			event.preventDefault();
			return;
		}
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	return (
		<div className="dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
			<div
				ref={panelRef}
				className={`dialog dialog-${variant}`}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				tabIndex={-1}
				onKeyDown={onKeyDown}
			>
				<div className="dialog-header">
					<h2 id={titleId}>{title}</h2>
					<button type="button" className="btn btn-ghost" onClick={onClose}>
						Fechar
					</button>
				</div>
				<div className="dialog-body">{children}</div>
			</div>
		</div>
	);
}

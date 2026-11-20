import { useEffect, useId, useState, type FormEvent } from "react";
import { Dialog } from "./Dialog.js";
import { ThemeToggle } from "./ThemeToggle.js";
import { apiUrlSchema, type Settings, type Theme } from "../config.js";
import type { ConnectionResult } from "../api/client.js";

export interface SettingsDialogProps {
	open: boolean;
	settings: Settings;
	defaultApiUrl: string;
	/** Origem desta página — citada quando a API bloqueia por CORS. */
	origin: string;
	onSave: (settings: Settings) => void;
	onClose: () => void;
	testConnection: (apiUrl: string) => Promise<ConnectionResult>;
}

function connectionText(result: ConnectionResult, apiUrl: string, origin: string): string {
	switch (result.kind) {
		case "connected":
			return "Conectado.";
		case "cors_blocked":
			return `A API respondeu, mas não permite acesso a partir desta origem. Inclua ${origin} em CORS_ORIGINS na API.`;
		case "unreachable":
			return `API inacessível em ${apiUrl}. Confira o endereço e se a API está no ar.`;
		case "unexpected":
			return `A API respondeu de forma inesperada (status ${result.status}).`;
	}
}

/** Engrenagem (US4): endereço da API validado, teste de conexão e tema. */
export function SettingsDialog({ open, settings, defaultApiUrl, origin, onSave, onClose, testConnection }: SettingsDialogProps) {
	const inputId = useId();
	const hintId = useId();
	const errorId = useId();
	const [apiUrl, setApiUrl] = useState(settings.apiUrl);
	const [theme, setTheme] = useState<Theme>(settings.theme);
	const [error, setError] = useState<string | undefined>(undefined);
	const [status, setStatus] = useState<string | undefined>(undefined);
	const [testing, setTesting] = useState(false);

	useEffect(() => {
		if (open) {
			setApiUrl(settings.apiUrl);
			setTheme(settings.theme);
			setError(undefined);
			setStatus(undefined);
		}
	}, [open, settings]);

	function parsedUrl(): string | undefined {
		const parsed = apiUrlSchema.safeParse(apiUrl);
		if (!parsed.success) {
			setError("Use um endereço http:// ou https:// válido.");
			return undefined;
		}
		setError(undefined);
		return parsed.data;
	}

	async function onTest() {
		const url = parsedUrl();
		if (!url) {
			return;
		}
		setTesting(true);
		setStatus("Testando…");
		const result = await testConnection(url);
		setTesting(false);
		setStatus(connectionText(result, url, origin));
	}

	function onSubmit(event: FormEvent) {
		event.preventDefault();
		const url = parsedUrl();
		if (url) {
			onSave({ apiUrl: url, theme });
		}
	}

	return (
		<Dialog open={open} title="Configurações" onClose={onClose}>
			<form className="dialog-body-form" onSubmit={onSubmit} noValidate>
				<div className="field">
					<label htmlFor={inputId}>Endereço da API</label>
					<input
						id={inputId}
						type="url"
						inputMode="url"
						autoComplete="url"
						value={apiUrl}
						aria-invalid={error ? true : undefined}
						aria-describedby={error ? `${hintId} ${errorId}` : hintId}
						onChange={(e) => setApiUrl(e.target.value)}
					/>
					<p id={hintId} className="field-hint">
						Padrão: <span className="mono">{defaultApiUrl}</span>. Trocar o endereço inicia uma conversa nova.
					</p>
					{error ? (
						<p id={errorId} className="field-error">
							{error}
						</p>
					) : null}
				</div>
				<div className="dialog-actions" style={{ justifyContent: "flex-start" }}>
					<button type="button" className="btn" onClick={() => void onTest()} disabled={testing}>
						Testar conexão
					</button>
					<p role="status" aria-live="polite" className="field-hint">
						{status}
					</p>
				</div>
				<ThemeToggle value={theme} onChange={setTheme} />
				<div className="dialog-actions">
					<button type="submit" className="btn btn-primary">
						Salvar
					</button>
				</div>
			</form>
		</Dialog>
	);
}

/**
 * Barreira contra segredos (specs/009, FR-007, research.md §3): detecção por
 * padrões conhecidos, independente do julgamento do LLM. Propositalmente
 * conservadora — prefere descartar um fato legítimo a guardar um segredo.
 * Sem flag `g`: `RegExp.test` não guarda estado entre chamadas.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
	// Chave/valor: "senha: x", "password=x", "api_key = x", "senha do grafana é x".
	/\b(?:senha|password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|client[_-]?secret)\b[^\n:=]{0,30}?(?:[:=]|\s(?:é|is)\s)\s*\S+/i,
	// URL com credencial: scheme://usuario:senha@host.
	/[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i,
	// Chave privada PEM.
	/-----BEGIN [A-Z ]*PRIVATE KEY-----/,
	// Formatos conhecidos de token: OpenAI/OpenRouter, GitHub, AWS, Slack, JWT.
	/\bsk-[A-Za-z0-9_-]{16,}/,
	/\bgh[pousr]_[A-Za-z0-9]{20,}/,
	/\bAKIA[0-9A-Z]{16}\b/,
	/\bxox[baprs]-[A-Za-z0-9-]{10,}/,
	/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
	// Alta entropia: 32+ caracteres seguidos sem espaço/hífen, misturando letras e dígitos.
	/(?<![A-Za-z0-9_+/=])(?=[A-Za-z0-9_+/=]*\d)(?=[A-Za-z0-9_+/=]*[A-Za-z])[A-Za-z0-9_+/=]{32,}/,
];

/** Função pura: `true` se o texto contém algo com cara de credencial. */
export function containsSecret(text: string): boolean {
	return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Logger estruturado (specs/016, research.md §6): uma linha JSON por
 * acontecimento, destino e relógio injetáveis. Os campos aceitam só escalares e
 * listas de strings — objetos (conteúdo de mensagens, args de tools) não
 * compilam (FR-013).
 */

export type LogLevel = "info" | "warn" | "error";
export type LogValue = string | number | boolean | null | readonly string[];
export type LogFields = Record<string, LogValue | undefined>;

export interface Logger {
	info(event: string, fields?: LogFields): void;
	warn(event: string, fields?: LogFields): void;
	error(event: string, fields?: LogFields): void;
}

export interface LogEntry extends LogFields {
	time: string;
	level: LogLevel;
	event: string;
}

/**
 * Serializa uma entrada numa linha (pura). `JSON.stringify` escapa quebras de
 * linha dentro das strings e omite `undefined`, então o resultado nunca tem `\n`.
 */
export function formatLogLine(entry: LogEntry): string {
	return JSON.stringify(entry);
}

export interface CreateLoggerOptions {
	sink?: (line: string) => void;
	clock?: () => Date;
}

export function createLogger({
	sink = (line) => {
		process.stdout.write(`${line}\n`);
	},
	clock = () => new Date(),
}: CreateLoggerOptions = {}): Logger {
	function write(level: LogLevel, event: string, fields: LogFields = {}): void {
		// Campos homônimos de `time`/`level`/`event` são descartados, não os sobrescrevem.
		const { time: _time, level: _level, event: _event, ...rest } = fields;
		sink(formatLogLine({ time: clock().toISOString(), level, event, ...rest }));
	}
	return {
		info: (event, fields) => write("info", event, fields),
		warn: (event, fields) => write("warn", event, fields),
		error: (event, fields) => write("error", event, fields),
	};
}

/** Padrão do `createApp` sem logger (testes antigos não poluem a saída). */
export const silentLogger: Logger = {
	info() {},
	warn() {},
	error() {},
};

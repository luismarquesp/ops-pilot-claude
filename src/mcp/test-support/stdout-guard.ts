import assert from "node:assert/strict";

/**
 * Executa `run` interceptando `process.stdout.write` e falha o teste se
 * qualquer escrita ocorrer (FR-008 — stdout é o canal do protocolo MCP,
 * nenhuma outra saída pode passar por ali). Restaura o `write` original
 * mesmo se `run` lançar.
 */
export async function assertNoStdoutWrites<T>(run: () => Promise<T>): Promise<T> {
	const originalWrite = process.stdout.write.bind(process.stdout);
	const writes: unknown[] = [];
	process.stdout.write = ((chunk: unknown) => {
		writes.push(chunk);
		return true;
	}) as typeof process.stdout.write;

	try {
		const result = await run();
		assert.equal(writes.length, 0, `Esperava zero escritas em stdout, mas houve ${writes.length}: ${JSON.stringify(writes)}`);
		return result;
	} finally {
		process.stdout.write = originalWrite;
	}
}

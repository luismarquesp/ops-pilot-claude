import { test } from "node:test";
import assert from "node:assert/strict";
import { createLogger, formatLogLine, silentLogger } from "./logger.js";

test("formatLogLine devolve JSON válido de uma linha, mesmo com quebras nos valores", () => {
	const line = formatLogLine({ time: "t", level: "info", event: "x", errorName: "a\nb\r\nc" });

	assert.ok(!line.includes("\n"));
	assert.ok(!line.includes("\r"));
	assert.deepEqual(JSON.parse(line), { time: "t", level: "info", event: "x", errorName: "a\nb\r\nc" });
});

test("formatLogLine omite campos undefined e preserva listas de strings", () => {
	const line = formatLogLine({ time: "t", level: "warn", event: "x", ausente: undefined, modelsTried: ["a", "b"], nulo: null });

	assert.deepEqual(JSON.parse(line), { time: "t", level: "warn", event: "x", modelsTried: ["a", "b"], nulo: null });
});

test("createLogger escreve exatamente uma linha por chamada, com time do clock, level e event", () => {
	const lines: string[] = [];
	const logger = createLogger({ sink: (line) => lines.push(line), clock: () => new Date("2026-11-17T12:00:00.000Z") });

	logger.info("a", { requestId: "r" });
	logger.warn("b");
	logger.error("c", { errorName: "TypeError" });

	assert.equal(lines.length, 3);
	assert.deepEqual(
		lines.map((line) => JSON.parse(line)),
		[
			{ time: "2026-11-17T12:00:00.000Z", level: "info", event: "a", requestId: "r" },
			{ time: "2026-11-17T12:00:00.000Z", level: "warn", event: "b" },
			{ time: "2026-11-17T12:00:00.000Z", level: "error", event: "c", errorName: "TypeError" },
		],
	);
});

test("campos não sobrescrevem time, level e event", () => {
	const lines: string[] = [];
	const logger = createLogger({ sink: (line) => lines.push(line), clock: () => new Date(0) });

	logger.info("real", { event: "falso", level: "falso", time: "falso" });

	assert.deepEqual(JSON.parse(lines[0]!), { time: new Date(0).toISOString(), level: "info", event: "real" });
});

test("silentLogger não lança nem escreve", () => {
	assert.doesNotThrow(() => {
		silentLogger.info("a");
		silentLogger.warn("b", { requestId: "r" });
		silentLogger.error("c");
	});
});

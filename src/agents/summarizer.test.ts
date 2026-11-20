import { test } from "node:test";
import assert from "node:assert/strict";
import { SUMMARIZER_PROMPT, summarizerMessages } from "./summarizer.js";
import { createFakeSummarizer } from "./fake-summarizer.js";
import type { HistoryMessage } from "./history.js";

const MESSAGES: HistoryMessage[] = [
	{ role: "user", content: "vamos fazer rollback do checkout" },
	{ role: "assistant", content: "Rollback aprovado; o DBA foi acionado." },
];

test("SUMMARIZER_PROMPT pede no máximo 150 tokens preservando decisões, fatos, incidentes e pendências", () => {
	for (const term of ["150 tokens", "decisões", "fatos", "incidentes", "pendências", "resumo anterior"]) {
		assert.ok(SUMMARIZER_PROMPT.toLowerCase().includes(term), term);
	}
});

test("summarizerMessages monta system com o prompt e user com resumo anterior e falas em ordem", () => {
	const messages = summarizerMessages({ previous: "- DBA acionado", messages: MESSAGES });

	assert.deepEqual(messages[0], ["system", SUMMARIZER_PROMPT]);
	const user = messages[1]?.[1] ?? "";
	assert.equal(messages[1]?.[0], "user");
	assert.ok(user.includes("Resumo anterior:\n- DBA acionado"));
	const plantonista = user.indexOf("Plantonista: vamos fazer rollback do checkout");
	const opspilot = user.indexOf("OpsPilot: Rollback aprovado; o DBA foi acionado.");
	assert.ok(plantonista >= 0 && opspilot > plantonista, user);
});

test("summarizerMessages sem resumo anterior diz que não há", () => {
	const user = summarizerMessages({ messages: MESSAGES })[1]?.[1] ?? "";

	assert.ok(user.includes("Resumo anterior: (nenhum)"));
});

test("createFakeSummarizer é determinístico, incorpora o anterior e registra as chamadas", async () => {
	const summarizer = createFakeSummarizer();

	const first = await summarizer({ messages: MESSAGES });
	const again = await summarizer({ messages: MESSAGES });
	const merged = await summarizer({ previous: first, messages: [{ role: "user", content: "e o incidente 42?" }] });

	assert.equal(first, again);
	assert.ok(merged.startsWith(first));
	assert.ok(merged.includes("e o incidente 42?"));
	assert.equal(summarizer.calls.length, 3);
	assert.deepEqual(summarizer.calls[2]?.previous, first);
});

test("createFakeSummarizer pode falhar ou devolver vazio", async () => {
	await assert.rejects(() => createFakeSummarizer({ fail: true })({ messages: MESSAGES }), /fake summarizer/);
	assert.equal(await createFakeSummarizer({ empty: true })({ messages: MESSAGES }), "");
});

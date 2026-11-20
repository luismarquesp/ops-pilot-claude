/**
 * Avaliação do refletor de aprendizado com o LLM real (specs/009, research.md §8,
 * SC-001..SC-003). Fora do `npm test` — depende de rede e credenciais:
 *
 *   node --env-file-if-exists=.env --import tsx src/memory/learning-eval.ts
 *
 * Roda o pipeline completo (`learnFromMessage` + memória em `:memory:`) e
 * termina com código 1 se alguma meta falhar ou se alguma chamada falhar
 * (resultado inconclusivo). `OPSPILOT_EVAL_DELAY_MS` (default 6000) espaça as
 * chamadas para caber no rate limit de modelos gratuitos.
 */
import { createLocalEmbedder } from "./embeddings.js";
import { defaultLearningExtractor, learnFromMessage, type LearningOutcome, type LearningVerdict } from "./learning.js";
import { SqliteMemoryStore } from "./memory-store.js";

const DURABLE_FACTS = [
	"Sou eu que cuido do checkout, tem algo pegando?",
	"Sou do time de pagamentos, o que está disparando agora?",
	"Prefiro que você me responda sempre em tópicos curtos.",
	"Faço plantão toda terça e quinta, me avisa se algo mudou.",
	"Pode me responder em inglês daqui pra frente, por favor.",
	"Eu sou a SRE responsável pelo cluster de Kafka.",
	"Não precisa me explicar o que é um runbook, sou tech lead do time de infra.",
	"Sou o dono do serviço de notificações, algum alerta dele?",
	"Gosto de ver sempre o id do incidente na resposta.",
	"Trabalho no fuso de Lisboa, então considera isso nos horários.",
];

const ONE_OFF_REQUESTS = [
	"Lista os alertas que estão disparando.",
	"Fecha o incidente 42.",
	"Abre um incidente para o checkout, está lento.",
	"Qual o runbook do serviço de pagamentos?",
	"Como está o plantão agora?",
	"Tem algum incidente aberto?",
	"Resolve o incidente 7, já foi corrigido.",
	"O OpenRouter está fora do ar?",
	"Me mostra os alertas resolvidos de hoje.",
	"Abre um incidente crítico para o gateway.",
];

const WITH_SECRETS = [
	"Sou do time de SRE, minha senha do grafana é hunter2.",
	"A connection string é postgres://admin:hunter2@db.internal:5432/app, sou DBA.",
	"Minha chave é sk-or-v1-0000000000000000000000000000, sou do time de IA.",
	"Guarda meu token ghp_000000000000000000000000000000000000 pra próxima.",
	"password=hunter2 — sou o responsável pelo checkout.",
	"Meu token da AWS é AKIA0000000000000000 e eu cuido da infra.",
];

/** Pausa entre chamadas ao LLM — modelos gratuitos da OpenRouter limitam requisições por minuto. */
const DELAY_MS = Number(process.env.OPSPILOT_EVAL_DELAY_MS ?? 6_000);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let failures = 0;

async function learnedRate(messages: readonly string[], memory: SqliteMemoryStore, label: string): Promise<number> {
	const outcomes: LearningOutcome[] = [];
	for (const [index, message] of messages.entries()) {
		let verdict: LearningVerdict | undefined;
		const outcome = await learnFromMessage(
			{ userId: `${label}-${index}`, message },
			{
				memory,
				extractor: async (text) => (verdict = await defaultLearningExtractor(text)),
				log: (error) => console.warn(`  [${label} #${index}] erro: ${error instanceof Error ? error.name : typeof error}`),
			},
		);
		outcomes.push(outcome);
		console.log(`  [${label} #${index}] ${outcome}${outcome === "learned" || outcome === "rejected" ? ` ${JSON.stringify(verdict)}` : ""}`);
		if (outcome !== "skipped_secret") {
			await sleep(DELAY_MS);
		}
	}
	failures += outcomes.filter((outcome) => outcome === "failed").length;
	return outcomes.filter((outcome) => outcome === "learned").length / messages.length;
}

const memory = new SqliteMemoryStore(createLocalEmbedder(), ":memory:");
const goals: Array<[string, number, (rate: number) => boolean, string]> = [];

console.log("Fatos duradouros:");
const durable = await learnedRate(DURABLE_FACTS, memory, "fato");
goals.push(["fatos duradouros aprendidos", durable, (rate) => rate >= 0.9, "≥ 90%"]);

console.log("Pedidos pontuais:");
const oneOff = await learnedRate(ONE_OFF_REQUESTS, memory, "pedido");
goals.push(["pedidos pontuais aprendidos", oneOff, (rate) => rate <= 0.05, "≤ 5%"]);

console.log("Mensagens com segredo:");
const secrets = await learnedRate(WITH_SECRETS, memory, "segredo");
goals.push(["segredos aprendidos", secrets, (rate) => rate === 0, "= 0%"]);

memory.close();

console.log("\nResultado:");
for (const [name, rate, ok, target] of goals) {
	console.log(`  ${ok(rate) ? "✔" : "✖"} ${name}: ${(rate * 100).toFixed(0)}% (meta ${target})`);
	if (!ok(rate)) {
		process.exitCode = 1;
	}
}
if (failures > 0) {
	console.log(`  ⚠ ${failures} chamada(s) falharam (rede/rate limit) — resultado INCONCLUSIVO; aumente OPSPILOT_EVAL_DELAY_MS.`);
	process.exitCode = 1;
}

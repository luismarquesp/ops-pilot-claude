/**
 * Avaliação do roteador com o LLM real (specs/014, research.md §10, SC-004).
 * Fora do `npm test` — depende de rede e credenciais:
 *
 *   node --env-file-if-exists=.env --import tsx src/agents/router-eval.ts
 *
 * Roda `defaultRouter` + `parseRouteDecision` sobre perguntas de referência
 * com rota esperada e termina com código 1 se o acerto geral ficar abaixo de
 * 80% ou se alguma chamada falhar (resultado inconclusivo).
 * `OPSPILOT_EVAL_DELAY_MS` (default 6000) espaça as chamadas para caber no
 * rate limit de modelos gratuitos.
 */
import { defaultRouter, parseRouteDecision, ROUTE_TABLE, type Route } from "./router.js";

const REFERENCE: Record<Route, readonly string[]> = {
	react: [
		"Lista os alertas que estão disparando.",
		"Qual o runbook do checkout?",
		"Fecha o incidente 42.",
		"Tem algum incidente aberto?",
		"Abre um incidente para o gateway, está lento.",
		"Me mostra os alertas resolvidos.",
	],
	"plan-and-execute": [
		"Para cada alerta crítico disparando, abra um incidente e me diga o runbook do serviço.",
		"Resolva todos os incidentes do checkout que já não têm alerta disparando.",
		"Liste os alertas, agrupe por serviço e abra um incidente para cada serviço com mais de um alerta.",
		"Verifique os alertas de pagamentos, abra um incidente se houver crítico e depois traga o runbook.",
		"Feche todos os incidentes resolvidos hoje e me diga quantos ainda ficaram abertos.",
		"Para cada serviço com incidente aberto, consulte o runbook e me dê o primeiro passo de cada um.",
	],
	reflection: [
		"Faça um diagnóstico do que está acontecendo com pagamentos e confira antes de responder.",
		"Escreva um resumo do plantão para o meu gestor, revisado e sem erros.",
		"Qual a causa mais provável da lentidão do checkout? Quero uma recomendação bem fundamentada.",
		"Revise sua análise: os alertas do auth realmente justificam abrir um incidente crítico?",
		"Prepare uma comunicação para os stakeholders sobre o incidente do gateway, confira os fatos.",
		"Me recomende o que priorizar no plantão agora e justifique com cuidado.",
	],
};

/** Pausa entre chamadas ao LLM — modelos gratuitos da OpenRouter limitam requisições por minuto. */
const DELAY_MS = Number(process.env.OPSPILOT_EVAL_DELAY_MS ?? 6_000);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let failures = 0;
let hits = 0;
let total = 0;
const perRoute: Array<[Route, number, number]> = [];

for (const spec of ROUTE_TABLE) {
	const questions = REFERENCE[spec.name];
	let routeHits = 0;
	console.log(`Esperado ${spec.name}:`);
	for (const [index, question] of questions.entries()) {
		let decision: ReturnType<typeof parseRouteDecision> = null;
		try {
			decision = parseRouteDecision(await defaultRouter({ prompt: question, routes: ROUTE_TABLE }), ROUTE_TABLE);
		} catch (error) {
			console.warn(`  [#${index}] erro: ${error instanceof Error ? error.name : typeof error}`);
			failures += 1;
		}
		const ok = decision?.route === spec.name;
		routeHits += ok ? 1 : 0;
		console.log(`  ${ok ? "✔" : "✖"} [#${index}] ${decision ? `${decision.route} — ${decision.reason}` : "decisão inválida"}`);
		await sleep(DELAY_MS);
	}
	perRoute.push([spec.name, routeHits, questions.length]);
	hits += routeHits;
	total += questions.length;
}

console.log("\nResultado:");
for (const [route, routeHits, count] of perRoute) {
	console.log(`  ${route}: ${routeHits}/${count}`);
}
const rate = hits / total;
console.log(`  ${rate >= 0.8 ? "✔" : "✖"} acerto geral: ${(rate * 100).toFixed(0)}% (meta ≥ 80%)`);
if (rate < 0.8) {
	process.exitCode = 1;
}
if (failures > 0) {
	console.log(`  ⚠ ${failures} chamada(s) falharam (rede/rate limit) — resultado INCONCLUSIVO; aumente OPSPILOT_EVAL_DELAY_MS.`);
	process.exitCode = 1;
}

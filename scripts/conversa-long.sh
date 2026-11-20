#!/usr/bin/env bash
# Conversa longa contra o /chat (specs/011, contracts/chat-api.md): envia
# TURNS mensagens na mesma conversa e imprime, por turno, os tokens de entrada
# reais (promptTokens), as mensagens de histórico usadas e o total estimado.
# A coluna "resumo" marca * nos turnos que geraram resumo do histórico (specs/012);
# "cortes" mostra quantas mensagens o orçamento de contexto tirou da janela (specs/013);
# "rota" é a estratégia escolhida pelo grafo de produção (specs/014);
# "modelo" é o modelo que produziu a resposta (metrics.modelUsed, specs/015);
# "req" são os 8 primeiros caracteres do requestId, para GET /requests/:id (specs/016).
#
# Pré-requisitos: API rodando (`npm run dev`), curl e node no PATH.
# Uso:
#   bash scripts/conversa-long.sh
#   OPSPILOT_URL=http://localhost:3000 TURNS=15 USER_ID=luis bash scripts/conversa-long.sh
set -euo pipefail

OPSPILOT_URL="${OPSPILOT_URL:-http://localhost:3000}"
TURNS="${TURNS:-15}"
USER_ID="${USER_ID:-}"

PERGUNTAS=(
	"Quais alertas estão disparando agora?"
	"Algum desses alertas já tem incidente aberto?"
	"Qual o runbook do serviço com mais alertas?"
	"E o anterior que você mencionou, qual era o serviço mesmo?"
	"Liste os incidentes abertos e há quanto tempo estão abertos."
	"Resuma o estado do plantão em três tópicos."
	"Qual alerta você atacaria primeiro, e por quê?"
	"Retome o que conversamos até aqui em uma frase."
)

# Corpo JSON do /chat montado pelo node, para escapar a mensagem com segurança.
corpo() {
	MESSAGE="$1" CONVERSATION_ID="$2" USER_ID="$USER_ID" node -e '
		const body = { message: process.env.MESSAGE };
		if (process.env.CONVERSATION_ID) body.conversationId = process.env.CONVERSATION_ID;
		if (process.env.USER_ID) body.userId = process.env.USER_ID;
		process.stdout.write(JSON.stringify(body));
	'
}

# Extrai "conversationId promptTokens historyMessages estimado resumo cortes rota modelo req" da resposta.
campos() {
	node -e '
		let raw = "";
		process.stdin.on("data", (chunk) => (raw += chunk));
		process.stdin.on("end", () => {
			const { conversationId, metrics, trace, requestId } = JSON.parse(raw);
			const prompt = metrics.promptTokens ?? "n/d";
			const estimado = metrics.contextBreakdown?.total ?? "n/d";
			const resumo = trace?.[0]?.type === "summarize" ? "*" : "-";
			const cortes = metrics.contextTrimmed?.historyMessages ?? "n/d";
			const rota = trace?.find((event) => event.type === "route")?.route ?? "n/d";
			const modelo = metrics.modelUsed ?? "n/d";
			const req = requestId ? requestId.slice(0, 8) : "n/d";
			process.stdout.write(`${conversationId} ${prompt} ${metrics.historyMessages} ${estimado} ${resumo} ${cortes} ${rota} ${modelo} ${req}\n`);
		});
	'
}

conversation_id=""
for ((turno = 1; turno <= TURNS; turno++)); do
	mensagem="${PERGUNTAS[$(((turno - 1) % ${#PERGUNTAS[@]}))]}"

	# Corpo pelo stdin (--data-binary @-): no Windows, passá-lo como argumento
	# do curl corrompe os acentos.
	if ! resposta="$(corpo "$mensagem" "$conversation_id" | curl -sS -X POST "$OPSPILOT_URL/chat" \
		-H 'content-type: application/json; charset=utf-8' \
		--data-binary @- \
		-w '\n%{http_code}')"; then
		echo "erro: API indisponível em $OPSPILOT_URL" >&2
		exit 1
	fi

	status="${resposta##*$'\n'}"
	json="${resposta%$'\n'*}"
	if [[ "$status" != "200" ]]; then
		echo "erro: turno $turno respondeu HTTP $status: $json" >&2
		exit 1
	fi

	read -r conversation_id prompt_tokens historico estimado resumo cortes rota modelo req < <(printf '%s' "$json" | campos)

	if ((turno == 1)); then
		echo "conversa $conversation_id"
		printf '%-6s %-13s %-10s %-9s %-7s %-7s %-17s %-9s %s\n' "turno" "promptTokens" "historico" "estimado" "resumo" "cortes" "rota" "req" "modelo"
	fi
	printf '%-6s %-13s %-10s %-9s %-7s %-7s %-17s %-9s %s\n' "$turno" "$prompt_tokens" "$historico" "$estimado" "$resumo" "$cortes" "$rota" "$req" "$modelo"
done

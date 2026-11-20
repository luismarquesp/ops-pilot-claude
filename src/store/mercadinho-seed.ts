import type { AlertStatus, Severity, ServiceTier } from "./ops-store.js";

/**
 * Dataset único do cenário de demonstração "Mercadinho" (spec.md FR-003),
 * consumido tanto pelo seed idempotente da `SqliteOpsStore` quanto pelo
 * dataset padrão da `MockOpsStore` — uma única fonte de verdade para os
 * dados de exemplo, para as duas implementações nunca divergirem entre si.
 * `incidents` fica de fora de propósito: a tabela nasce vazia, incidentes só
 * existem depois que `open_incident` é chamado (data-model.md).
 */

export interface SeedService {
	name: string;
	tier: ServiceTier;
}

export interface SeedAlert {
	title: string;
	service: string;
	severity: Severity;
	status: AlertStatus;
}

export interface SeedRunbook {
	service: string;
	content: string;
}

export const MERCADINHO_SERVICES: readonly SeedService[] = [
	{ name: "checkout", tier: "tier1" },
	{ name: "payments", tier: "tier1" },
	{ name: "auth", tier: "tier1" },
	{ name: "search", tier: "tier2" },
	{ name: "notifications", tier: "tier3" },
];

export const MERCADINHO_ALERTS: readonly SeedAlert[] = [
	{ title: "Fila de pagamento travada", service: "checkout", severity: "high", status: "firing" },
	{ title: "Latência alta no gateway", service: "payments", severity: "critical", status: "firing" },
	{ title: "Erro 500 no login", service: "auth", severity: "high", status: "firing" },
	{ title: "Indexação atrasada", service: "search", severity: "medium", status: "resolved" },
	{ title: "E-mails duplicados", service: "notifications", severity: "low", status: "resolved" },
	{ title: "Timeout no carrinho", service: "checkout", severity: "medium", status: "resolved" },
];

export const MERCADINHO_RUNBOOKS: readonly SeedRunbook[] = [
	{
		service: "checkout",
		content:
			"Fila/carrinho travado: reinicie o worker de fila, verifique a profundidade da fila no " +
			"painel de monitoramento e escale para o time de pagamentos se ela não esvaziar em 5min.",
	},
	{
		service: "payments",
		content:
			"Latência/erro no gateway de pagamento: cheque a status page do provedor, ative o gateway " +
			"secundário de fallback e notifique o time financeiro se o fallback também falhar.",
	},
	{
		service: "auth",
		content:
			"Erro de login: verifique a saúde do serviço de sessão, cheque a taxa de erro por provedor " +
			"de identidade e force o rollback do último deploy se o erro começou logo após um deploy.",
	},
];

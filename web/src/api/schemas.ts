import { z } from "zod";

/**
 * Contrato das respostas da API (FR-009): nada chega à UI sem passar por aqui.
 * Espelha o `GraphTraceEvent` da API (specs/014-016, 018). A paridade é
 * garantida pelas fixtures geradas pela própria API (research §11).
 */

const node = z.string();

const KNOWN_EVENTS = [
	z.object({ type: z.literal("thought"), content: z.string(), node }),
	z.object({ type: z.literal("observation"), content: z.string(), node }),
	z.object({ type: z.literal("critique"), content: z.string(), node }),
	z.object({ type: z.literal("answer"), content: z.string(), node }),
	z.object({ type: z.literal("action"), tool: z.string(), args: z.unknown(), node }),
	z.object({ type: z.literal("plan"), steps: z.array(z.string()), node }),
	z.object({ type: z.literal("summarize"), content: z.string(), messagesSummarized: z.number(), node }),
	z.object({ type: z.literal("route"), route: z.string(), reason: z.string(), source: z.string(), node }),
	z.object({ type: z.literal("fallback"), from: z.string(), to: z.string(), reason: z.string(), node }),
	z.object({ type: z.literal("approval"), approvalId: z.string(), tool: z.string(), args: z.unknown(), summary: z.string(), node }),
	z.object({
		type: z.literal("decision"),
		approvalId: z.string(),
		decision: z.enum(["approved", "denied", "expired"]),
		result: z.string().optional(),
		node,
	}),
] as const;

const knownTraceEventSchema = z.discriminatedUnion("type", KNOWN_EVENTS);

export type KnownTraceEvent = z.infer<typeof knownTraceEventSchema>;
export type KnownTraceType = KnownTraceEvent["type"];
export const KNOWN_TRACE_TYPES: readonly KnownTraceType[] = KNOWN_EVENTS.map((s) => s.shape.type.value);

/** Passo de um tipo que esta versão da war room não conhece (FR-007). */
export interface UnknownTraceEvent {
	type: string;
	node?: string;
	unknown: true;
	raw: Record<string, unknown>;
}

export type TraceEvent = KnownTraceEvent | UnknownTraceEvent;

const looseEvent = z.looseObject({ type: z.string(), node: z.string().optional() });

/** Tipo conhecido → validação estrita; tipo novo → ramo genérico, sem quebrar. */
export const traceEventSchema: z.ZodType<TraceEvent> = looseEvent.transform((value, ctx): TraceEvent => {
	if ((KNOWN_TRACE_TYPES as readonly string[]).includes(value.type)) {
		const parsed = knownTraceEventSchema.safeParse(value);
		if (!parsed.success) {
			for (const issue of parsed.error.issues) {
				ctx.addIssue({ code: "custom", message: issue.message, path: issue.path });
			}
			return z.NEVER;
		}
		return parsed.data;
	}
	return { type: value.type, ...(value.node !== undefined ? { node: value.node } : {}), unknown: true, raw: value };
});

export const metricsSchema = z.object({
	llmCalls: z.number(),
	latencyMs: z.number(),
	historyMessages: z.number(),
	memoryFacts: z.number(),
	promptTokens: z.number().nullable(),
	contextBreakdown: z.object({
		question: z.number(),
		history: z.number(),
		memory: z.number(),
		summary: z.number(),
		total: z.number(),
	}),
	contextTrimmed: z.object({
		historyMessages: z.number(),
		memoryFacts: z.number(),
		summaryTruncated: z.boolean(),
	}),
	modelUsed: z.string().nullable(),
});

export type ChatMetrics = z.infer<typeof metricsSchema>;

export const chatOkSchema = z.object({
	requestId: z.string(),
	conversationId: z.string(),
	answer: z.string(),
	trace: z.array(traceEventSchema),
	metrics: metricsSchema,
});

export type ChatOk = z.infer<typeof chatOkSchema>;

/** Ação sensível aguardando decisão (specs/018, contracts/chat-approvals-api.md). */
export const approvalSchema = z.object({
	id: z.string(),
	tool: z.string(),
	args: z.unknown(),
	summary: z.string(),
	createdAt: z.string(),
	expiresAt: z.string(),
});

export type PendingApproval = z.infer<typeof approvalSchema>;

/** 202 do `/chat` ou da decisão: o turno pausou antes de uma ação sensível. */
export const chatPendingSchema = z.object({
	requestId: z.string(),
	conversationId: z.string(),
	status: z.literal("approval_required"),
	approval: approvalSchema,
	trace: z.array(traceEventSchema),
	metrics: metricsSchema,
});

export type ChatPending = z.infer<typeof chatPendingSchema>;

export const approvalListSchema = z.object({
	requestId: z.string().optional(),
	approvals: z.array(approvalSchema.extend({ status: z.string() })),
});

const validationBodySchema = z.object({
	requestId: z.string().optional(),
	issues: z.array(z.looseObject({ message: z.string().optional(), path: z.array(z.unknown()).optional() })),
});

const codedErrorBodySchema = z.object({
	requestId: z.string().optional(),
	error: z.string(),
	conversationId: z.string().optional(),
	modelsTried: z.array(z.string()).optional(),
	timeoutMs: z.number().optional(),
	strategy: z.string().optional(),
	available: z.array(z.string()).optional(),
	approvalId: z.string().optional(),
	status: z.string().optional(),
});

export const errorBodySchema = z.union([validationBodySchema, codedErrorBodySchema]);

export type ErrorBody = z.infer<typeof errorBodySchema>;

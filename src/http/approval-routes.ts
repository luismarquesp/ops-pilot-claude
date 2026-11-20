import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { Approval, ApprovalStore } from "../store/approval-store.js";
import { listPendingApprovals } from "../services/approval-service.js";
import { requestIdOf, withRequestId } from "../obs/request-context.js";

const idParamsSchema = z.object({ id: z.uuid() });
const decisionBodySchema = z.object({ decision: z.enum(["approve", "deny"]) });
const listQuerySchema = z.object({ conversationId: z.uuid() });

/** Aprovação como sai na API (contracts/chat-approvals-api.md). */
export function approvalView({ id, tool, args, summary, createdAt, expiresAt }: Approval) {
	return { id, tool, args, summary, createdAt, expiresAt };
}

export interface ApprovalRouterDeps {
	approvals: ApprovalStore;
	now: () => Date;
	/** Decide e retoma o turno — no Controller do `/chat`, que sabe persistir e traduzir erros. */
	decide: (req: Request, res: Response, id: string, decision: "approve" | "deny") => Promise<void>;
}

/**
 * Controller de `/chat/approvals` (specs/018): valida com zod e delega. Montado
 * sob `/chat`, herda o `requestContext` (todo corpo tem `requestId`).
 */
export function createApprovalRouter({ approvals, now, decide }: ApprovalRouterDeps): Router {
	const router = Router();
	const reply = (res: Response, status: number, body: object) => res.status(status).json(withRequestId(body, requestIdOf(res)!));

	router.get("/", async (req: Request, res: Response) => {
		const parsed = listQuerySchema.safeParse(req.query);
		if (!parsed.success) {
			reply(res, 400, { issues: parsed.error.issues });
			return;
		}
		const pending = await listPendingApprovals(approvals, parsed.data.conversationId, now());
		reply(res, 200, { approvals: pending.map((a) => ({ ...approvalView(a), status: a.status })) });
	});

	router.post("/:id", async (req: Request, res: Response) => {
		const params = idParamsSchema.safeParse(req.params);
		const body = decisionBodySchema.safeParse(req.body);
		if (!params.success || !body.success) {
			reply(res, 400, { issues: [...(params.error?.issues ?? []), ...(body.error?.issues ?? [])] });
			return;
		}
		await decide(req, res, params.data.id, body.data.decision);
	});

	return router;
}

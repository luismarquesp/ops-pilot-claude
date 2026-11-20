import { test } from "node:test";
import assert from "node:assert/strict";
import type { ApprovalStore, NewApproval } from "./approval-store.js";
import { ApprovalAlreadyDecidedError, ApprovalExpiredError, ApprovalNotFoundError } from "../services/errors.js";

export const T0 = new Date("2026-11-20T12:00:00.000Z");
const MIN = 60_000;
const at = (minutes: number) => new Date(T0.getTime() + minutes * MIN);

export function newApproval(id: string, overrides: Partial<NewApproval> = {}): NewApproval {
	return {
		id,
		turnId: "77777777-0000-4000-8000-000000000001",
		conversationId: "5b1f3c2e-0000-4000-8000-000000000001",
		requestId: "0f8d6a1e-0000-4000-8000-000000000001",
		message: "resolva o incidente 3",
		userId: "ana",
		route: "react",
		reflect: false,
		tool: "resolve_incident",
		args: { id: 3 },
		summary: "Resolver o incidente #3",
		createdAt: T0.toISOString(),
		expiresAt: at(15).toISOString(),
		...overrides,
	};
}

const id = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;

/**
 * Suíte de contrato do `ApprovalStore` (specs/018, data-model.md) — idêntica
 * para o SQLite e o mock. Persistência entre instâncias fica no teste do SQLite.
 */
export function runApprovalStoreContractTests(label: string, createStore: () => ApprovalStore): void {
	test(`[${label}] create + get devolve a aprovação pendente`, async () => {
		const store = createStore();

		const created = await store.create(newApproval(id(1)));

		assert.deepEqual(created, { ...newApproval(id(1)), status: "pending", decidedAt: null, result: null });
		assert.deepEqual(await store.get(id(1), at(1)), created);
		assert.equal(await store.get(id(99), at(1)), undefined);
	});

	test(`[${label}] get depois do prazo marca expired`, async () => {
		const store = createStore();
		await store.create(newApproval(id(1)));

		assert.equal((await store.get(id(1), at(15)))?.status, "expired");
		assert.equal((await store.get(id(1), at(1)))?.status, "expired");
	});

	test(`[${label}] listPending: só pendentes da conversa, em ordem, omitindo e marcando as expiradas`, async () => {
		const store = createStore();
		await store.create(newApproval(id(2), { createdAt: at(2).toISOString(), expiresAt: at(17).toISOString() }));
		await store.create(newApproval(id(1), { createdAt: at(1).toISOString(), expiresAt: at(16).toISOString() }));
		await store.create(newApproval(id(3), { createdAt: at(-20).toISOString(), expiresAt: at(-5).toISOString() }));
		await store.create(newApproval(id(4), { conversationId: "5b1f3c2e-0000-4000-8000-000000000002" }));
		await store.create(newApproval(id(5)));
		await store.decide(id(5), "denied", at(1));

		const pending = await store.listPending("5b1f3c2e-0000-4000-8000-000000000001", at(3));

		assert.deepEqual(
			pending.map((a) => a.id),
			[id(1), id(2)],
		);
		assert.equal((await store.get(id(3), at(3)))?.status, "expired");
	});

	test(`[${label}] decide: pending → approved/denied, com decidedAt`, async () => {
		const store = createStore();
		await store.create(newApproval(id(1)));
		await store.create(newApproval(id(2)));

		const approved = await store.decide(id(1), "approved", at(1));
		const denied = await store.decide(id(2), "denied", at(2));

		assert.equal(approved.status, "approved");
		assert.equal(approved.decidedAt, at(1).toISOString());
		assert.equal(denied.status, "denied");
	});

	test(`[${label}] decide: segunda decisão lança ApprovalAlreadyDecidedError e não muda nada`, async () => {
		const store = createStore();
		await store.create(newApproval(id(1)));
		await store.decide(id(1), "approved", at(1));

		await assert.rejects(store.decide(id(1), "denied", at(2)), (error: unknown) => {
			assert.ok(error instanceof ApprovalAlreadyDecidedError);
			assert.equal(error.status, "approved");
			return true;
		});
		assert.equal((await store.get(id(1), at(2)))?.status, "approved");
	});

	test(`[${label}] decide: concorrentes → exatamente uma vence`, async () => {
		const store = createStore();
		await store.create(newApproval(id(1)));

		const results = await Promise.allSettled([store.decide(id(1), "approved", at(1)), store.decide(id(1), "approved", at(1))]);

		assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
		assert.equal(results.filter((r) => r.status === "rejected" && r.reason instanceof ApprovalAlreadyDecidedError).length, 1);
	});

	test(`[${label}] decide depois do prazo lança ApprovalExpiredError e marca expired`, async () => {
		const store = createStore();
		await store.create(newApproval(id(1)));

		await assert.rejects(store.decide(id(1), "approved", at(15)), ApprovalExpiredError);
		assert.equal((await store.get(id(1), at(15)))?.status, "expired");
		await assert.rejects(store.decide(id(1), "approved", at(16)), ApprovalExpiredError);
	});

	test(`[${label}] decide de id inexistente lança ApprovalNotFoundError`, async () => {
		await assert.rejects(createStore().decide(id(42), "approved", at(1)), ApprovalNotFoundError);
	});

	test(`[${label}] saveResult grava a saída da ação aprovada`, async () => {
		const store = createStore();
		await store.create(newApproval(id(1)));
		await store.decide(id(1), "approved", at(1));

		await store.saveResult(id(1), '{"id":3,"status":"resolved"}');

		assert.equal((await store.get(id(1), at(2)))?.result, '{"id":3,"status":"resolved"}');
	});

	test(`[${label}] ledger: só as decididas do turno, em ordem de criação`, async () => {
		const store = createStore();
		const turn = "77777777-0000-4000-8000-000000000009";
		await store.create(newApproval(id(1), { turnId: turn, createdAt: at(1).toISOString() }));
		await store.create(newApproval(id(2), { turnId: turn, createdAt: at(2).toISOString(), tool: "open_incident", args: { title: "x" } }));
		await store.create(newApproval(id(3), { turnId: turn, createdAt: at(3).toISOString() }));
		await store.create(newApproval(id(4)));
		await store.decide(id(2), "denied", at(4));
		await store.decide(id(1), "approved", at(4));
		await store.decide(id(4), "approved", at(4));

		const ledger = await store.ledger(turn);

		assert.deepEqual(
			ledger.map((a) => [a.id, a.status]),
			[
				[id(1), "approved"],
				[id(2), "denied"],
			],
		);
		assert.deepEqual(ledger[1]?.args, { title: "x" });
	});
}

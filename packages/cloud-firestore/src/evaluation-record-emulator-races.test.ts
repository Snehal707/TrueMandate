import { Firestore } from "@google-cloud/firestore";
import { createEvaluationRecord, type AuthorityEvaluationRecord } from "@truemandate/authority";
import { describe, expect, it } from "vitest";
import { COLLECTIONS, docPath } from "./document-store.js";
import { GoogleFirestoreDocumentStore } from "./google-store.js";
import { createAuthorityEvaluationRepository } from "./repositories.js";

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const hash = (character: string) => character.repeat(64);

function row(
  id: string,
  changes: Partial<Omit<AuthorityEvaluationRecord, "recordHash">> = {},
): Omit<AuthorityEvaluationRecord, "recordHash"> {
  return {
    schemaVersion: 1,
    id,
    workflowId: "workflow-1",
    workflow: { id: "workflow-1", hash: hash("a") },
    action: { id: "action-1", hash: hash("b") },
    guardian: { id: "guardian-1", hash: hash("c") },
    evaluatedIntentState: { id: "state-1", hash: hash("d"), version: 1 },
    decision: "ALLOW",
    scope: { capabilities: { execute_payment: "ALLOW" } },
    capability: "execute_payment",
    merchant: "supplier-1",
    amount: 742000,
    currency: "INR",
    expiresAt: "2030-01-01T00:00:00.000Z",
    materializationEligible: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...changes,
  };
}

function persistence() {
  const store = new GoogleFirestoreDocumentStore(new Firestore({
    projectId: process.env.GOOGLE_CLOUD_PROJECT ?? "truemandate-emulator",
  }));
  return { store, repository: createAuthorityEvaluationRepository(store) };
}

describe.skipIf(!enabled)("EvaluationRecord Firestore persistence races", () => {
  it("concurrent identical creates resolve to one canonical durable record", async () => {
    const id = `evaluation-identical-${Date.now()}`;
    const [first, second] = await Promise.all([
      createEvaluationRecord(persistence().repository, row(id)),
      createEvaluationRecord(persistence().repository, row(id)),
    ]);

    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) expect(first.value.recordHash).toBe(second.value.recordHash);

    const afterRestart = await persistence().repository.get(id);
    expect(afterRestart.ok).toBe(true);
    if (afterRestart.ok) expect(afterRestart.value?.recordHash).toBe(first.ok ? first.value.recordHash : "");
  // Real Firestore transaction contention can exceed Vitest's five-second
  // default; the assertions still require both creates to settle canonically.
  }, 20_000);

  it.each([
    ["Action", { action: { id: "action-2", hash: hash("e") } }],
    ["IntentState", { evaluatedIntentState: { id: "state-1", hash: hash("f"), version: 2 } }],
    ["decision", { decision: "BLOCK" as const, materializationEligible: false, materializationReason: "AUTHORITY_BLOCKED" as const }],
    ["economic bounds", { amount: 742001 }],
    ["expiry", { expiresAt: "2029-01-01T00:00:00.000Z" }],
  ])("same-ID divergent %s create fails closed", async (_name, changes) => {
    const id = `evaluation-divergent-${_name}-${Date.now()}`;
    const [accepted, rejected] = await Promise.all([
      createEvaluationRecord(persistence().repository, row(id)),
      createEvaluationRecord(persistence().repository, row(id, changes)),
    ]);
    expect([accepted, rejected].filter((result) => result.ok)).toHaveLength(1);
    expect([accepted, rejected].filter((result) => !result.ok)).toHaveLength(1);
  }, 20_000);

  it("replays identically after restart and rejects divergent replay", async () => {
    const id = `evaluation-restart-${Date.now()}`;
    const initial = await createEvaluationRecord(persistence().repository, row(id));
    expect(initial.ok).toBe(true);

    const replay = await createEvaluationRecord(persistence().repository, row(id));
    expect(replay.ok).toBe(true);
    if (initial.ok && replay.ok) expect(replay.value.recordHash).toBe(initial.value.recordHash);

    const divergent = await createEvaluationRecord(persistence().repository, row(id, { currency: "USD" }));
    expect(divergent.ok).toBe(false);
  });

  it("rejects malformed and hash-tampered durable rows instead of treating them as absent", async () => {
    const id = `evaluation-malformed-${Date.now()}`;
    const { store, repository } = persistence();
    await store.set(docPath(COLLECTIONS.authorityEvaluations, id), {
      ...row(id),
      recordHash: hash("0"),
    });

    const read = await repository.get(id);
    expect(read.ok).toBe(false);
    const replay = await createEvaluationRecord(repository, row(id));
    expect(replay.ok).toBe(false);
  });
});

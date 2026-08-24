import { Firestore } from "@google-cloud/firestore";
import { createPreparedAction, makeCommitToken, makeConstraint, makeGrant, makeIntent, makeIntentState, NOW } from "@truemandate/authority";
import { ConstraintKind, asAuthorityGrantId } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { COLLECTIONS, GoogleFirestoreDocumentStore, createFirestorePersistence, docPath } from "./index.js";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

function client() {
  return new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT ?? "truemandate-emulator" });
}

function fixture(suffix: string) {
  const intent = makeIntent();
  const state = makeIntentState(intent, [makeConstraint({ id: `constraint-${suffix}`, concept: "food_grade", kind: ConstraintKind.HARD })], `state-${suffix}`);
  const preparedResult = createPreparedAction({
    id: `prepared-${suffix}`, actionId: "action-1" as never, intentId: intent.id, intentStateId: state.id, agentId: "agent-1" as never,
    capability: "execute_payment", parameters: { merchant: "approved-a", product: "food-grade-container", quantity: 500, amount: 700000, currency: "INR", refundability: true, deliveryTerms: "standard", toolParameters: { sku: "FG-500" } }, createdAt: NOW, intentStateHash: state.stateHash,
  });
  if (!preparedResult.ok) throw new Error(preparedResult.message);
  const prepared = preparedResult.value;
  const grant = { ...makeGrant(state, prepared), id: asAuthorityGrantId(`grant-${suffix}`) };
  const action = { id: prepared.actionId, intentId: prepared.intentId, intentStateId: prepared.intentStateId, agentId: prepared.agentId, capability: prepared.capability, parameters: {}, consequenceLevel: "HIGH", createdAt: NOW };
  const verdict = { id: `guardian-${suffix}`, actionId: prepared.actionId, intentId: prepared.intentId, intentStateId: prepared.intentStateId, intentStateHash: prepared.intentStateHash, actionContentHash: prepared.actionContentHash ?? "0".repeat(64), evidenceSnapshotHash: "0".repeat(64), decision: "ALLOW", semanticStatus: "CLEAR", overallFidelity: 1, constraintClaims: [], contradictions: [], uncertainty: 0, criticalFailure: false, judgeResults: [], protocolVersion: "1.0", promptVersions: {}, schemaVersions: {}, stale: false, createdAt: NOW, verdictHash: "0".repeat(64) };
  const record = { preparedAction: prepared, action, verdict, externalStateSnapshot: {}, lifecycle: "PREPARED", version: 1, createdAt: NOW, updatedAt: NOW } as never;
  return { prepared, grant, token: makeCommitToken(grant, prepared, { id: `token-${suffix}` as never }), record };
}

describe.skipIf(!emulatorHost)("Firestore pre-execution create-once races", () => {
  it("concurrent identical PreparedAction creation returns one logical durable record", async () => {
    const f = fixture(`prepared-${Date.now()}`);
    const db = createFirestorePersistence(new GoogleFirestoreDocumentStore(client()));
    const [left, right] = await Promise.all([db.preparedActions.putIfAbsent(f.record), db.preparedActions.putIfAbsent(f.record)]);
    expect(left.ok && right.ok).toBe(true);
    const stored = await db.preparedActions.get(f.prepared.id);
    expect(stored.ok && stored.value?.preparedAction.preparedActionHash).toBe(f.prepared.preparedActionHash);
  }, 20_000);

  it("divergent PreparedAction payload with one identity fails closed", async () => {
    const f = fixture(`prepared-conflict-${Date.now()}`);
    const db = createFirestorePersistence(new GoogleFirestoreDocumentStore(client()));
    const divergent = { ...f.record, preparedAction: { ...f.record.preparedAction, preparedActionHash: "f".repeat(64) } };
    const [left, right] = await Promise.all([db.preparedActions.putIfAbsent(f.record), db.preparedActions.putIfAbsent(divergent)]);
    expect([left, right].filter((r) => r.ok)).toHaveLength(1);
    expect([left, right].filter((r) => !r.ok)).toHaveLength(1);
  }, 20_000);

  it("concurrent identical AuthorityGrant persistence replays one grant and survives restart", async () => {
    const f = fixture(`grant-${Date.now()}`);
    const db1 = createFirestorePersistence(new GoogleFirestoreDocumentStore(client()));
    const [left, right] = await Promise.all([db1.grants.put(f.grant), db1.grants.put(f.grant)]);
    expect(left.ok && right.ok).toBe(true);
    const db2 = createFirestorePersistence(new GoogleFirestoreDocumentStore(client()));
    const stored = await db2.grants.get(f.grant.id);
    expect(stored.ok && stored.value?.preparedActionHash).toBe(f.grant.preparedActionHash);
  }, 20_000);

  it("divergent AuthorityGrant persistence cannot create a second meaning", async () => {
    const f = fixture(`grant-conflict-${Date.now()}`);
    const db = createFirestorePersistence(new GoogleFirestoreDocumentStore(client()));
    const divergent = { ...f.grant, preparedActionHash: "e".repeat(64) as never };
    const [left, right] = await Promise.all([db.grants.put(f.grant), db.grants.put(divergent)]);
    expect([left, right].filter((r) => r.ok)).toHaveLength(1);
    expect([left, right].filter((r) => !r.ok)).toHaveLength(1);
  }, 20_000);

  it("concurrent token persistence is replay-safe and remains unconsumed after restart", async () => {
    const f = fixture(`token-${Date.now()}`);
    const db1 = createFirestorePersistence(new GoogleFirestoreDocumentStore(client()));
    const [left, right] = await Promise.all([db1.commitTokens.put(f.token), db1.commitTokens.put(f.token)]);
    expect(left.ok && right.ok).toBe(true);
    const db2 = createFirestorePersistence(new GoogleFirestoreDocumentStore(client()));
    const stored = await db2.commitTokens.get(f.token.id);
    expect(stored.ok && stored.value?.consumed).toBe(false);
  }, 20_000);

  it("fails closed for malformed or hash-tampered durable pre-execution rows", async () => {
    const f = fixture(`invalid-${Date.now()}`);
    const store = new GoogleFirestoreDocumentStore(client());
    const db = createFirestorePersistence(store);

    await store.set(docPath(COLLECTIONS.preparedActions, f.prepared.id), {
      ...f.record,
      preparedAction: { ...f.record.preparedAction, preparedActionHash: "f".repeat(64) },
    });
    await store.set(docPath(COLLECTIONS.grants, f.grant.id), { ...f.grant, scope: undefined });
    await store.set(docPath(COLLECTIONS.commitTokens, f.token.id), { ...f.token, tokenHash: "e".repeat(64) });

    expect((await db.preparedActions.get(f.prepared.id)).ok).toBe(false);
    expect((await db.grants.get(f.grant.id)).ok).toBe(false);
    expect((await db.commitTokens.get(f.token.id)).ok).toBe(false);
  }, 20_000);
});

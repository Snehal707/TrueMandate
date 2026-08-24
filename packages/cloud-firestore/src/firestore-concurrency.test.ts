import { describe, expect, it } from "vitest";
import {
  GrantConsumptionState,
  ProvenanceNodeKind,
  TaintClass,
  TrustClass,
  asIdempotencyKey,
  asNonce,
  ExecutionState,
} from "@truemandate/protocol";
import {
  LATER,
  NOW,
  makeCommitToken,
  makeGrant,
  makeIntent,
  makeIntentState,
  makePrepared,
  makeConstraint,
} from "@truemandate/authority";
import { ConstraintKind } from "@truemandate/protocol";
import {
  MemoryTransactionalStore,
  createFirestorePersistence,
} from "./index.js";

function harness() {
  const intent = makeIntent();
  const state = makeIntentState(intent, [
    makeConstraint({
      id: "c1",
      concept: "quantity",
      kind: ConstraintKind.HARD,
    }),
  ]);
  const prepared = makePrepared(intent, state);
  const grant = makeGrant(state, prepared);
  const token = makeCommitToken(grant, prepared);
  return { grant, token, prepared };
}

describe("Firestore transactional concurrency (memory, fast CI)", () => {
  it("CommitToken race: only one consumer wins", async () => {
    const db = createFirestorePersistence(new MemoryTransactionalStore());
    const { token } = harness();
    expect((await db.commitTokens.put(token)).ok).toBe(true);

    const [r1, r2] = await Promise.all([
      db.commitTokens.consume(token.id, NOW),
      db.commitTokens.consume(token.id, NOW),
    ]);

    const oks = [r1, r2].filter((r) => r.ok);
    const fails = [r1, r2].filter((r) => !r.ok);
    expect(oks).toHaveLength(1);
    expect(fails).toHaveLength(1);
    if (!fails[0]!.ok) {
      expect(fails[0].code).toBe("COMMIT_TOKEN_CONSUMED");
    }
    const storedToken = await db.commitTokens.get(token.id);
    expect(storedToken.ok).toBe(true);
    if (!storedToken.ok) return;
    expect(storedToken.value).toBeDefined();
    if (!storedToken.value) return;
    expect(storedToken.value.consumed).toBe(true);
  });

  it("Grant race: only one consumer wins", async () => {
    const db = createFirestorePersistence();
    const { grant } = harness();
    expect((await db.grants.put(grant)).ok).toBe(true);

    const [r1, r2] = await Promise.all([
      db.grants.consume(grant.id, NOW),
      db.grants.consume(grant.id, NOW),
    ]);
    const oks = [r1, r2].filter((r) => r.ok);
    expect(oks).toHaveLength(1);
    const fail = [r1, r2].find((r) => !r.ok);
    expect(fail?.ok).toBe(false);
    if (fail && !fail.ok) {
      expect(fail.code).toBe("GRANT_CONSUMED");
    }
  });

  it("exposure reserve cannot exceed threshold under sequential contention", async () => {
    const db = createFirestorePersistence();
    const group = "rg-1";
    const r1 = await db.exposure.reserveIfUnderThreshold({
      entry: {
        id: "e1",
        amount: 300,
        currency: "USD",
        relatedGroupId: group,
        status: "IN_FLIGHT",
      },
      threshold: 500,
      currency: "USD",
      proposedAmount: 300,
      relatedGroupId: group,
    });
    const r2 = await db.exposure.reserveIfUnderThreshold({
      entry: {
        id: "e2",
        amount: 300,
        currency: "USD",
        relatedGroupId: group,
        status: "IN_FLIGHT",
      },
      threshold: 500,
      currency: "USD",
      proposedAmount: 300,
      relatedGroupId: group,
    });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.code).toBe("CUMULATIVE_EXPOSURE_EXCEEDED");
    }
  });

  it("UNKNOWN reconcile once; prepared hash non-reusable", async () => {
    const db = createFirestorePersistence();
    const hash = "c".repeat(64);
    const put = await db.economicReservations.put({
      key: "res-1",
      preparedActionHash: hash,
      grantId: "g1",
      exposureEntryId: "e1",
      amount: 100,
      currency: "USD",
      relatedGroupId: "rg",
      idempotencyKey: "idem-1",
      executionId: "ex-1",
      createdAt: NOW,
    });
    expect(put.ok).toBe(true);

    const a = await db.economicReservations.resolve("res-1", true, LATER);
    const b = await db.economicReservations.resolve("res-1", false, LATER);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
    expect(await db.economicReservations.isPreparedHashNonReusable(hash)).toBe(true);

    const again = await db.economicReservations.put({
      key: "res-2",
      preparedActionHash: hash,
      grantId: "g2",
      exposureEntryId: "e2",
      amount: 50,
      currency: "USD",
      relatedGroupId: "rg",
      idempotencyKey: "idem-2",
      executionId: "ex-2",
      createdAt: LATER,
    });
    expect(again.ok).toBe(false);
  });

  it("nonce single-use and idempotency UNKNOWN cannot retry", async () => {
    const db = createFirestorePersistence();
    const nonce = asNonce("n-1");
    expect((await db.nonces.register(nonce)).ok).toBe(true);
    expect((await db.nonces.register(nonce)).ok).toBe(false);

    const key = asIdempotencyKey("idem-u");
    expect((await db.idempotency.begin(key, NOW)).ok).toBe(true);
    expect((await db.idempotency.markUnknown(key, LATER)).ok).toBe(true);
    const retry = await db.idempotency.begin(key, LATER);
    expect(retry.ok).toBe(false);
    if (!retry.ok) {
      expect(retry.code).toBe("UNKNOWN_EXECUTION_CANNOT_RETRY");
    }
    expect((await db.idempotency.get(key))?.state).toBe(ExecutionState.UNKNOWN);
  });

  it("resolution trigger / outcome event putIfAbsent is idempotent", async () => {
    const db = createFirestorePersistence();
    expect(
      await db.resolutionTriggers.putIfAbsent("trig-1", { seenAt: NOW }),
    ).toBe(true);
    expect(
      await db.resolutionTriggers.putIfAbsent("trig-1", { seenAt: LATER }),
    ).toBe(false);
    expect(await db.outcomeEvents.putIfAbsent("evt-1", { id: "evt-1" })).toBe(true);
    expect(await db.outcomeEvents.putIfAbsent("evt-1", { id: "evt-1" })).toBe(false);
  });

  it("restart reconstructs grant and commit token state from store", async () => {
    const shared = new MemoryTransactionalStore();
    const db1 = createFirestorePersistence(shared);
    const { grant, token } = harness();
    await db1.grants.put(grant);
    await db1.commitTokens.put(token);
    await db1.grants.consume(grant.id, NOW);
    await db1.commitTokens.consume(token.id, NOW);

    const db2 = createFirestorePersistence(shared);
    const storedGrant = await db2.grants.get(grant.id);
    expect(storedGrant.ok).toBe(true);
    if (!storedGrant.ok) return;
    expect(storedGrant.value).toBeDefined();
    if (!storedGrant.value) return;
    expect(storedGrant.value.consumptionState).toBe(
      GrantConsumptionState.CONSUMED,
    );
    const storedToken = await db2.commitTokens.get(token.id);
    expect(storedToken.ok).toBe(true);
    if (!storedToken.ok) return;
    expect(storedToken.value).toBeDefined();
    if (!storedToken.value) return;
    expect(storedToken.value.consumed).toBe(true);
  });

  it("intent tip and provenance append survive shared store restart", async () => {
    const shared = new MemoryTransactionalStore();
    const db1 = createFirestorePersistence(shared);
    const intent = makeIntent();
    const state = makeIntentState(intent, [
      makeConstraint({ id: "c1", concept: "quantity", kind: ConstraintKind.HARD }),
    ]);
    await db1.intents.putIntent(intent);
    await db1.intents.putState(state);
    await db1.intents.setTip(intent.id, state.id);
    const node = {
      id: "pn-1",
      kind: ProvenanceNodeKind.INTENT,
      label: "restart intent provenance",
      createdAt: NOW,
      trustClass: TrustClass.TRUSTED_SYSTEM,
      taint: { classes: [TaintClass.NONE], origins: [] },
    };
    await db1.provenance.appendNode({
      id: node.id,
      payload: node,
      createdAt: NOW,
    });

    const db2 = createFirestorePersistence(shared);
    expect((await db2.intents.getTip(intent.id))?.id).toBe(state.id);
    const storedNode = await db2.provenance.getNode(node.id);
    expect(storedNode?.id).toBe(node.id);
    expect(storedNode?.payload).toMatchObject({
      id: node.id,
      kind: ProvenanceNodeKind.INTENT,
    });
  });
});

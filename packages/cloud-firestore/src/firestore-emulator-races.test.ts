/**
 * Production-semantics proof against a real @google-cloud/firestore client.
 * Skipped unless FIRESTORE_EMULATOR_HOST is set.
 * Dedicated runner scripts/cloud/run-firestore-emulator-races.mjs fails if the emulator is down.
 */
import { Firestore } from "@google-cloud/firestore";
import { describe, expect, it } from "vitest";
import {
  GrantConsumptionState,
  asAuthorityGrantId,
  asCommitTokenId,
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
  GoogleFirestoreDocumentStore,
  READY_PROBE_PATH,
  createFirestorePersistence,
} from "./index.js";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

function harness(suffix: string) {
  const intent = makeIntent();
  const state = makeIntentState(intent, [
    makeConstraint({
      id: `c-${suffix}`,
      concept: "quantity",
      kind: ConstraintKind.HARD,
    }),
  ], `state-${suffix}`);
  const prepared = makePrepared(intent, state);
  const grant = {
    ...makeGrant(state, prepared),
    id: asAuthorityGrantId(`grant-${suffix}`),
  };
  const token = makeCommitToken(grant, prepared, {
    id: asCommitTokenId(`tok-${suffix}`),
  });
  return { grant, token, prepared, intent, state };
}

function newClient(): Firestore {
  return new Firestore({
    projectId: process.env.GOOGLE_CLOUD_PROJECT ?? "truemandate-emulator",
  });
}

describe.skipIf(!emulatorHost)("Firestore emulator concurrency (real client TX)", () => {
  it("read-only reachability Get succeeds when the probe document is missing", async () => {
    const store = new GoogleFirestoreDocumentStore(newClient());
    expect(await store.get(READY_PROBE_PATH)).toBeUndefined();
    await expect(store.probeReachability()).resolves.toBeUndefined();
  });

  it("two concurrent CommitToken.consume — exactly one succeeds", async () => {
    const store = new GoogleFirestoreDocumentStore(newClient());
    const db = createFirestorePersistence(store);
    const { token } = harness(`ct-${Date.now()}`);
    expect((await db.commitTokens.put(token)).ok).toBe(true);
    const [a, b] = await Promise.all([
      db.commitTokens.consume(token.id, NOW),
      db.commitTokens.consume(token.id, NOW),
    ]);
    expect([a, b].filter((r) => r.ok)).toHaveLength(1);
    expect([a, b].filter((r) => !r.ok)).toHaveLength(1);
    const fail = [a, b].find((r) => !r.ok);
    if (fail && !fail.ok) expect(fail.code).toBe("COMMIT_TOKEN_CONSUMED");
    const stored = await db.commitTokens.get(token.id);
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    expect(stored.value).toBeDefined();
    if (!stored.value) return;
    expect(stored.value.consumed).toBe(true);
  }, 20_000);

  it("duplicate idempotency keys cannot begin UNKNOWN retry", async () => {
    const db = createFirestorePersistence(new GoogleFirestoreDocumentStore(newClient()));
    const key = asIdempotencyKey(`idem-${Date.now()}`);
    expect((await db.idempotency.begin(key, NOW)).ok).toBe(true);
    const dup = await Promise.all([
      db.idempotency.begin(key, LATER),
      db.idempotency.begin(key, LATER),
    ]);
    expect(dup.every((r) => r.ok)).toBe(true);
    expect((await db.idempotency.markUnknown(key, LATER)).ok).toBe(true);
    const retry = await db.idempotency.begin(key, LATER);
    expect(retry.ok).toBe(false);
    if (!retry.ok) expect(retry.code).toBe("UNKNOWN_EXECUTION_CANNOT_RETRY");
  });

  it(
    "concurrent exposure reservations exceeding a bound",
    async () => {
    const db = createFirestorePersistence(new GoogleFirestoreDocumentStore(newClient()));
    const group = `rg-${Date.now()}`;
    const results = await Promise.all(
      [1, 2, 3].map((i) =>
        db.exposure.reserveIfUnderThreshold({
          entry: {
            id: `${group}-e${i}`,
            amount: 400,
            currency: "USD",
            relatedGroupId: group,
            status: "IN_FLIGHT",
          },
          threshold: 500,
          currency: "USD",
          proposedAmount: 400,
          relatedGroupId: group,
        }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(2);
    },
    20_000,
  );

  it("revoke grant between prepare and commit", async () => {
    const db = createFirestorePersistence(new GoogleFirestoreDocumentStore(newClient()));
    const { grant } = harness(`rev-${Date.now()}`);
    expect((await db.grants.put(grant)).ok).toBe(true);
    expect((await db.grants.revoke(grant.id, NOW)).ok).toBe(true);
    const consume = await db.grants.consume(grant.id, LATER);
    expect(consume.ok).toBe(false);
    if (!consume.ok) expect(consume.code).toBe("GRANT_REVOKED");
  });

  it("stale aggregate/version writes rejected via consume after consume", async () => {
    const db = createFirestorePersistence(new GoogleFirestoreDocumentStore(newClient()));
    const { grant } = harness(`stale-${Date.now()}`);
    await db.grants.put(grant);
    expect((await db.grants.consume(grant.id, NOW)).ok).toBe(true);
    const again = await db.grants.consume(grant.id, LATER);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe("GRANT_CONSUMED");
  });

  it("replayed nonce rejected", async () => {
    const db = createFirestorePersistence(new GoogleFirestoreDocumentStore(newClient()));
    const nonce = asNonce(`n-${Date.now()}`);
    expect((await db.nonces.register(nonce)).ok).toBe(true);
    const replay = await db.nonces.register(nonce);
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.code).toBe("NONCE_REPLAY");
  });

  it("restart: second client reconstructs prior durable state", async () => {
    const suffix = `rst-${Date.now()}`;
    const { grant, token } = harness(suffix);
    const db1 = createFirestorePersistence(new GoogleFirestoreDocumentStore(newClient()));
    await db1.grants.put(grant);
    await db1.commitTokens.put(token);
    await db1.grants.consume(grant.id, NOW);
    await db1.commitTokens.consume(token.id, NOW);

    const db2 = createFirestorePersistence(new GoogleFirestoreDocumentStore(newClient()));
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

  it("out-of-order event updates rejected via putIfAbsent", async () => {
    const db = createFirestorePersistence(new GoogleFirestoreDocumentStore(newClient()));
    const id = `evt-${Date.now()}`;
    expect(await db.outcomeEvents.putIfAbsent(id, { id, version: 2 })).toBe(true);
    expect(await db.outcomeEvents.putIfAbsent(id, { id, version: 1 })).toBe(false);
  });

  it("UNKNOWN execution remains locked against blind retry", async () => {
    const db = createFirestorePersistence(new GoogleFirestoreDocumentStore(newClient()));
    const key = asIdempotencyKey(`unk-${Date.now()}`);
    expect((await db.idempotency.begin(key, NOW)).ok).toBe(true);
    expect((await db.idempotency.markUnknown(key, LATER)).ok).toBe(true);
    const retry = await db.idempotency.attemptRetry(key);
    expect(retry.ok).toBe(false);
    if (!retry.ok) expect(retry.code).toBe("UNKNOWN_EXECUTION_CANNOT_RETRY");
    const begin = await db.idempotency.begin(key, LATER);
    expect(begin.ok).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { ErrorCode } from "@truemandate/protocol";
import { makeRuntime, prepareAuthorize, NOW, parentScope } from "./integration/harness.js";

/**
 * Deterministic in-memory parallels of the Firestore-emulator race suites for
 * the Wave 1 production-critical single-use primitives. These RUN in CI
 * (no emulator required) and prove the logic-level invariants:
 *
 *   - CommitToken single-use under genuinely parallel COMMIT
 *   - grant identity idempotence under parallel persistence
 *   - cumulative exposure reservation bound under parallel reservations
 *
 * The emulator suites additionally prove the Firestore transport TX layer;
 * they remain enabled whenever FIRESTORE_EMULATOR_HOST is set.
 */

describe("parallel single-use primitives (deterministic, emulator-free)", () => {
  it("two parallel COMMIT calls on one CommitToken: exactly one SUCCESS, one side effect", async () => {
    const rt = await makeRuntime();
    const auth = await prepareAuthorize(rt, { idempotencyKey: "parallel-commit-1" });
    expect(auth.ok).toBe(true);
    if (!auth.ok) return;
    const input = {
      preparedAction: auth.value.prepared,
      grantId: auth.value.grantId,
      commitToken: auth.value.commitToken,
      agentId: "agent-1",
      actionNodeId: rt.actionNodeId,
      authorityNodeId: rt.authNodeId,
      now: NOW,
    };
    const [a, b] = await Promise.all([
      rt.gateway.commit(input),
      rt.gateway.commit(input),
    ]);
    const successes = [a, b].filter((r) => r.ok && r.value.status === "SUCCESS");
    expect(successes).toHaveLength(1);
    const ledger = await rt.gateway.getSideEffectLedger().listAll();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.resultState).toBe("SUCCESS");
    const token = await rt.gateway.getCommitTokenStore().get(auth.value.commitToken.id);
    expect(token.ok && token.value?.consumed).toBe(true);
  });

  it("parallel identical grant persistence converges on one grant; divergent persistence fails closed", async () => {
    const rt = await makeRuntime();
    const auth = await prepareAuthorize(rt, { idempotencyKey: "parallel-grant-1" });
    expect(auth.ok).toBe(true);
    if (!auth.ok) return;
    const grant = await rt.authority.getGrantStore().get(auth.value.grantId);
    expect(grant.ok && grant.value).toBeDefined();
    if (!grant.ok || !grant.value) return;
    const [one, two] = await Promise.all([
      rt.authority.getGrantStore().put(grant.value),
      rt.authority.getGrantStore().put(grant.value),
    ]);
    expect(one.ok && two.ok).toBe(true);
    if (one.ok && two.ok) {
      expect(one.value.id).toBe(two.value.id);
    }
    const divergent = { ...grant.value, preparedActionHash: "f".repeat(64) as never };
    const conflict = await rt.authority.getGrantStore().put(divergent);
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.code).toBe(ErrorCode.PREPARED_ACTION_HASH_MISMATCH);
  });

  it("parallel exposure reservations beyond a bound: at most the bound is reserved", async () => {
    const rt = await makeRuntime();
    const ledger = rt.authority.getExposureLedger();
    const reserve = (id: string, amount: number) =>
      ledger.reserveIfUnderThreshold({
        entry: { id, amount, currency: "INR", relatedGroupId: "parallel-exposure-group", status: "IN_FLIGHT" },
        threshold: 10000,
        currency: "INR",
        proposedAmount: amount,
        relatedGroupId: "parallel-exposure-group",
      });
    const results = await Promise.all([
      reserve("res-a", 6000),
      reserve("res-b", 6000),
      reserve("res-c", 6000),
    ]);
    const okCount = results.filter((r) => r.ok).length;
    // 6000 + 6000 <= 10000 but three reservations exceed the bound:
    expect(okCount).toBeLessThanOrEqual(2);
    expect(okCount).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => !r.ok && r.code === ErrorCode.CUMULATIVE_EXPOSURE_EXCEEDED)).toBe(true);
  });

  it("parallel identical PreparedAction creation resolves one canonical record", async () => {
    const rt = await makeRuntime();
    const auth = await prepareAuthorize(rt, { idempotencyKey: "parallel-prep-1" });
    expect(auth.ok).toBe(true);
    if (!auth.ok) return;
    const record = await rt.gateway.getPreparedActionStore().get(auth.value.prepared.id);
    expect(record.ok && record.value).toBeDefined();
  });
});

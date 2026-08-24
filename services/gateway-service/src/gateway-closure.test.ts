import { createFirestorePersistence, MemoryTransactionalStore } from "@truemandate/cloud-firestore";
import {
  SnapshotExternalStateProvider,
  computeFullPreparedActionHash,
} from "@truemandate/authority";
import { AuthorityService } from "@truemandate/authority-service";
import { IntentService } from "@truemandate/intent-service";
import { ErrorCode, PreparedActionLifecycle } from "@truemandate/protocol";
import { ProvenanceService } from "@truemandate/provenance-service";
import { describe, expect, it } from "vitest";
import { TwoPhaseGateway } from "./two-phase.js";
import {
  FUTURE,
  NOW,
  executePrivilegedPayment,
  makeRuntime,
  mintThenAuthorize,
  parentScope,
  prepareAuthorize,
  provenanceOwnerFrom,
  seedAuthorityBinding,
} from "./integration/harness.js";

describe("gateway durability, hash, TOCTOU, exposure, ownership", () => {
  it("reconstructs prepare→authorize→commit across gateway instances sharing storage", async () => {
    const store = new MemoryTransactionalStore();
    const bundle = createFirestorePersistence(store);
    const intentsA = new IntentService(bundle.intents);
    const intentsB = new IntentService(bundle.intents);
    const authority = new AuthorityService(intentsA, bundle.grants, bundle.exposure);
    const provenance = new ProvenanceService(bundle.provenance);
    const provider = new SnapshotExternalStateProvider();
    const gatewayA = TwoPhaseGateway.createForUnboundLegacyTests({
      intents: intentsA,
      authority,
      provenance,
    });
    // Recreate A-equivalent wiring with shared stores for replica B.
    const rt = await makeRuntime();
    const prepared = await rt.gateway.prepare({
      action: rt.action,
      verdict: rt.verdict,
      principalId: "principal-1",
      toolId: "payment.execute",
      agentCapabilities: parentScope().capabilities,
      externalState: {
        merchant: "approved-a",
        product: "fg-container",
        quantity: 500,
        amount: 700000,
        currency: "INR",
        refundability: true,
        sku: "FG-500",
      },
      idempotencyKey: "durable-1",
      expiresAt: FUTURE,
      createdAt: NOW,
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const replica = TwoPhaseGateway.createForUnboundLegacyTests({
      intents: rt.intents,
      authority: rt.authority,
      provenance: rt.provenance,
    });
    // Replica without the original process-local session must fail closed
    // unless it shares the prepared-action store.
    const missing = await replica.authorize({
      preparedActionId: prepared.value.id,
      grantId: "grant-missing",
      expiresAt: FUTURE,
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.code).toBe(ErrorCode.PREPARED_ACTION_REQUIRED);
    }

    const sharedStore = rt.gateway.getPreparedActionStore();
    const replicaShared = new TwoPhaseGateway({
      intents: rt.intents,
      authority: rt.authority,
      provenance: rt.provenance,
      outcomeBinding: {
        assertBinding: async () =>
          ({ ok: false, code: ErrorCode.OUTCOME_CONTRACT_REQUIRED, message: "unbound" }),
      },
      allowUnboundEconomicCommit: true,
      preparedActionStore: sharedStore,
      tokenStore: rt.gateway.getCommitTokenStore(),
      provenanceOwner: provenanceOwnerFrom(rt.provenance),
    });
    const minted = await rt.authority.createGrant({
      request: {
        id: "req-durable",
        principalId: "principal-1",
        agentId: "agent-1",
        intentId: rt.intent.id,
        intentStateId: rt.state.id,
        actionId: rt.action.id,
        preparedActionId: prepared.value.id,
        capability: "execute_payment",
        scope: parentScope(),
        merchant: "approved-a",
        amount: 700000,
        currency: "INR",
        createdAt: NOW,
      },
      preparedAction: prepared.value,
      decision: "ALLOW",
      expiresAt: FUTURE,
      createdAt: NOW,
    });
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    const seeded = await seedAuthorityBinding(rt.provenance, prepared.value, minted.value);
    expect(seeded.ok).toBe(true);
    const authorized = await replicaShared.authorize({
      preparedActionId: prepared.value.id,
      grantId: minted.value.id,
      expiresAt: FUTURE,
    });
    expect(authorized.ok).toBe(true);
    if (!authorized.ok || !authorized.value.commitToken) return;
    const committed = await replicaShared.commit({
      preparedAction: prepared.value,
      grantId: minted.value.id,
      commitToken: authorized.value.commitToken,
      agentId: "agent-1",
      actionNodeId: rt.actionNodeId,
      authorityNodeId: rt.authNodeId,
      now: NOW,
    });
    expect(committed.ok).toBe(true);
    void gatewayA;
    void provider;
    void bundle;
  });

  it("full PreparedAction hash changes when toolId, expiry, or Guardian binding changes", async () => {
    const rt = await makeRuntime();
    const prepared = await rt.gateway.prepare({
      action: rt.action,
      verdict: rt.verdict,
      principalId: "principal-1",
      toolId: "payment.execute",
      agentCapabilities: parentScope().capabilities,
      externalState: {
        merchant: "approved-a",
        product: "fg-container",
        quantity: 500,
        amount: 700000,
        currency: "INR",
        refundability: true,
        sku: "FG-500",
      },
      idempotencyKey: "hash-1",
      expiresAt: FUTURE,
      createdAt: NOW,
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const { preparedActionHash: _h, ...unsigned } = prepared.value;
    void _h;
    const toolMut = computeFullPreparedActionHash({ ...unsigned, toolId: "purchase.non_refundable" });
    const expiryMut = computeFullPreparedActionHash({ ...unsigned, expiresAt: "2099-01-01T00:00:00.000Z" });
    const guardianMut = computeFullPreparedActionHash({
      ...unsigned,
      guardianVerdictHash: "deadbeef",
    });
    expect(toolMut).not.toBe(prepared.value.preparedActionHash);
    expect(expiryMut).not.toBe(prepared.value.preparedActionHash);
    expect(guardianMut).not.toBe(prepared.value.preparedActionHash);

    const tampered = {
      ...prepared.value,
      toolId: "purchase.non_refundable",
      preparedActionHash: prepared.value.preparedActionHash,
    };
    const recordResult = await rt.gateway.getPreparedActionStore().get(prepared.value.id);
    expect(recordResult.ok).toBe(true);
    if (!recordResult.ok) return;
    const record = recordResult.value;
    expect(record).toBeTruthy();
    if (!record) return;
    await rt.gateway.getPreparedActionStore().putIfAbsent({
      ...record,
      preparedAction: tampered,
    });
    // putIfAbsent keeps the original; integrity of stored object still matches.
    const storedResult = await rt.gateway.getPreparedActionStore().get(prepared.value.id);
    expect(storedResult.ok).toBe(true);
    if (!storedResult.ok) return;
    const stored = storedResult.value;
    expect(stored).toBeTruthy();
    if (!stored) return;
    expect(stored.preparedAction.toolId).toBe("payment.execute");
  });

  it("stale trusted refresh blocks commit", async () => {
    const rt = await makeRuntime();
    const auth = await prepareAuthorize(rt, { idempotencyKey: "toctou-1" });
    expect(auth.ok).toBe(true);
    if (!auth.ok) return;
    const provider = rt.gateway.getExternalStateProvider();
    expect(provider).toBeInstanceOf(SnapshotExternalStateProvider);
    (provider as SnapshotExternalStateProvider).setOverride(auth.value.prepared.id, {
      merchant: "approved-a",
      product: "fg-container",
      quantity: 500,
      amount: 15700,
      currency: "INR",
      refundability: false,
      deliveryTerms: auth.value.prepared.parameters.deliveryTerms,
      certificationRef: undefined,
      sku: "FG-500",
    });
    const commit = await executePrivilegedPayment(rt, {
      preparedAction: auth.value.prepared,
      grantId: auth.value.grantId,
      commitToken: auth.value.commitToken,
    });
    expect(commit.ok).toBe(false);
    if (!commit.ok) expect(commit.code).toBe(ErrorCode.PREPARED_ACTION_STALE);
  });

  it("unavailable trusted refresh fails closed", async () => {
    const rt = await makeRuntime();
    const auth = await prepareAuthorize(rt, { idempotencyKey: "toctou-unavail" });
    expect(auth.ok).toBe(true);
    if (!auth.ok) return;
    (rt.gateway.getExternalStateProvider() as SnapshotExternalStateProvider).markUnavailable(
      auth.value.prepared.id,
    );
    const commit = await executePrivilegedPayment(rt, {
      preparedAction: auth.value.prepared,
      grantId: auth.value.grantId,
      commitToken: auth.value.commitToken,
    });
    expect(commit.ok).toBe(false);
    if (!commit.ok) expect(commit.code).toBe(ErrorCode.PREPARED_ACTION_STALE);
  });

  it("atomic exposure reservation allows only one of two concurrent commits under the bound", async () => {
    const rt = await makeRuntime();
    const a1 = await prepareAuthorize(rt, {
      idempotencyKey: "exp-a",
      amount: 500000,
      grantId: "grant-exp-a",
    });
    const a2 = await prepareAuthorize(rt, {
      action: {
        ...rt.action,
        id: "action-exp-b" as typeof rt.action.id,
        parameters: { sku: "FG-B" },
      },
      idempotencyKey: "exp-b",
      amount: 500000,
      grantId: "grant-exp-b",
    });
    expect(a1.ok && a2.ok).toBe(true);
    if (!a1.ok || !a2.ok) return;
    const [c1, c2] = await Promise.all([
      executePrivilegedPayment(rt, {
        preparedAction: a1.value.prepared,
        grantId: a1.value.grantId,
        commitToken: a1.value.commitToken,
        exposureThreshold: 800000,
        relatedGroupId: "salami-group",
      }),
      executePrivilegedPayment(rt, {
        preparedAction: a2.value.prepared,
        grantId: a2.value.grantId,
        commitToken: a2.value.commitToken,
        exposureThreshold: 800000,
        relatedGroupId: "salami-group",
      }),
    ]);
    const oks = [c1, c2].filter((r) => r.ok);
    const fails = [c1, c2].filter((r) => !r.ok);
    expect(oks).toHaveLength(1);
    expect(fails).toHaveLength(1);
    if (!fails[0]!.ok) {
      expect(fails[0]!.code).toBe(ErrorCode.CUMULATIVE_EXPOSURE_EXCEEDED);
    }
  });

  it("revoked grant is rejected at commit", async () => {
    const rt = await makeRuntime();
    const auth = await prepareAuthorize(rt, { idempotencyKey: "revoke-1" });
    expect(auth.ok).toBe(true);
    if (!auth.ok) return;
    await rt.authority.revokeGrant(auth.value.grantId, NOW);
    const commit = await executePrivilegedPayment(rt, {
      preparedAction: auth.value.prepared,
      grantId: auth.value.grantId,
      commitToken: auth.value.commitToken,
    });
    expect(commit.ok).toBe(false);
    if (!commit.ok) expect(commit.code).toBe(ErrorCode.GRANT_REVOKED);
  });

  it("duplicate commit is idempotent replay after success", async () => {
    const rt = await makeRuntime();
    const first = await executePrivilegedPayment(rt, { idempotencyKey: "dup-1" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await executePrivilegedPayment(rt, { idempotencyKey: "dup-1" });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.status).toBe("IDEMPOTENT_REPLAY");
  });

  it("UNKNOWN execution cannot be blindly retried", async () => {
    const rt = await makeRuntime();
    const auth = await prepareAuthorize(rt, { idempotencyKey: "unk-lock" });
    expect(auth.ok).toBe(true);
    if (!auth.ok) return;
    const first = await executePrivilegedPayment(rt, {
      preparedAction: auth.value.prepared,
      grantId: auth.value.grantId,
      commitToken: auth.value.commitToken,
      adapterMode: "timeout_unknown",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.status).toBe("UNKNOWN");
    const retry = await executePrivilegedPayment(rt, {
      preparedAction: auth.value.prepared,
      grantId: auth.value.grantId,
      commitToken: auth.value.commitToken,
      adapterMode: "success",
    });
    expect(retry.ok).toBe(false);
    if (!retry.ok) {
      expect(retry.code).toBe(ErrorCode.UNKNOWN_EXECUTION_CANNOT_RETRY);
    }
  });

  it("Gateway authorize does not mint grants", async () => {
    const rt = await makeRuntime();
    const prepared = await rt.gateway.prepare({
      action: rt.action,
      verdict: rt.verdict,
      principalId: "principal-1",
      toolId: "payment.execute",
      agentCapabilities: parentScope().capabilities,
      externalState: {
        merchant: "approved-a",
        product: "fg-container",
        quantity: 500,
        amount: 700000,
        currency: "INR",
        refundability: true,
        sku: "FG-500",
      },
      idempotencyKey: "no-mint",
      expiresAt: FUTURE,
      createdAt: NOW,
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const unauthorizedMint = await rt.gateway.authorize({
      preparedActionId: prepared.value.id,
      grantId: "never-minted",
      expiresAt: FUTURE,
    });
    expect(unauthorizedMint.ok).toBe(false);
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./two-phase.ts", import.meta.url), "utf8"),
    );
    expect(src).not.toContain("createGrantWithApproval");
    void mintThenAuthorize;
    void PreparedActionLifecycle;
  });
});

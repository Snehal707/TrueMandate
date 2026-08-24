import { InMemoryIdempotencyStore, InMemoryNonceStore } from "@truemandate/crypto";
import {
  ErrorCode,
  GrantConsumptionState,
  OutcomeContractState,
  PaymentStatus,
  asAuthorityGrantId,
  asCommitTokenId,
  asNonce,
  asPreparedActionId,
  asRemediationMandateId,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { assertBundleReadyForCommit } from "./bundle.js";
import { validateCommit } from "./commit.js";
import {
  FUTURE,
  LATER,
  makeCommitToken,
  makeGrant,
  makeIntent,
  makeIntentState,
  makeOutcomeContract,
  makePrepared,
  makeRemedy,
  NOW,
  PAST,
} from "./fixtures.js";
import {
  assertNotRevokedAtCommit,
  loadAndValidateGrantForExecution,
  revokeGrant,
  validateCommitToken,
  validateGrantForExecution,
} from "./grant.js";
import { InMemoryGrantStore } from "./grant-store.js";
import {
  applyPaymentSuccess,
  markOutcomeSatisfied,
} from "./outcome.js";
import { assertIndependentRemedyAuthority } from "./remediation-mandate.js";
import {
  assertPreparedActionUnmodified,
  revalidateExternalState,
  requirePreparedAction,
} from "./prepared-action.js";

describe("INV_009 payment success cannot satisfy outcome", () => {
  it("updates paymentStatus without SATISFIED", async () => {
    const intent = makeIntent();
    const state = makeIntentState(intent, []);
    const contract = makeOutcomeContract(state);
    const result = applyPaymentSuccess(contract, LATER);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.paymentStatus).toBe(PaymentStatus.SUCCESS);
      expect(result.value.state).not.toBe(OutcomeContractState.SATISFIED);
      expect(result.value.state).toBe(OutcomeContractState.AWAITING_OUTCOME);
    }
  });

  it("allows SATISFIED only after verification", async () => {
    const intent = makeIntent();
    const state = makeIntentState(intent, []);
    const paid = applyPaymentSuccess(makeOutcomeContract(state), LATER);
    if (!paid.ok) return;
    const verified = markOutcomeSatisfied(paid.value, LATER, true);
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.value.state).toBe(OutcomeContractState.SATISFIED);
  });
});

describe("INV_010 / INV_023 independent authority for resolution/compensation", () => {
  it("blocks financial remedy without mandate", async () => {
    const result = assertIndependentRemedyAuthority(makeRemedy(), asAuthorityGrantId("grant-1"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ErrorCode.REMEDIATION_MANDATE_REQUIRED);
    }
  });

  it("blocks mandate id colliding with original payment grant", async () => {
    const result = assertIndependentRemedyAuthority(
      makeRemedy({
        requiredRemediationMandateId: asRemediationMandateId("grant-1"),
      }),
      asAuthorityGrantId("grant-1"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ErrorCode.COMPENSATION_REQUIRES_INDEPENDENT_AUTHORITY);
    }
  });

  it("allows distinct remediation mandate reference", async () => {
    const result = assertIndependentRemedyAuthority(
      makeRemedy({
        requiredRemediationMandateId: asRemediationMandateId("mandate-remedy"),
      }),
      asAuthorityGrantId("grant-1"),
    );
    expect(result.ok).toBe(true);
  });
});

describe("INV_016 prepared action required", () => {
  it("blocks null prepared action", async () => {
    const result = requirePreparedAction(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.PREPARED_ACTION_REQUIRED);
  });
});

describe("INV_017 prepared parameters immutable", () => {
  it("blocks parameter mutation", async () => {
    const intent = makeIntent();
    const state = makeIntentState(intent, []);
    const prepared = makePrepared(intent, state);
    const result = assertPreparedActionUnmodified(prepared, {
      ...prepared.parameters,
      amount: 999999,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.PREPARED_ACTION_IMMUTABLE);
  });
});

describe("INV_018 authority binds to prepared-action hash", () => {
  it("blocks hash mismatch at commit validation", async () => {
    const intent = makeIntent();
    const state = makeIntentState(intent, []);
    const prepared = makePrepared(intent, state);
    const other = makePrepared(intent, state, { amount: 100 });
    const grant = makeGrant(state, prepared, {
      preparedActionHash: other.preparedActionHash,
    });
    const result = validateGrantForExecution(grant, {
      now: NOW,
      currentIntentState: state,
      preparedAction: prepared,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.PREPARED_ACTION_HASH_MISMATCH);
  });
});

describe("INV_019 commit tokens single-use and expiring", () => {
  it("blocks consumed token", async () => {
    const intent = makeIntent();
    const state = makeIntentState(intent, []);
    const prepared = makePrepared(intent, state);
    const grant = makeGrant(state, prepared);
    const token = makeCommitToken(grant, prepared, { consumed: true });
    const result = validateCommitToken(token, NOW, prepared.preparedActionHash);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.COMMIT_TOKEN_CONSUMED);
  });

  it("blocks expired token", async () => {
    const intent = makeIntent();
    const state = makeIntentState(intent, []);
    const prepared = makePrepared(intent, state);
    const grant = makeGrant(state, prepared);
    const token = makeCommitToken(grant, prepared, { expiresAt: PAST });
    const result = validateCommitToken(token, NOW, prepared.preparedActionHash);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.COMMIT_TOKEN_EXPIRED);
  });
});

describe("INV_020 external state revalidated at commit", () => {
  it("blocks stale price/refundability", async () => {
    const intent = makeIntent();
    const state = makeIntentState(intent, []);
    const prepared = makePrepared(intent, state, {
      amount: 13900,
      refundability: true,
    });
    const result = revalidateExternalState(prepared, {
      merchant: prepared.parameters.merchant,
      product: prepared.parameters.product,
      quantity: prepared.parameters.quantity,
      amount: 15700,
      currency: prepared.parameters.currency,
      refundability: false,
      deliveryTerms: prepared.parameters.deliveryTerms,
      certificationRef: undefined,
      counterparty: prepared.parameters.merchant,
      sku: "FG-500",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.PREPARED_ACTION_STALE);
  });

  it("omitted material fields fail closed", async () => {
    const intent = makeIntent();
    const state = makeIntentState(intent, []);
    const prepared = makePrepared(intent, state, {
      amount: 13900,
      refundability: true,
    });
    const result = revalidateExternalState(prepared, {
      amount: 15700,
    } as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.PREPARED_ACTION_STALE);
  });
});

describe("INV_021 / INV_022 idempotency and UNKNOWN retry", () => {
  it("requires idempotency key and blocks UNKNOWN retry via commit gate", async () => {
    const intent = makeIntent();
    const state = makeIntentState(intent, []);
    const prepared = makePrepared(intent, state);
    const grant = makeGrant(state, prepared);
    const token = makeCommitToken(grant, prepared);
    const store = new InMemoryIdempotencyStore();
    const nonces = new InMemoryNonceStore();
    const grants = new InMemoryGrantStore();
    await grants.put(grant);

    const externalState = {
      merchant: prepared.parameters.merchant,
      product: prepared.parameters.product,
      quantity: prepared.parameters.quantity,
      amount: prepared.parameters.amount,
      currency: prepared.parameters.currency,
      refundability: prepared.parameters.refundability,
      deliveryTerms: prepared.parameters.deliveryTerms,
      certificationRef: undefined,
      counterparty: prepared.parameters.merchant,
      sku: "FG-500",
    };

    const missingKey = await validateCommit({
      now: NOW,
      currentIntentState: state,
      preparedAction: prepared,
      grantId: grant.id,
      grantStore: grants,
      commitToken: token,
      externalState,
      idempotencyStore: store,
      nonceStore: nonces,
    });
    expect(missingKey.ok).toBe(false);
    if (!missingKey.ok) expect(missingKey.code).toBe(ErrorCode.IDEMPOTENCY_KEY_REQUIRED);

    const first = await validateCommit({
      now: NOW,
      currentIntentState: state,
      preparedAction: prepared,
      grantId: grant.id,
      grantStore: grants,
      commitToken: token,
      externalState,
      idempotencyKey: "eco-1",
      idempotencyStore: store,
      nonceStore: nonces,
    });
    expect(first.ok).toBe(true);

    // Simulate lost response: PENDING → UNKNOWN; blind retry must fail.
    const key = store.requireKey("eco-1");
    expect(key.ok).toBe(true);
    if (key.ok) {
      await store.markUnknown(key.value, LATER);
    }

    const second = await validateCommit({
      now: LATER,
      currentIntentState: state,
      preparedAction: prepared,
      grantId: grant.id,
      grantStore: grants,
      commitToken: makeCommitToken(grant, prepared, {
        id: asCommitTokenId("commit-2"),
      }),
      externalState,
      idempotencyKey: "eco-1",
      idempotencyStore: store,
      nonceStore: new InMemoryNonceStore(),
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe(ErrorCode.UNKNOWN_EXECUTION_CANNOT_RETRY);
  });
});

describe("INV_025 revocation reloaded from GrantStore at execution", () => {
  it("blocks when store-revoked even if caller holds stale ACTIVE snapshot", async () => {
    const intent = makeIntent();
    const state = makeIntentState(intent, []);
    const prepared = makePrepared(intent, state);
    const grant = makeGrant(state, prepared);
    const grants = new InMemoryGrantStore();
    await grants.put(grant);
    await grants.revoke(grant.id, LATER);
    const staleLocal = grant; // still ACTIVE in caller's hands
    expect(staleLocal.consumptionState).toBe(GrantConsumptionState.ACTIVE);
    const result = await loadAndValidateGrantForExecution(grants, grant.id, {
      now: LATER,
      currentIntentState: state,
      preparedAction: prepared,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.GRANT_REVOKED);
  });
});

describe("INV_024 bundle constraints before dependent commits", () => {
  it("blocks when dependency not committed", async () => {
    const intent = makeIntent();
    const state = makeIntentState(intent, []);
    const prepared = makePrepared(intent, state);
    const dependent = {
      ...prepared,
      id: asPreparedActionId("prep-2"),
      dependsOnPreparedActionIds: [prepared.id],
      bundleId: "bundle-1",
    };
    const result = assertBundleReadyForCommit(dependent, new Set(), true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.BUNDLE_CONSTRAINTS_UNMET);
  });

  it("allows when deps committed and bundle satisfied", async () => {
    const intent = makeIntent();
    const state = makeIntentState(intent, []);
    const prepared = makePrepared(intent, state);
    const dependent = {
      ...prepared,
      id: asPreparedActionId("prep-2"),
      dependsOnPreparedActionIds: [prepared.id],
      bundleId: "bundle-1",
    };
    expect(assertBundleReadyForCommit(dependent, new Set([prepared.id]), true).ok).toBe(true);
  });
});

describe("INV_025 revocation checked at commit", () => {
  it("blocks revoked grant", async () => {
    const intent = makeIntent();
    const state = makeIntentState(intent, []);
    const prepared = makePrepared(intent, state);
    const grant = revokeGrant(makeGrant(state, prepared), LATER);
    expect(grant.consumptionState).toBe(GrantConsumptionState.REVOKED);
    const result = assertNotRevokedAtCommit(grant);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.GRANT_REVOKED);
  });

  it("allows active grant with future expiry", async () => {
    const intent = makeIntent();
    const state = makeIntentState(intent, []);
    const prepared = makePrepared(intent, state);
    const grant = makeGrant(state, prepared, { expiresAt: FUTURE });
    expect(assertNotRevokedAtCommit(grant).ok).toBe(true);
  });
});

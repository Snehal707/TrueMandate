import {
  assertExecutionGrantBoundToPreparedAction,
  assertMandateCannotExecutePreparedAction,
  assertRemediationMandateValid,
  issueRemediationMandate,
  markMandateExpired,
  validateGrantForExecution,
} from "@truemandate/authority";
import {
  ErrorCode,
  asHashDigest,
  asPrincipalId,
  asRemedyProposalId,
  asResolutionCaseId,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import {
  FUTURE,
  NOW,
  makeGrant,
  makeIntent,
  makeIntentState,
  makePrepared,
  makeRemedy,
} from "./fixtures.js";

describe("RemediationMandate vs execution AuthorityGrant", () => {
  it("broad ACTIVE mandate cannot execute an arbitrary PreparedAction", () => {
    const remedy = makeRemedy();
    const mandate = issueRemediationMandate({
      resolutionCaseId: remedy.resolutionCaseId,
      remedyProposalId: remedy.id,
      principalId: asPrincipalId("principal-1"),
      maxAmount: 100000,
      currency: "INR",
      allowedCapabilities: ["execute_payment"],
      allowedMerchants: ["remedy-counterparty"],
      expiresAt: FUTURE,
      createdAt: NOW,
    });
    const intent = makeIntent();
    const state = makeIntentState(intent, []);
    const prepared = makePrepared(intent, state, {
      merchant: "evil-merchant",
      amount: 999999,
    });
    const blocked = assertMandateCannotExecutePreparedAction(mandate, prepared);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.code).toBe(ErrorCode.REMEDIATION_MANDATE_NOT_EXECUTABLE);
    }
    const scoped = assertRemediationMandateValid(mandate, {
      remedy: { ...remedy, requiredRemediationMandateId: mandate.id },
      resolutionCaseId: remedy.resolutionCaseId,
      now: NOW,
      proposedMerchant: "evil-merchant",
      proposedAmount: 5000,
      proposedCapability: "execute_payment",
    });
    expect(scoped.ok).toBe(false);
    if (!scoped.ok) expect(scoped.code).toBe(ErrorCode.REMEDIATION_MANDATE_SCOPE);
  });

  it("execution grant must bind to exact remedy PreparedAction hash", () => {
    const intent = makeIntent();
    const state = makeIntentState(intent, []);
    const prepared = makePrepared(intent, state, {
      merchant: "remedy-counterparty",
      amount: 6000,
    });
    const grant = makeGrant(state, prepared);
    expect(assertExecutionGrantBoundToPreparedAction(grant, prepared).ok).toBe(true);

    const mutated = makePrepared(intent, state, {
      merchant: "remedy-counterparty",
      amount: 6001,
    });
    expect(mutated.parameterHash).not.toBe(prepared.parameterHash);
    const mismatch = assertExecutionGrantBoundToPreparedAction(grant, mutated);
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.code).toBe(ErrorCode.PREPARED_ACTION_HASH_MISMATCH);
    }

    const exec = validateGrantForExecution(grant, {
      now: NOW,
      currentIntentState: state,
      preparedAction: mutated,
    });
    expect(exec.ok).toBe(false);
    void asHashDigest;
  });

  it("stale remediation mandate cannot authorize a newer remedy", () => {
    const oldRemedy = makeRemedy({ id: asRemedyProposalId("remedy-old") });
    const mandate = markMandateExpired(
      issueRemediationMandate({
        resolutionCaseId: oldRemedy.resolutionCaseId,
        remedyProposalId: oldRemedy.id,
        principalId: asPrincipalId("principal-1"),
        maxAmount: 10000,
        currency: "INR",
        allowedCapabilities: ["execute_payment"],
        allowedMerchants: ["remedy-counterparty"],
        expiresAt: FUTURE,
        createdAt: NOW,
      }),
    );
    const newer = makeRemedy({
      id: asRemedyProposalId("remedy-new"),
      requiredRemediationMandateId: mandate.id,
    });
    const result = assertRemediationMandateValid(mandate, {
      remedy: newer,
      resolutionCaseId: newer.resolutionCaseId,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.code === ErrorCode.REMEDIATION_MANDATE_STALE ||
          result.code === ErrorCode.REMEDIATION_MANDATE_INVALID,
      ).toBe(true);
    }
  });

  it("remediation mandate cannot be reused across unrelated ResolutionCases", () => {
    const remedy = makeRemedy({
      resolutionCaseId: asResolutionCaseId("case-a"),
    });
    const mandate = issueRemediationMandate({
      resolutionCaseId: asResolutionCaseId("case-a"),
      remedyProposalId: remedy.id,
      principalId: asPrincipalId("principal-1"),
      maxAmount: 10000,
      currency: "INR",
      allowedCapabilities: ["execute_payment"],
      allowedMerchants: ["remedy-counterparty"],
      expiresAt: FUTURE,
      createdAt: NOW,
    });
    const result = assertRemediationMandateValid(mandate, {
      remedy: { ...remedy, requiredRemediationMandateId: mandate.id },
      resolutionCaseId: asResolutionCaseId("case-b"),
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ErrorCode.REMEDIATION_MANDATE_CASE_MISMATCH);
    }
  });
});

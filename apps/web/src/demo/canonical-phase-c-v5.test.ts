import { describe, expect, it } from "vitest";
import { CANONICAL_PHASE_C_V5 } from "./canonical-phase-c-v5";

/**
 * Frozen canonical projection integrity. These assertions pin the exact
 * Phase C v5 durable proof values — the demo must never drift from them.
 */

describe("canonical Phase C v5 projection integrity", () => {
  it("is the frozen canonical projection and read-only", () => {
    expect(CANONICAL_PHASE_C_V5.meta.projectionKind).toBe("canonical-phase-c-v5-frozen");
    expect(CANONICAL_PHASE_C_V5.meta.readOnly).toBe(true);
    expect(CANONICAL_PHASE_C_V5.meta.exitCode).toBe(0);
    expect(CANONICAL_PHASE_C_V5.meta.executionId).toBe("tm-dev-phase-c-verifier-zwjnb");
  });

  it("pins the human intent and grounded constraints", () => {
    const p = CANONICAL_PHASE_C_V5;
    expect(p.intent.id).toBe("phase-c-food-grade-500-v5");
    expect(p.intent.rawText).toContain("Buy 500 food-grade containers");
    const budget = p.constraints.find((c) => c.concept === "max_total_budget");
    expect(budget).toMatchObject({ operator: "LT", value: 800000, kind: "FINANCIAL" });
    expect(p.intent.rawText.slice(budget!.sourceSpan.start, budget!.sourceSpan.end))
      .toBe("under INR 800000");
  });

  it("pins authorization: guardian REQUIRE_APPROVAL, authority ALLOW, bounded scope", () => {
    const p = CANONICAL_PHASE_C_V5;
    expect(p.guardian.decision).toBe("REQUIRE_APPROVAL");
    expect(p.guardian.criticalFailure).toBe(false);
    expect(p.guardian.judges).toHaveLength(5);
    expect(p.authority.decision).toBe("ALLOW");
    expect(p.authority).toMatchObject({
      capability: "execute_payment",
      merchant: "phase-b-supplier",
      amount: 742000,
      currency: "INR",
      grantState: "CONSUMED",
    });
  });

  it("pins exactly-once execution economics", () => {
    const p = CANONICAL_PHASE_C_V5;
    expect(p.execution).toMatchObject({
      commitTokenConsumed: true,
      resultState: "SUCCESS",
      amount: 742000,
      currency: "INR",
      counterparty: "phase-b-supplier",
      replayStatus: "IDEMPOTENT_REPLAY",
      replaySameResultRef: true,
      sideEffectCountForFixture: 1,
    });
    expect(p.execution.externalReference).toBe("mock-pay-phase-c-food-grade-500-v5");
    expect(p.preparedAction.amount).toBe(742000);
  });

  it("pins the 500 → 450 → 50 centerpiece: PARTIAL, not SATISFIED", () => {
    const p = CANONICAL_PHASE_C_V5;
    expect(p.outcome.state).toBe("PARTIAL");
    expect(p.outcome.paymentStatus).toBe("SUCCESS");
    expect(p.outcome.divergence).toEqual({
      requiredQuantity: 500,
      verifiedReceived: 450,
      shortfall: 50,
      evidenceClaimIds: ["phase-c-claim-v5-quantity_received"],
    });
    const qty = p.outcome.requirements.find((r) => r.concept === "quantity_received");
    expect(qty).toMatchObject({ state: "PARTIAL", expected: 500 });
  });

  it("pins resolution: UNKNOWN responsibility, no root cause, zero remedies", () => {
    const p = CANONICAL_PHASE_C_V5;
    expect(p.resolution).toMatchObject({
      state: "OPEN",
      responsibilityState: "UNKNOWN",
      rootCauseEstablished: false,
      remedyExecutions: 0,
    });
    expect(p.resolution.evidenceRequests.length).toBeGreaterThanOrEqual(2);
    expect(p.resolution.evidenceRequests.every((r) => r.requiresAuthority === false)).toBe(true);
  });

  it("pins preservation: Phase A token unconsumed, no remediation mandates", () => {
    const p = CANONICAL_PHASE_C_V5;
    expect(p.preservation).toMatchObject({
      phaseACanonicalTokenId: "ct-92ceb56769a0",
      phaseACanonicalTokenConsumed: false,
      phaseBAndCv1to4Intact: true,
      remediationMandatesCount: 0,
    });
  });

  it("timeline is chronologically ordered and internally consistent", () => {
    const times = CANONICAL_PHASE_C_V5.timeline.map((e) => Date.parse(e.at));
    expect(times.every((t) => Number.isFinite(t))).toBe(true);
    const sorted = [...times].sort((a, b) => a - b);
    expect(times).toEqual(sorted);
  });
});

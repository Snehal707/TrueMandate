import { InMemoryExposureLedger, evaluateCumulativeExposure, type ExposureEntry } from "@truemandate/authority";
import { ErrorCode } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";

/** Canonical exposure scope: (relatedGroupId = intentId:currency, currency,
 * status ∈ {APPROVED, IN_FLIGHT, COMMITTED}). This regression reproduces the
 * v5 forensic question: an unresolved IN_FLIGHT reservation from one intent
 * must not influence a fresh independent intent's exposure decision. */
describe("cumulative exposure scoping (v5 forensic isolation)", () => {
  const v5Entry: ExposureEntry = {
    id: "exp-inflight-phase-b-food-grade-500-v5",
    amount: 742000,
    currency: "INR",
    relatedGroupId: "phase-b-food-grade-500-v5:INR",
    status: "IN_FLIGHT",
  };

  it("an unresolved IN_FLIGHT reservation from intent A does not participate in intent B's exposure", async () => {
    const ledger = new InMemoryExposureLedger();
    await ledger.add(v5Entry);
    const projected = await ledger.evaluate({
      threshold: 800000,
      currency: "INR",
      proposedAmount: 742000,
      relatedGroupId: "phase-b-food-grade-500-v6:INR",
    });
    expect(projected.ok).toBe(true);
    expect(projected.ok && projected.value.projected).toBe(742000);
    // The canonical filter itself: the v5 entry is excluded by group.
    const pure = evaluateCumulativeExposure({
      threshold: 800000,
      currency: "INR",
      proposedAmount: 742000,
      relatedGroupId: "phase-b-food-grade-500-v6:INR",
      entries: [v5Entry],
    });
    expect(pure.ok && pure.value.projected).toBe(742000);
  });

  it("a same-group unresolved entry DOES count toward cumulative exposure", async () => {
    const sameGroup: ExposureEntry = { ...v5Entry, id: "exp-inflight-other", relatedGroupId: "phase-b-food-grade-500-v6:INR" };
    const result = evaluateCumulativeExposure({
      threshold: 800000,
      currency: "INR",
      proposedAmount: 742000,
      relatedGroupId: "phase-b-food-grade-500-v6:INR",
      entries: [sameGroup],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.CUMULATIVE_EXPOSURE_EXCEEDED);
  });

  it("PROPOSED entries never count; currency mismatch never counts", async () => {
    const proposed: ExposureEntry = { ...v5Entry, id: "e1", relatedGroupId: "phase-b-food-grade-500-v6:INR", status: "PROPOSED" };
    const wrongCurrency: ExposureEntry = { ...v5Entry, id: "e2", relatedGroupId: "phase-b-food-grade-500-v6:INR", currency: "USD" };
    const ok1 = evaluateCumulativeExposure({
      threshold: 800000, currency: "INR", proposedAmount: 742000,
      relatedGroupId: "phase-b-food-grade-500-v6:INR", entries: [proposed],
    });
    const ok2 = evaluateCumulativeExposure({
      threshold: 800000, currency: "INR", proposedAmount: 742000,
      relatedGroupId: "phase-b-food-grade-500-v6:INR", entries: [wrongCurrency],
    });
    expect(ok1.ok && ok1.value.projected).toBe(742000);
    expect(ok2.ok && ok2.value.projected).toBe(742000);
  });
});

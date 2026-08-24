import { describe, expect, it } from "vitest";
import {
  computeCounterpartyTrustScore,
  createCounterpartyTrustProposal,
} from "./counterparty-trust.js";
import {
  MIN_COUNTERPARTY_OUTCOMES,
  NEUTRAL_SCORE,
} from "./thresholds.js";

const AT = "2026-08-21T12:00:00.000Z";

describe("computeCounterpartyTrustScore", () => {
  it("reliable merchant (0 breaches, 10 outcomes) → trust 1.0", () => {
    const signal = computeCounterpartyTrustScore(
      {
        merchant: "acme",
        totalOutcomes: 10,
        partialOrBreached: 0,
        failureRate: 0,
      },
      AT,
    );
    expect(signal.subjectType).toBe("COUNTERPARTY");
    expect(signal.subjectId).toBe("acme");
    expect(signal.value).toBe(1.0);
    expect(signal.sampleSize).toBe(10);
    expect(signal.basis).toContain("outcome_breaches:0");
    expect(signal.basis).toContain("total_outcomes:10");
  });

  it("unreliable merchant (7 breaches, 10 outcomes) → trust 0.3", () => {
    const signal = computeCounterpartyTrustScore(
      {
        merchant: "sketchy",
        totalOutcomes: 10,
        partialOrBreached: 7,
        failureRate: 0.7,
      },
      AT,
    );
    expect(signal.value).toBeCloseTo(0.3, 6);
  });

  it("insufficient evidence (2 outcomes) → neutral 0.5", () => {
    const signal = computeCounterpartyTrustScore(
      {
        merchant: "new-vendor",
        totalOutcomes: 2,
        partialOrBreached: 0,
        failureRate: 0,
      },
      AT,
    );
    expect(signal.value).toBe(NEUTRAL_SCORE);
    expect(signal.sampleSize).toBe(2);
    expect(signal.basis).toContain(
      `insufficient_evidence:need_${MIN_COUNTERPARTY_OUTCOMES}`,
    );
  });

  it("zero outcomes → neutral 0.5", () => {
    const signal = computeCounterpartyTrustScore(
      {
        merchant: "empty",
        totalOutcomes: 0,
        partialOrBreached: 0,
        failureRate: 0,
      },
      AT,
    );
    expect(signal.value).toBe(NEUTRAL_SCORE);
    expect(signal.sampleSize).toBe(0);
  });

  it("exactly MIN_COUNTERPARTY_OUTCOMES is confident", () => {
    const signal = computeCounterpartyTrustScore(
      {
        merchant: "edge",
        totalOutcomes: MIN_COUNTERPARTY_OUTCOMES,
        partialOrBreached: 1,
        failureRate: 1 / MIN_COUNTERPARTY_OUTCOMES,
      },
      AT,
    );
    expect(signal.value).toBeCloseTo(
      1 - 1 / MIN_COUNTERPARTY_OUTCOMES,
      6,
    );
    expect(
      signal.basis.some((b) => b.startsWith("insufficient_evidence")),
    ).toBe(false);
  });
});

describe("createCounterpartyTrustProposal", () => {
  it("wraps TrustSignal into COUNTERPARTY_TRUST draft", () => {
    const signal = computeCounterpartyTrustScore(
      {
        merchant: "acme",
        totalOutcomes: 5,
        partialOrBreached: 1,
        failureRate: 0.2,
      },
      AT,
    );
    const draft = createCounterpartyTrustProposal(signal, {
      id: "lp-cp-acme",
      principalId: "principal-1",
    });
    expect(draft.proposalType).toBe("COUNTERPARTY_TRUST");
    expect(draft.content.trustSignal).toEqual(signal);
  });

  it("rejects non-COUNTERPARTY subjectType", () => {
    const signal = computeCounterpartyTrustScore(
      {
        merchant: "acme",
        totalOutcomes: 5,
        partialOrBreached: 0,
        failureRate: 0,
      },
      AT,
    );
    expect(() =>
      createCounterpartyTrustProposal(
        { ...signal, subjectType: "AGENT" },
        { id: "x", principalId: "p" },
      ),
    ).toThrow(/COUNTERPARTY/);
  });
});

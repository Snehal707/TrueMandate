import { describe, expect, it } from "vitest";
import { RemedyProposalSchema } from "./objects.js";

/** Pre–Wave 3.6 RemedyProposal document without remedyType. */
const legacyWithoutRemedyType = {
  id: "remedy-legacy-1",
  resolutionCaseId: "rc-1",
  description: "Partial refund for shortfall",
  requiresFinancialAction: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("RemedyProposal schema compatibility (Wave 3.6 remedyType)", () => {
  it("accepts legacy documents without remedyType", () => {
    expect(RemedyProposalSchema.safeParse(legacyWithoutRemedyType).success).toBe(
      true,
    );
  });

  it("accepts documents with a valid remedyType", () => {
    const next = { ...legacyWithoutRemedyType, remedyType: "REFUND" };
    const parsed = RemedyProposalSchema.safeParse(next);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.remedyType).toBe("REFUND");
    }
  });

  it("rejects an invented remedyType outside the deterministic taxonomy", () => {
    const next = { ...legacyWithoutRemedyType, remedyType: "STORE_CREDIT" };
    expect(RemedyProposalSchema.safeParse(next).success).toBe(false);
  });
});

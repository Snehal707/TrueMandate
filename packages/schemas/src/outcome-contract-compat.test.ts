import { describe, expect, it } from "vitest";
import { OutcomeContractSchema } from "./objects.js";

/** Pre–Wave 3.5 OutcomeContract document without merchant. */
const legacyWithoutMerchant = {
  id: "oc-legacy-1",
  intentId: "intent-1",
  intentStateId: "is-1",
  requirements: [
    {
      id: "req-1",
      concept: "quantity_received",
      operator: "GTE",
      value: 1,
      criticality: "HARD",
      state: "PENDING",
    },
  ],
  state: "CREATED",
  paymentStatus: "PENDING",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("OutcomeContract schema compatibility (Wave 3.5 merchant)", () => {
  it("accepts legacy documents without merchant", () => {
    expect(OutcomeContractSchema.safeParse(legacyWithoutMerchant).success).toBe(
      true,
    );
  });

  it("accepts documents with merchant", () => {
    const next = { ...legacyWithoutMerchant, merchant: "supplier-acme" };
    const parsed = OutcomeContractSchema.safeParse(next);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.merchant).toBe("supplier-acme");
    }
  });
});

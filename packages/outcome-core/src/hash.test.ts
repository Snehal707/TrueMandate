import {
  ConstraintOperator,
  OutcomeRequirementCriticality,
  OutcomeRequirementState,
  asOutcomeRequirementId,
  type OutcomeContract,
} from "@truemandate/protocol";
import { hashCanonical } from "@truemandate/crypto";
import { describe, expect, it } from "vitest";
import {
  assertNonCircularBinding,
  hashOutcomeContract,
  hashOutcomeContractDefinition,
  toOutcomeContractDefinition,
} from "./hash.js";

function sampleContract(
  overrides: Partial<OutcomeContract> = {},
): OutcomeContract {
  return {
    id: "oc-1" as OutcomeContract["id"],
    intentId: "intent-1" as OutcomeContract["intentId"],
    intentStateId: "state-1" as OutcomeContract["intentStateId"],
    intentStateHash: "ish" as OutcomeContract["intentStateHash"],
    requirements: [
      {
        id: asOutcomeRequirementId("req-1"),
        concept: "quantity_received",
        operator: ConstraintOperator.GTE,
        value: 500,
        criticality: OutcomeRequirementCriticality.HARD,
        state: OutcomeRequirementState.PENDING,
      },
    ],
    state: "CREATED",
    paymentStatus: "PENDING",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

describe("OutcomeContractDefinition staged binding", () => {
  it("same definition → same hash (determinism)", () => {
    const a = hashOutcomeContract(sampleContract());
    const b = hashOutcomeContract(sampleContract());
    expect(a).toBe(b);
  });

  it("mutating definition changes hash", () => {
    const a = hashOutcomeContract(sampleContract());
    const b = hashOutcomeContract(
      sampleContract({
        requirements: [
          {
            id: asOutcomeRequirementId("req-1"),
            concept: "quantity_received",
            operator: ConstraintOperator.GTE,
            value: 450,
            criticality: OutcomeRequirementCriticality.HARD,
            state: OutcomeRequirementState.PENDING,
          },
        ],
      }),
    );
    expect(a).not.toBe(b);
  });

  it("preparedActionHash does not affect definition/binding hash", () => {
    const without = hashOutcomeContract(sampleContract());
    const withPa = hashOutcomeContract(
      sampleContract({
        preparedActionId: "prep-1" as OutcomeContract["preparedActionId"],
        preparedActionHash: "pa-hash-xyz" as OutcomeContract["preparedActionHash"],
      }),
    );
    expect(without).toBe(withPa);
  });

  it("parameterHash is independent of outcomeContractHash", () => {
    const params = {
      merchant: "m",
      amount: 100,
      currency: "INR",
      toolParameters: { sku: "X" },
    };
    const parameterHash = hashCanonical(params);
    const outcomeContractHash = hashOutcomeContract(sampleContract());
    expect(parameterHash).not.toBe(outcomeContractHash);
    // Structural: parameter hash input has no outcome fields
    expect(JSON.stringify(params)).not.toContain(outcomeContractHash);
    expect(
      assertNonCircularBinding({
        parameterHash,
        outcomeContractHash,
        definitionIncludesPreparedActionHash: false,
        parameterHashIncludesOutcomeContractHash: false,
      }),
    ).toBe(true);
  });

  it("definitionHash equals hashOutcomeContractDefinition(toDefinition)", () => {
    const c = sampleContract();
    const def = toOutcomeContractDefinition(c);
    expect(hashOutcomeContract(c)).toBe(hashOutcomeContractDefinition(def));
  });
});

import {
  ConstraintOperator,
  OutcomeRequirementCriticality,
  OutcomeRequirementState,
  asOutcomeRequirementId,
} from "@truemandate/protocol";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  aggregateRequirementStates,
  assertCriticalityLocked,
} from "./aggregate.js";
import { assertTransitionAllowed } from "./transitions.js";
import { OutcomeContractState } from "@truemandate/protocol";

describe("outcome-core aggregation", () => {
  it("SAFETY_CRITICAL BREACHED dominates soft SATISFIED", () => {
    const agg = aggregateRequirementStates([
      {
        id: asOutcomeRequirementId("a"),
        concept: "soft",
        operator: ConstraintOperator.REQUIRE,
        value: true,
        criticality: OutcomeRequirementCriticality.SOFT,
        state: OutcomeRequirementState.SATISFIED,
      },
      {
        id: asOutcomeRequirementId("b"),
        concept: "food_grade",
        operator: ConstraintOperator.REQUIRE,
        value: true,
        criticality: OutcomeRequirementCriticality.SAFETY_CRITICAL,
        state: OutcomeRequirementState.BREACHED,
      },
    ]);
    expect(agg.overallState).toBe(OutcomeContractState.BREACHED);
    expect(agg.criticalFailure).toBe(true);
  });

  it("criticality lock rejects softening", () => {
    const original = [
      {
        id: asOutcomeRequirementId("b"),
        concept: "food_grade",
        operator: ConstraintOperator.REQUIRE,
        value: true,
        criticality: OutcomeRequirementCriticality.SAFETY_CRITICAL,
        state: OutcomeRequirementState.PENDING,
      },
    ];
    const proposed = [
      {
        ...original[0]!,
        criticality: OutcomeRequirementCriticality.SOFT,
      },
    ];
    expect(assertCriticalityLocked(original, proposed)).toBe(false);
  });

  it("property: CREATED cannot jump to SATISFIED", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const r = assertTransitionAllowed(
          OutcomeContractState.CREATED,
          OutcomeContractState.SATISFIED,
        );
        expect(r.ok).toBe(false);
      }),
      { numRuns: 5 },
    );
  });
});

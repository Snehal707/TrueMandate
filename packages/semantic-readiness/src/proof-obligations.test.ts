import {
  ConstraintKind,
  ConstraintOperator,
  MeaningClass,
  SourceType,
  type Constraint,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import {
  constraintRequiresProofObligation,
  deriveRequiredProofObligations,
} from "./proof-obligations.js";

const travelContract = {
  conceptFamilies: [
    { canonicalConcept: "stay_start", aliases: ["stay_date", "stay_start_date", "check_in", "check_in_date"] },
    { canonicalConcept: "stay_end", aliases: ["stay_end_date", "check_out", "check_out_date"] },
    { canonicalConcept: "completion_deadline", aliases: ["completion_deadline", "deadline"] },
  ],
  executionCriticalConceptRules: ["stay_start", "stay_end", "completion_deadline"]
    .map((canonicalConcept) => ({ canonicalConcept, proofMechanism: { kind: "EVIDENCE_OBLIGATION" as const } })),
};

function temporalConstraint(
  id: string,
  concept: string,
  value: string,
): Constraint {
  return {
    id,
    concept,
    operator: ConstraintOperator.EQ,
    value,
    kind: ConstraintKind.TEMPORAL,
    importance: 1,
    confidence: 1,
    sourceType: SourceType.HUMAN,
    mutability: "HUMAN_REVISABLE",
    meaningClass: MeaningClass.EXPLICIT,
    grounding: {
      sourceText: value,
      sourceSpan: { start: 0, end: value.length },
      quoteExact: true,
    },
  } as Constraint;
}

describe("deriveRequiredProofObligations", () => {
  it("derives an execution-critical proof obligation for travel stay_date even when temporal authority points elsewhere", () => {
    const obligations = deriveRequiredProofObligations(
      [
        temporalConstraint("c-stay-date", "stay_date", "2026-12-20"),
        temporalConstraint("c-completion-deadline", "completion_deadline", "2026-12-31T00:00:00.000Z"),
      ],
      {
        temporalAuthority: {
          source: "EXPLICIT_HUMAN",
          sourceRef: "c-completion-deadline",
        },
        conceptContract: travelContract,
      },
    );

    expect(obligations.map((row) => row.constraintId)).toEqual(
      expect.arrayContaining(["c-stay-date", "c-completion-deadline"]),
    );
  });

  it("treats completion_deadline as a required execution-critical temporal constraint when the domain marks deadline coverage", () => {
    const constraint = temporalConstraint(
      "c-completion-deadline",
      "completion_deadline",
      "2026-12-31T00:00:00.000Z",
    );

    expect(
      constraintRequiresProofObligation(constraint, {
        conceptContract: travelContract,
      }),
    ).toBe(true);

    const obligations = deriveRequiredProofObligations([constraint], {
      conceptContract: travelContract,
    });
    expect(obligations).toHaveLength(1);
    expect(obligations[0]?.constraintId).toBe("c-completion-deadline");
    expect(obligations[0]?.requiredEvidence).toBe("delivery deadline evidence");
  });

  it.each(["stay_date", "stay_start_date", "stay_end_date", "check_in", "check_out", "completion_deadline"])(
    "derives an obligation for the exact declared travel alias %s",
    (concept) => {
      const obligations = deriveRequiredProofObligations(
        [temporalConstraint(`c-${concept}`, concept, "2026-12-20")],
        { conceptContract: travelContract },
      );
      expect(obligations.map((row) => row.constraintId)).toEqual([`c-${concept}`]);
    },
  );

  it("does not infer undeclared near-match concepts", () => {
    const obligations = deriveRequiredProofObligations(
      [temporalConstraint("c-near", "pre_stay_date_note", "2026-12-20")],
      { conceptContract: travelContract },
    );
    expect(obligations).toEqual([]);
  });
});

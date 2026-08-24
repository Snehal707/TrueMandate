import {
  ConstraintKind,
  ConstraintMutability,
  ConstraintOperator,
  MeaningClass,
  SourceType,
  WorkflowRuleStatus,
  asConstraintId,
  asHashDigest,
  asLearningProposalId,
  asPrincipalId,
  asWorkflowRuleId,
  type Constraint,
  type WorkflowRule,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import {
  ApplicableWorkflowRuleKind,
  resolveApplicableWorkflowRule,
} from "./applicability.js";

function makeConstraint(
  concept: string,
  kind: ConstraintKind = ConstraintKind.SOFT,
): Constraint {
  return {
    id: asConstraintId(`c-${concept}`),
    concept,
    operator: ConstraintOperator.EQ,
    value: true,
    kind,
    importance: 1,
    confidence: 1,
    sourceType: SourceType.HUMAN,
    mutability: ConstraintMutability.HUMAN_REVISABLE,
    meaningClass: MeaningClass.EXPLICIT,
  };
}

function makeRule(concept: string): WorkflowRule {
  return {
    id: asWorkflowRuleId(`wr-${concept}`),
    subjectId: "principal:a@example.com",
    domain: "TRAVEL",
    concept,
    action: { prefer: true },
    version: 1,
    status: WorkflowRuleStatus.ACTIVE,
    evidenceRefs: ["lp-1", "lp-2", "lp-3"],
    basis: ["confirmed_preference:p1@t", "confirmed_preference:p2@t", "confirmed_preference:p3@t"],
    sourceLearningProposalId: asLearningProposalId("lp-rule-1"),
    createdAt: "2026-08-21T12:00:00.000Z",
    confirmedAt: "2026-08-21T12:00:00.000Z",
    confirmedBy: asPrincipalId("a@example.com"),
    contentHash: asHashDigest("c".repeat(64)),
  };
}

describe("resolveApplicableWorkflowRule", () => {
  it("sticky constraint always wins over rule", () => {
    const result = resolveApplicableWorkflowRule(
      [makeConstraint("food_grade", ConstraintKind.HARD)],
      "food_grade",
      makeRule("food_grade"),
    );
    expect(result.kind).toBe(ApplicableWorkflowRuleKind.EXPLICIT_CURRENT);
  });

  it("any existing explicit constraint wins", () => {
    const result = resolveApplicableWorkflowRule(
      [makeConstraint("refundable", ConstraintKind.PREFERENCE)],
      "refundable",
      makeRule("refundable"),
    );
    expect(result.kind).toBe(ApplicableWorkflowRuleKind.EXPLICIT_CURRENT);
  });

  it("protected concept yields NONE even when unspecified", () => {
    const result = resolveApplicableWorkflowRule([], "budget", makeRule("budget"));
    expect(result.kind).toBe(ApplicableWorkflowRuleKind.NONE);
  });

  it("active rule fills unspecified soft concept", () => {
    const rule = makeRule("refundable");
    const result = resolveApplicableWorkflowRule([], "refundable", rule);
    expect(result.kind).toBe(ApplicableWorkflowRuleKind.RULE);
    expect(result.rule).toBe(rule);
  });

  it("no rule yields NONE", () => {
    const result = resolveApplicableWorkflowRule([], "refundable");
    expect(result.kind).toBe(ApplicableWorkflowRuleKind.NONE);
  });
});

import { ErrorCode } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import {
  assertWorkflowRuleCannotTargetProtectedConcept,
  assertWorkflowRuleContent,
  assertWorkflowRuleHasSufficientEvidence,
} from "./workflow-rule-signal.js";

describe("INV_028 workflow-rule-signal", () => {
  it("rejects protected concepts", () => {
    for (const concept of [
      "budget",
      "quantity",
      "merchant",
      "deadline",
      "capability",
      "authority",
    ]) {
      const result = assertWorkflowRuleCannotTargetProtectedConcept(concept);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(ErrorCode.WORKFLOW_RULE_PROTECTED_CONCEPT);
      }
    }
  });

  it("allows soft concepts", () => {
    expect(
      assertWorkflowRuleCannotTargetProtectedConcept("refundable").ok,
    ).toBe(true);
  });

  it("rejects insufficient or duplicate-only evidence", () => {
    expect(assertWorkflowRuleHasSufficientEvidence(["a", "b"]).ok).toBe(false);
    const dup = assertWorkflowRuleHasSufficientEvidence(["a", "a", "a"]);
    expect(dup.ok).toBe(false);
    if (!dup.ok) {
      expect(dup.code).toBe(ErrorCode.WORKFLOW_RULE_INSUFFICIENT_EVIDENCE);
    }
  });

  it("accepts three distinct evidence refs", () => {
    expect(assertWorkflowRuleHasSufficientEvidence(["a", "b", "c"]).ok).toBe(
      true,
    );
  });

  it("assertWorkflowRuleContent requires full shape", () => {
    expect(
      assertWorkflowRuleContent({
        subjectId: "principal:a@example.com",
        concept: "refundable",
        action: { prefer: true },
        evidenceRefs: ["lp-1", "lp-2", "lp-3"],
        basis: ["confirmed_preference:p1@t", "b", "c"],
      }).ok,
    ).toBe(true);

    expect(assertWorkflowRuleContent({ concept: "refundable" }).ok).toBe(false);
    expect(
      assertWorkflowRuleContent({
        subjectId: "principal:a@example.com",
        concept: "budget",
        action: {},
        evidenceRefs: ["a", "b", "c"],
        basis: ["a", "b", "c"],
      }).ok,
    ).toBe(false);
    expect(
      assertWorkflowRuleContent({
        subjectId: "principal:a@example.com",
        concept: "refundable",
        action: {},
        evidenceRefs: ["a", "b"],
        basis: ["a", "b"],
      }).ok,
    ).toBe(false);
  });
});

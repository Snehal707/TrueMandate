import { createLearningProposal } from "./learning.js";
import { ErrorCode } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";

const AT = "2026-08-21T12:00:00.000Z";

const VALID_RULE_CONTENT = {
  subjectId: "principal:a@example.com",
  concept: "refundable",
  action: { prefer: true },
  evidenceRefs: ["lp-1", "lp-2", "lp-3"],
  basis: [
    "confirmed_preference:p1@2026-01-01T00:00:00.000Z",
    "confirmed_preference:p2@2026-01-02T00:00:00.000Z",
    "confirmed_preference:p3@2026-01-03T00:00:00.000Z",
  ],
};

describe("createLearningProposal INV_028 WORKFLOW_RULE", () => {
  it("rejects WORKFLOW_RULE targeting protected concept", () => {
    const created = createLearningProposal({
      draft: {
        id: "wr-budget",
        principalId: "principal-1",
        domain: "TRAVEL",
        proposalType: "WORKFLOW_RULE",
        content: { ...VALID_RULE_CONTENT, concept: "budget" },
        createdAt: AT,
      },
    });
    expect(created.ok).toBe(false);
    if (!created.ok) {
      expect(created.code).toBe(ErrorCode.WORKFLOW_RULE_PROTECTED_CONCEPT);
    }
  });

  it("rejects WORKFLOW_RULE with insufficient evidence", () => {
    const created = createLearningProposal({
      draft: {
        id: "wr-thin",
        principalId: "principal-1",
        domain: "TRAVEL",
        proposalType: "WORKFLOW_RULE",
        content: {
          ...VALID_RULE_CONTENT,
          evidenceRefs: ["lp-1", "lp-2"],
        },
        createdAt: AT,
      },
    });
    expect(created.ok).toBe(false);
    if (!created.ok) {
      expect(created.code).toBe(ErrorCode.WORKFLOW_RULE_INSUFFICIENT_EVIDENCE);
    }
  });

  it("accepts well-formed WORKFLOW_RULE", () => {
    const created = createLearningProposal({
      draft: {
        id: "wr-ok",
        principalId: "principal-1",
        domain: "TRAVEL",
        proposalType: "WORKFLOW_RULE",
        content: VALID_RULE_CONTENT,
        createdAt: AT,
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.requiresConfirmation).toBe(true);
    expect(created.value.proposalType).toBe("WORKFLOW_RULE");
  });

  it("still applies INV_015 when WORKFLOW_RULE carries expanding scope pair", () => {
    const created = createLearningProposal({
      draft: {
        id: "wr-expand",
        principalId: "principal-1",
        domain: "TRAVEL",
        proposalType: "WORKFLOW_RULE",
        content: {
          ...VALID_RULE_CONTENT,
          currentScope: {
            capabilities: { execute_payment: "ALLOW" },
            maxAmount: 1000,
            currency: "INR",
          },
          proposedScope: {
            capabilities: { execute_payment: "ALLOW" },
            maxAmount: 999999,
            currency: "INR",
          },
        },
        createdAt: AT,
      },
    });
    expect(created.ok).toBe(false);
    if (!created.ok) {
      expect(created.code).toBe(ErrorCode.CRITICAL_FAILURE_CANNOT_EXPAND_AUTHORITY);
    }
  });
});

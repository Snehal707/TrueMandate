import { createLearningProposal } from "./learning.js";
import { ErrorCode } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";

const AT = "2026-08-21T12:00:00.000Z";

describe("createLearningProposal INV_027 USER_PREFERENCE", () => {
  it("rejects USER_PREFERENCE targeting protected concept", () => {
    const created = createLearningProposal({
      draft: {
        id: "lp-budget",
        principalId: "principal-1",
        domain: "TRAVEL",
        proposalType: "USER_PREFERENCE",
        content: {
          subjectId: "principal:a@example.com",
          concept: "budget",
          value: 50_000,
          origin: "EXPLICIT_USER_INPUT",
        },
        createdAt: AT,
      },
    });
    expect(created.ok).toBe(false);
    if (!created.ok) {
      expect(created.code).toBe(ErrorCode.PREFERENCE_PROTECTED_CONCEPT);
    }
  });

  it("accepts well-formed USER_PREFERENCE for soft concept", () => {
    const created = createLearningProposal({
      draft: {
        id: "lp-refundable",
        principalId: "principal-1",
        domain: "TRAVEL",
        proposalType: "USER_PREFERENCE",
        content: {
          subjectId: "principal:a@example.com",
          concept: "refundable",
          value: true,
          origin: "EXPLICIT_USER_INPUT",
        },
        createdAt: AT,
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.requiresConfirmation).toBe(true);
    expect(created.value.proposalType).toBe("USER_PREFERENCE");
  });

  it("does not apply INV_027 to non-preference proposal types", () => {
    const created = createLearningProposal({
      draft: {
        id: "lp-agent",
        principalId: "principal-1",
        domain: "procurement",
        proposalType: "AGENT_RELIABILITY",
        content: {
          trustSignal: {
            subjectType: "AGENT",
            subjectId: "agent-1",
            domain: "procurement",
            value: 0.9,
            sampleSize: 10,
            basis: ["workflows_observed:10"],
            computedAt: AT,
          },
        },
        createdAt: AT,
      },
    });
    expect(created.ok).toBe(true);
  });
});

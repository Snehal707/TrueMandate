import {
  WorkflowRuleStatus,
  asHashDigest,
  asLearningProposalId,
  asPrincipalId,
  asWorkflowRuleId,
  type WorkflowRule,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { resolveRuleSupersession } from "./supersession.js";

function makeRule(
  overrides: Partial<WorkflowRule> & Pick<WorkflowRule, "id" | "version" | "status">,
): WorkflowRule {
  return {
    subjectId: "principal:a@example.com",
    domain: "TRAVEL",
    concept: "refundable",
    action: { prefer: true },
    evidenceRefs: ["lp-1", "lp-2", "lp-3"],
    basis: ["a", "b", "c"],
    sourceLearningProposalId: asLearningProposalId("lp-rule"),
    createdAt: "2026-08-21T12:00:00.000Z",
    confirmedAt: "2026-08-21T12:00:00.000Z",
    confirmedBy: asPrincipalId("a@example.com"),
    contentHash: asHashDigest("d".repeat(64)),
    ...overrides,
    id: asWorkflowRuleId(overrides.id),
  };
}

describe("resolveRuleSupersession", () => {
  it("activates v1 when no existing active rule", () => {
    const incoming = makeRule({
      id: "wr-1",
      version: 99,
      status: WorkflowRuleStatus.ACTIVE,
    });
    const decision = resolveRuleSupersession(undefined, incoming);
    expect(decision.activate).toBe(true);
    expect(decision.incoming.version).toBe(1);
    expect(decision.incoming.status).toBe(WorkflowRuleStatus.ACTIVE);
    expect(decision.previous).toBeUndefined();
  });

  it("newer confirm supersedes to v2 with reconstructable lineage", () => {
    const existing = makeRule({
      id: "wr-1",
      version: 1,
      status: WorkflowRuleStatus.ACTIVE,
    });
    const incoming = makeRule({
      id: "wr-2",
      version: 1,
      status: WorkflowRuleStatus.ACTIVE,
      action: { prefer: false },
      sourceLearningProposalId: asLearningProposalId("lp-rule-2"),
    });
    const decision = resolveRuleSupersession(existing, incoming);
    expect(decision.activate).toBe(true);
    expect(decision.incoming.version).toBe(2);
    expect(decision.incoming.supersedesId).toBe(existing.id);
    expect(decision.previous?.status).toBe(WorkflowRuleStatus.SUPERSEDED);
    expect(decision.previous?.supersededById).toBe(decision.incoming.id);
  });
});

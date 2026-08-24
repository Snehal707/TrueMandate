import {
  ErrorCode,
  LearningStatus,
  asPrincipalId,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import {
  makeIntent,
  makeIntentState,
  makeParentScope,
  NOW,
} from "./fixtures.js";
import {
  confirmLearningProposal,
  createLearningProposal,
  expireLearningProposalIfPast,
  parseLearningProposal,
  rejectLearningProposal,
} from "./learning.js";

const ACTOR = "owner@example.com";

function baseDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: "learn-lifecycle-1",
    principalId: "principal-1",
    domain: "procurement",
    proposalType: "AGENT_RELIABILITY" as const,
    content: {
      trustSignal: {
        subjectType: "AGENT",
        subjectId: "agent-1",
        domain: "procurement",
        value: 0.9,
        sampleSize: 10,
        basis: ["workflows_observed:10"],
        computedAt: NOW,
      },
    },
    createdAt: NOW,
    ...overrides,
  };
}

describe("LearningProposal lifecycle", () => {
  it("creates a PROPOSED proposal with requiresConfirmation and contentHash", () => {
    const created = createLearningProposal({ draft: baseDraft() });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.status).toBe(LearningStatus.PROPOSED);
    expect(created.value.requiresConfirmation).toBe(true);
    expect(created.value.contentHash.length).toBeGreaterThan(0);
    const reparsed = parseLearningProposal(created.value);
    expect(reparsed.ok).toBe(true);
  });

  it("blocks create when targetIntentId would rewrite historical intent (INV_011)", () => {
    const intent = makeIntent();
    const state = makeIntentState(intent, []);
    const created = createLearningProposal({
      draft: baseDraft({
        principalId: intent.principalId,
        targetIntentId: intent.id,
      }),
      historicalIntent: intent,
      historicalState: state,
    });
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.code).toBe(ErrorCode.LEARNING_CANNOT_REWRITE_INTENT);
  });

  it("blocks create when proposedScope expands authority (INV_015)", () => {
    const current = makeParentScope();
    const expanded = { ...current, maxAmount: (current.maxAmount ?? 0) + 1_000_000 };
    const created = createLearningProposal({
      draft: baseDraft({
        content: { currentScope: current, proposedScope: expanded },
      }),
    });
    expect(created.ok).toBe(false);
    if (!created.ok) {
      expect(created.code).toBe(ErrorCode.CRITICAL_FAILURE_CANNOT_EXPAND_AUTHORITY);
    }
  });

  it("confirms a proposal and emits LearnedContextRecord", () => {
    const created = createLearningProposal({ draft: baseDraft() });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const confirmed = confirmLearningProposal(created.value, {
      decidedBy: ACTOR,
      at: "2026-06-04T13:00:00.000Z",
      reason: "human accepted",
      eventId: "evt-confirm-1",
    });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.value.updated.status).toBe(LearningStatus.CONFIRMED);
    expect(confirmed.value.updated.decidedBy).toBe(asPrincipalId(ACTOR));
    expect(confirmed.value.event.type).toBe("CONFIRMED");
    expect(confirmed.value.learnedContext.learningProposalId).toBe(created.value.id);
    expect(confirmed.value.learnedContext.confirmedBy).toBe(asPrincipalId(ACTOR));
    expect(confirmed.value.learnedContext.content).toEqual(created.value.content);
  });

  it("rejects a proposal without writing learned context", () => {
    const created = createLearningProposal({ draft: baseDraft({ id: "learn-reject-1" }) });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const rejected = rejectLearningProposal(created.value, {
      decidedBy: ACTOR,
      at: "2026-06-04T13:00:00.000Z",
      reason: "not wanted",
      eventId: "evt-reject-1",
    });
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;
    expect(rejected.value.updated.status).toBe(LearningStatus.REJECTED);
    expect(rejected.value.event.type).toBe("REJECTED");
    expect("learnedContext" in rejected.value).toBe(false);
  });

  it("expires a past-due PROPOSED proposal", () => {
    const created = createLearningProposal({
      draft: baseDraft({
        id: "learn-expire-1",
        expiresAt: "2026-06-04T12:30:00.000Z",
      }),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const expired = expireLearningProposalIfPast(created.value, {
      eventId: "evt-expire-1",
      at: "2026-06-04T13:00:00.000Z",
    });
    expect(expired.ok).toBe(true);
    if (!expired.ok) return;
    expect(expired.value.updated?.status).toBe(LearningStatus.EXPIRED);
    expect(expired.value.event?.type).toBe("EXPIRED");
  });

  it("refuses confirm after expiry", () => {
    const created = createLearningProposal({
      draft: baseDraft({
        id: "learn-expire-confirm",
        expiresAt: "2026-06-04T12:30:00.000Z",
      }),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const confirmed = confirmLearningProposal(created.value, {
      decidedBy: ACTOR,
      at: "2026-06-04T13:00:00.000Z",
      eventId: "evt-confirm-expired",
    });
    expect(confirmed.ok).toBe(false);
    if (!confirmed.ok) expect(confirmed.code).toBe(ErrorCode.LEARNING_PROPOSAL_EXPIRED);
  });

  it("refuses double confirm", () => {
    const created = createLearningProposal({ draft: baseDraft({ id: "learn-double" }) });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const first = confirmLearningProposal(created.value, {
      decidedBy: ACTOR,
      at: "2026-06-04T13:00:00.000Z",
      eventId: "evt-1",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = confirmLearningProposal(first.value.updated, {
      decidedBy: ACTOR,
      at: "2026-06-04T13:05:00.000Z",
      eventId: "evt-2",
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe(ErrorCode.LEARNING_PROPOSAL_NOT_PENDING);
  });

  it("allows confirm with narrowing proposedScope (INV_015)", () => {
    const current = makeParentScope();
    const narrower = {
      ...current,
      maxAmount: Math.max(1, (current.maxAmount ?? 1000) - 100),
    };
    const created = createLearningProposal({
      draft: baseDraft({
        id: "learn-narrow",
        content: { currentScope: current, proposedScope: narrower },
      }),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const confirmed = confirmLearningProposal(created.value, {
      decidedBy: ACTOR,
      at: "2026-06-04T13:00:00.000Z",
      eventId: "evt-narrow",
    });
    expect(confirmed.ok).toBe(true);
  });
});

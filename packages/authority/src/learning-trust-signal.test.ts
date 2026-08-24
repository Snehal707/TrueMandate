import {
  ConstraintKind,
  ConstraintMutability,
  ConstraintOperator,
  ErrorCode,
  LearningStatus,
  MeaningClass,
  SourceType,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import {
  confirmLearningProposal,
  createLearningProposal,
} from "./learning.js";

const NOW = "2026-06-04T12:00:00.000Z";
const LATER = "2026-06-04T13:00:00.000Z";
const ACTOR = "owner@example.com";

const HARD_CONSTRAINT = {
  id: "c-hard-food",
  concept: "food_grade",
  operator: ConstraintOperator.REQUIRE,
  value: true,
  kind: ConstraintKind.HARD,
  importance: 1,
  confidence: 1,
  sourceType: SourceType.HUMAN,
  mutability: ConstraintMutability.IMMUTABLE,
  meaningClass: MeaningClass.EXPLICIT,
};

describe("LearningProposal confirm INV_026 trust-signal path", () => {
  it("confirms COUNTERPARTY_TRUST with a well-formed trustSignal", () => {
    const created = createLearningProposal({
      draft: {
        id: "learn-trust-ok",
        principalId: "principal-1",
        domain: "procurement",
        proposalType: "COUNTERPARTY_TRUST",
        content: {
          trustSignal: {
            subjectType: "COUNTERPARTY",
            subjectId: "supplier-a",
            domain: "procurement",
            value: 0.7,
            sampleSize: 5,
            basis: ["partial_fulfillment_rate"],
            computedAt: NOW,
          },
        },
        createdAt: NOW,
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const confirmed = confirmLearningProposal(created.value, {
      decidedBy: ACTOR,
      at: LATER,
      eventId: "evt-trust-ok",
    });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.value.updated.status).toBe(LearningStatus.CONFIRMED);
  });

  it("blocks confirm when trustSignal attempts HARD constraint override", () => {
    const created = createLearningProposal({
      draft: {
        id: "learn-trust-hard",
        principalId: "principal-1",
        domain: "procurement",
        proposalType: "COUNTERPARTY_TRUST",
        content: {
          trustSignal: {
            subjectType: "COUNTERPARTY",
            subjectId: "supplier-a",
            domain: "procurement",
            value: 0.99,
            sampleSize: 100,
            basis: ["reputation"],
            computedAt: NOW,
          },
          attemptedConstraintOverride: true,
          constraint: HARD_CONSTRAINT,
        },
        createdAt: NOW,
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const confirmed = confirmLearningProposal(created.value, {
      decidedBy: ACTOR,
      at: LATER,
      eventId: "evt-trust-hard",
    });
    expect(confirmed.ok).toBe(false);
    if (!confirmed.ok) {
      expect(confirmed.code).toBe(ErrorCode.REPUTATION_CANNOT_OVERRIDE_POLICY);
    }
  });

  it("blocks confirm when proposedDecision is more permissive than baseline", () => {
    const created = createLearningProposal({
      draft: {
        id: "learn-trust-decision",
        principalId: "principal-1",
        domain: "procurement",
        proposalType: "AGENT_RELIABILITY",
        content: {
          trustSignal: {
            subjectType: "AGENT",
            subjectId: "agent-1",
            domain: "procurement",
            value: 0.95,
            sampleSize: 20,
            basis: ["successful_outcome_rate"],
            computedAt: NOW,
          },
          baselineDecision: "REQUIRE_APPROVAL",
          proposedDecision: "ALLOW",
        },
        createdAt: NOW,
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const confirmed = confirmLearningProposal(created.value, {
      decidedBy: ACTOR,
      at: LATER,
      eventId: "evt-trust-decision",
    });
    expect(confirmed.ok).toBe(false);
    if (!confirmed.ok) {
      expect(confirmed.code).toBe(ErrorCode.REPUTATION_CANNOT_OVERRIDE_POLICY);
    }
  });

  it("rejects malformed trustSignal on confirm", () => {
    const created = createLearningProposal({
      draft: {
        id: "learn-trust-bad",
        principalId: "principal-1",
        domain: "procurement",
        proposalType: "AGENT_RELIABILITY",
        content: {
          trustSignal: {
            subjectType: "AGENT",
            subjectId: "agent-1",
            domain: "procurement",
            value: 2,
            sampleSize: 1,
            basis: [],
            computedAt: NOW,
          },
        },
        createdAt: NOW,
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const confirmed = confirmLearningProposal(created.value, {
      decidedBy: ACTOR,
      at: LATER,
      eventId: "evt-trust-bad",
    });
    expect(confirmed.ok).toBe(false);
  });
});

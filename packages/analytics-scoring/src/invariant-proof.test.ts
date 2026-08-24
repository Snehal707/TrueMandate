import {
  confirmLearningProposal,
  createLearningProposal,
  learningRequiresConfirmation,
} from "@truemandate/authority";
import {
  AuthorityDecision,
  ConstraintKind,
  ConstraintMutability,
  ConstraintOperator,
  ErrorCode,
  MeaningClass,
  SourceType,
  asConstraintId,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import {
  computeAgentReliabilityScore,
  createAgentReliabilityProposal,
} from "./agent-reliability.js";
import {
  computeCounterpartyTrustScore,
  createCounterpartyTrustProposal,
} from "./counterparty-trust.js";
import { NEUTRAL_SCORE } from "./thresholds.js";

const AT = "2026-08-21T12:00:00.000Z";

describe("Wave 3.7 scoring invariant proof", () => {
  it("generated drafts always require confirmation via learningRequiresConfirmation", () => {
    expect(
      learningRequiresConfirmation({ proposalType: "AGENT_RELIABILITY" }),
    ).toBe(true);
    expect(
      learningRequiresConfirmation({ proposalType: "COUNTERPARTY_TRUST" }),
    ).toBe(true);

    const agentSignal = computeAgentReliabilityScore(
      { agentKey: "a1", interventionCount: 0, workflowCount: 10 },
      AT,
    );
    const agentDraft = createAgentReliabilityProposal(agentSignal, {
      id: "lp-a1",
      principalId: "p1",
    });
    const created = createLearningProposal({ draft: agentDraft });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.requiresConfirmation).toBe(true);
    expect(created.value.status).toBe("PROPOSED");
  });

  it("INV_026: sticky constraint override attempt fails at confirm", () => {
    const signal = computeAgentReliabilityScore(
      { agentKey: "a1", interventionCount: 0, workflowCount: 10 },
      AT,
    );
    const draft = createAgentReliabilityProposal(signal, {
      id: "lp-override-constraint",
      principalId: "p1",
    });
    const created = createLearningProposal({
      draft: {
        ...draft,
        content: {
          trustSignal: signal,
          attemptedConstraintOverride: true,
          constraint: {
            id: asConstraintId("c-hard"),
            concept: "budget",
            operator: ConstraintOperator.LTE,
            value: 100,
            kind: ConstraintKind.HARD,
            importance: 1,
            confidence: 1,
            sourceType: SourceType.HUMAN,
            mutability: ConstraintMutability.IMMUTABLE,
            meaningClass: MeaningClass.EXPLICIT,
          },
        },
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const confirmed = confirmLearningProposal(created.value, {
      decidedBy: "human@example.com",
      at: AT,
      eventId: "ev-1",
    });
    expect(confirmed.ok).toBe(false);
    if (confirmed.ok) return;
    expect(confirmed.code).toBe(ErrorCode.REPUTATION_CANNOT_OVERRIDE_POLICY);
  });

  it("INV_026: permissive Authority decision override fails at confirm", () => {
    const signal = computeCounterpartyTrustScore(
      {
        merchant: "acme",
        totalOutcomes: 5,
        partialOrBreached: 0,
        failureRate: 0,
      },
      AT,
    );
    const draft = createCounterpartyTrustProposal(signal, {
      id: "lp-override-decision",
      principalId: "p1",
    });
    const created = createLearningProposal({
      draft: {
        ...draft,
        content: {
          trustSignal: signal,
          baselineDecision: AuthorityDecision.BLOCK,
          proposedDecision: AuthorityDecision.ALLOW,
        },
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const confirmed = confirmLearningProposal(created.value, {
      decidedBy: "human@example.com",
      at: AT,
      eventId: "ev-2",
    });
    expect(confirmed.ok).toBe(false);
    if (confirmed.ok) return;
    expect(confirmed.code).toBe(ErrorCode.REPUTATION_CANNOT_OVERRIDE_POLICY);
  });

  it("insufficient evidence produces neutral 0.5, not fabricated confidence", () => {
    const agent = computeAgentReliabilityScore(
      { agentKey: "new", interventionCount: 0, workflowCount: 1 },
      AT,
    );
    expect(agent.value).toBe(NEUTRAL_SCORE);

    const cp = computeCounterpartyTrustScore(
      {
        merchant: "new",
        totalOutcomes: 1,
        partialOrBreached: 0,
        failureRate: 0,
      },
      AT,
    );
    expect(cp.value).toBe(NEUTRAL_SCORE);
  });

  it("clean confirm of scoring proposal writes LearnedContextRecord without privilege", () => {
    const signal = computeAgentReliabilityScore(
      { agentKey: "a-ok", interventionCount: 1, workflowCount: 10 },
      AT,
    );
    const draft = createAgentReliabilityProposal(signal, {
      id: "lp-clean",
      principalId: "p1",
    });
    const created = createLearningProposal({ draft });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const confirmed = confirmLearningProposal(created.value, {
      decidedBy: "human@example.com",
      at: AT,
      eventId: "ev-clean",
    });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.value.updated.status).toBe("CONFIRMED");
    expect(confirmed.value.learnedContext.proposalType).toBe(
      "AGENT_RELIABILITY",
    );
    expect(confirmed.value.learnedContext.content.trustSignal).toEqual(signal);
  });
});

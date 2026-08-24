import {
  AuthorityDecision,
  ConstraintKind,
  PreferenceOrigin,
  PreferenceRecordStatus,
  WorkflowRuleStatus,
  asHashDigest,
  asLearningProposalId,
  asPreferenceRecordId,
  asPrincipalId,
  asWorkflowRuleId,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import {
  assertAdaptiveAuthorityDominance,
  composeAdaptiveAuthorityDecision,
  type AdaptiveTrustInput,
} from "./adaptive-authority.js";
import { makeConstraint, makeIntent, makeIntentState, makeParentScope, NOW } from "./fixtures.js";

function makeTrust(
  kind: "AGENT_RELIABILITY" | "COUNTERPARTY_TRUST",
  subjectType: "AGENT" | "COUNTERPARTY",
  subjectId: string,
  value: number,
): AdaptiveTrustInput {
  return {
    learnedContext: {
      id: `ctx-${subjectType}-${subjectId}` as never,
      learningProposalId: asLearningProposalId(`lp-${subjectType}-${subjectId}`),
      principalId: asPrincipalId("principal-1"),
      domain: "procurement",
      proposalType: kind,
      content: {
        trustSignal: {
          subjectType,
          subjectId,
          domain: "procurement",
          value,
          sampleSize: 10,
          basis: ["observed"],
          computedAt: NOW,
        },
      },
      confirmedAt: NOW,
      confirmedBy: asPrincipalId("principal-1"),
      contentHash: asHashDigest("a".repeat(64)),
    },
    trustSignal: {
      subjectType,
      subjectId,
      domain: "procurement",
      value,
      sampleSize: 10,
      basis: ["observed"],
      computedAt: NOW,
    },
  };
}

function makePreference(concept: string, value: unknown) {
  return {
    id: asPreferenceRecordId(`pref-${concept}`),
    subjectId: "principal:owner@example.com",
    domain: "procurement",
    concept,
    value,
    origin: PreferenceOrigin.EXPLICIT_USER_INPUT,
    status: PreferenceRecordStatus.ACTIVE,
    sourceLearningProposalId: asLearningProposalId(`lp-pref-${concept}`),
    createdAt: NOW,
    confirmedAt: NOW,
    confirmedBy: asPrincipalId("owner@example.com"),
    contentHash: asHashDigest("b".repeat(64)),
  };
}

function makeWorkflowRule(concept: string, action: unknown) {
  return {
    id: asWorkflowRuleId(`rule-${concept}`),
    subjectId: "principal:owner@example.com",
    domain: "procurement",
    concept,
    action,
    version: 1,
    status: WorkflowRuleStatus.ACTIVE,
    evidenceRefs: ["e1", "e2", "e3"],
    basis: ["b1", "b2", "b3"],
    sourceLearningProposalId: asLearningProposalId(`lp-rule-${concept}`),
    createdAt: NOW,
    confirmedAt: NOW,
    confirmedBy: asPrincipalId("owner@example.com"),
    contentHash: asHashDigest("c".repeat(64)),
  };
}

function baseState() {
  const intent = makeIntent();
  return makeIntentState(intent, []);
}

describe("assertAdaptiveAuthorityDominance", () => {
  it("allows equal or stricter final decisions", () => {
    expect(
      assertAdaptiveAuthorityDominance({
        baselineDecision: AuthorityDecision.ALLOW,
        finalDecision: AuthorityDecision.ALLOW_WITH_MONITORING,
        currentScope: makeParentScope(),
      }).ok,
    ).toBe(true);
    expect(
      assertAdaptiveAuthorityDominance({
        baselineDecision: AuthorityDecision.ALLOW_WITH_MONITORING,
        finalDecision: AuthorityDecision.REQUIRE_APPROVAL,
        currentScope: makeParentScope(),
      }).ok,
    ).toBe(true);
  });

  it("blocks any more permissive final decision", () => {
    const result = assertAdaptiveAuthorityDominance({
      baselineDecision: AuthorityDecision.REQUIRE_APPROVAL,
      finalDecision: AuthorityDecision.ALLOW,
      currentScope: makeParentScope(),
    });
    expect(result.ok).toBe(false);
  });
});

describe("composeAdaptiveAuthorityDecision", () => {
  it("keeps BLOCK unchanged despite positive signals", () => {
    const result = composeAdaptiveAuthorityDecision({
      baselineDecision: AuthorityDecision.BLOCK,
      currentIntentState: baseState(),
      currentScope: makeParentScope(),
      action: { refundable: true, deliveryTerms: "standard" },
      agentTrust: makeTrust("AGENT_RELIABILITY", "AGENT", "agent-1", 0.95),
      counterpartyTrust: makeTrust("COUNTERPARTY_TRUST", "COUNTERPARTY", "supplier-a", 0.95),
      preferences: [makePreference("refundable", true)],
      workflowRules: [makeWorkflowRule("delivery_terms", { value: "standard" })],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision).toBe(AuthorityDecision.BLOCK);
  });

  it("tightens ALLOW to ALLOW_WITH_MONITORING on weak counterparty trust", () => {
    const result = composeAdaptiveAuthorityDecision({
      baselineDecision: AuthorityDecision.ALLOW,
      currentIntentState: baseState(),
      currentScope: makeParentScope(),
      action: { deliveryTerms: "standard" },
      counterpartyTrust: makeTrust("COUNTERPARTY_TRUST", "COUNTERPARTY", "supplier-a", 0.2),
      preferences: [],
      workflowRules: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision).toBe(AuthorityDecision.ALLOW_WITH_MONITORING);
  });

  it("tightens ALLOW to REQUIRE_APPROVAL on weak agent and counterparty trust together", () => {
    const result = composeAdaptiveAuthorityDecision({
      baselineDecision: AuthorityDecision.ALLOW,
      currentIntentState: baseState(),
      currentScope: makeParentScope(),
      action: { deliveryTerms: "standard" },
      agentTrust: makeTrust("AGENT_RELIABILITY", "AGENT", "agent-1", 0.3),
      counterpartyTrust: makeTrust("COUNTERPARTY_TRUST", "COUNTERPARTY", "supplier-a", 0.2),
      preferences: [],
      workflowRules: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision).toBe(AuthorityDecision.REQUIRE_APPROVAL);
  });

  it("tightens ALLOW to ALLOW_WITH_MONITORING on preference mismatch for refundable", () => {
    const result = composeAdaptiveAuthorityDecision({
      baselineDecision: AuthorityDecision.ALLOW,
      currentIntentState: baseState(),
      currentScope: makeParentScope(),
      action: { refundable: true },
      preferences: [makePreference("refundable", false)],
      workflowRules: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision).toBe(AuthorityDecision.ALLOW_WITH_MONITORING);
  });

  it("tightens ALLOW to REQUIRE_APPROVAL on workflow-rule mismatch for delivery_terms", () => {
    const result = composeAdaptiveAuthorityDecision({
      baselineDecision: AuthorityDecision.ALLOW,
      currentIntentState: baseState(),
      currentScope: makeParentScope(),
      action: { deliveryTerms: "standard" },
      preferences: [],
      workflowRules: [makeWorkflowRule("delivery_terms", { value: "overnight" })],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision).toBe(AuthorityDecision.REQUIRE_APPROVAL);
  });

  it("tightens ALLOW_WITH_MONITORING to REQUIRE_APPROVAL on additional weak trust", () => {
    const result = composeAdaptiveAuthorityDecision({
      baselineDecision: AuthorityDecision.ALLOW_WITH_MONITORING,
      currentIntentState: baseState(),
      currentScope: makeParentScope(),
      action: { deliveryTerms: "standard" },
      counterpartyTrust: makeTrust("COUNTERPARTY_TRUST", "COUNTERPARTY", "supplier-a", 0.2),
      preferences: [],
      workflowRules: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision).toBe(AuthorityDecision.REQUIRE_APPROVAL);
  });

  it("ignores preferences and rules when explicit current intent already specifies the concept", () => {
    const state = makeIntentState(makeIntent(), [
      makeConstraint({
        id: "c-refund",
        concept: "refundable",
        kind: ConstraintKind.PREFERENCE,
      }),
    ]);
    const result = composeAdaptiveAuthorityDecision({
      baselineDecision: AuthorityDecision.ALLOW,
      currentIntentState: state,
      currentScope: makeParentScope(),
      action: { refundable: true },
      preferences: [makePreference("refundable", false)],
      workflowRules: [makeWorkflowRule("refundable", { value: false })],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision).toBe(AuthorityDecision.ALLOW);
  });

  it("never relaxes REQUIRE_APPROVAL even with perfect trust and matching soft signals", () => {
    const result = composeAdaptiveAuthorityDecision({
      baselineDecision: AuthorityDecision.REQUIRE_APPROVAL,
      currentIntentState: baseState(),
      currentScope: makeParentScope(),
      action: { refundable: true, deliveryTerms: "standard" },
      agentTrust: makeTrust("AGENT_RELIABILITY", "AGENT", "agent-1", 0.99),
      counterpartyTrust: makeTrust("COUNTERPARTY_TRUST", "COUNTERPARTY", "supplier-a", 0.99),
      preferences: [makePreference("refundable", true)],
      workflowRules: [makeWorkflowRule("delivery_terms", { value: "standard" })],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision).toBe(AuthorityDecision.REQUIRE_APPROVAL);
  });
});

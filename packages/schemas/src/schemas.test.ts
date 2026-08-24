import { describe, expect, it } from "vitest";
import { parseProtocolObject, ProtocolSchemas } from "./index.js";

describe("protocol envelope schemas", () => {
  it("rejects unknown keys on Intent", () => {
    const result = parseProtocolObject("Intent", {
      id: "i1",
      principalId: "p1",
      rawText: "Buy 500 food-grade containers",
      createdAt: "2026-01-01T00:00:00.000Z",
      contentHash: "abc",
      extra: true,
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a valid CapabilityScope", () => {
    const result = parseProtocolObject("CapabilityScope", {
      capabilities: {
        search: "ALLOW",
        execute_payment: "REQUIRE_APPROVAL",
      },
      maxAmount: 800000,
      currency: "INR",
    });
    expect(result.ok).toBe(true);
  });

  it("registers every protocol object schema", () => {
    const expected = [
      "Intent",
      "Constraint",
      "IntentState",
      "DelegationEnvelope",
      "CapabilityScope",
      "ProvenanceNode",
      "ProvenanceEdge",
      "Assumption",
      "EvidenceEnvelope",
      "EvidenceClaim",
      "ActionProposal",
      "ConstraintClaim",
      "GuardianVerdict",
      "DriftEvent",
      "AuthorityRequest",
      "AuthorityGrant",
      "AuthorityExtensionRequest",
      "PreparedAction",
      "PreparedActionRecord",
      "CommitToken",
      "ApprovalArtifact",
      "ApprovalEvent",
      "ApprovalRequest",
      "ToolDescriptor",
      "SideEffectRecord",
      "OutcomeContract",
      "OutcomeRequirement",
      "OutcomeEvent",
      "OutcomeStateTransition",
      "OutcomeRiskSignal",
      "OutcomeVerification",
      "ResolutionCase",
      "CausalTimelineEvent",
      "ResponsibilityHypothesis",
      "EvidenceRequest",
      "RemedyProposal",
      "RemediationMandate",
      "ResolutionEvent",
      "LearningProposal",
      "LearningProposalEvent",
      "LearnedContextRecord",
      "PreferenceRecord",
      "WorkflowRule",
      "TrustSignal",
      "MonitoringContract",
      "MonitoringRiskSignal",
      "PlanGraph",
      "PlanStep",
      "CandidateInterpretation",
      "SemanticVerificationResult",
      "PlanVerificationResult",
      "ModelCallTelemetryEvent",
      "WorkflowStageEvent",
    ];
    expect(Object.keys(ProtocolSchemas).sort()).toEqual(expected.sort());
  });
});

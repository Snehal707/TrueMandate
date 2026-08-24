import { hashCanonical } from "@truemandate/crypto";
import {
  AmbiguityClass,
  CommitmentLevel,
  ErrorCode,
  IntentReadiness,
  SemanticLifecycle,
  type Intent,
  type IntentState,
  type PlanGraph,
  type SemanticVerificationResult,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { deterministicPlanFindings } from "./deterministic.js";

const intent = {
  id: "intent-1",
  principalId: "principal-1",
  rawText: "Book approved travel",
  createdAt: "2026-08-22T12:00:00.000Z",
  contentHash: "a".repeat(64),
} as Intent;

const state = {
  id: "state-2",
  intentId: intent.id,
  rawIntentHash: intent.contentHash,
  version: 2,
  constraints: [],
  assumptions: [],
  createdAt: "2026-08-22T12:05:00.000Z",
  createdBy: "principal-1",
  previousStateId: "state-1",
  stateHash: "b".repeat(64),
} as IntentState;

function verification(
  ambiguityClass: SemanticVerificationResult["ambiguityClass"],
): SemanticVerificationResult {
  return {
    id: `verification-${ambiguityClass}`,
    intentId: intent.id,
    candidateId: "candidate-1",
    candidateHash: "c".repeat(64) as never,
    lifecycle:
      ambiguityClass === AmbiguityClass.A0
        ? SemanticLifecycle.VERIFIED
        : SemanticLifecycle.AMBIGUOUS,
    findings: [],
    transformations: [],
    criticalFailure: false,
    readiness: IntentReadiness.ACTIONABLE,
    ambiguityClass,
    modelMeta: {
      modelId: "test",
      promptVersion: "test",
      schemaId: "test",
      schemaVersion: "1",
      protocolVersion: "0.1.0",
      requestId: "request-1",
      timestamp: "2026-08-22T12:05:00.000Z",
    },
    verifiedAt: "2026-08-22T12:05:00.000Z",
  };
}

function plan(boundVerification: SemanticVerificationResult): PlanGraph {
  return {
    id: "plan-1" as never,
    intentId: intent.id,
    intentStateId: state.id,
    semanticVerificationId: boundVerification.id,
    semanticVerificationHash: hashCanonical(boundVerification),
    readinessAtPlan: boundVerification.readiness,
    ambiguityClassAtPlan: boundVerification.ambiguityClass,
    status: "UNDER_VERIFICATION",
    version: 1,
    planHash: "d".repeat(64) as never,
    plannerMeta: boundVerification.modelMeta,
    createdAt: "2026-08-22T12:05:00.000Z",
    steps: [
      {
        id: "step-book" as never,
        objective: "Book verified travel",
        assignedAgent: "agent-1" as never,
        requiredConstraintIds: [],
        requestedCapabilities: ["book_travel"],
        requiredFutureCapabilities: [],
        inputs: [],
        expectedOutput: "booking",
        assumptionIds: [],
        consequenceLevel: "HIGH",
        commitmentLevel: CommitmentLevel.ECONOMIC,
        privileged: true,
        dependsOn: [],
        applicableConstraintIds: [],
        inheritedConstraintIds: [],
        irrelevantConstraintIds: [],
      },
    ],
    coverage: [],
    proofObligations: [],
    operationalizations: [],
    assumptionIds: [],
    invalidationDeps: { stepIds: [], proofConstraintIds: [], relatedPlanIds: [] },
  };
}

describe("deterministic plan semantic binding", () => {
  it("rejects high-consequence commitment with genuinely unresolved A2 ambiguity", () => {
    const current = verification(AmbiguityClass.A2);
    const findings = deterministicPlanFindings(intent, state, plan(current), current);
    expect(findings.some((finding) => finding.code === ErrorCode.INAPPROPRIATE_COMMITMENT)).toBe(true);
  });

  it("does not falsely reject a fully resolved semantic state", () => {
    const current = verification(AmbiguityClass.A0);
    const findings = deterministicPlanFindings(intent, state, plan(current), current);
    expect(findings.some((finding) => finding.code === ErrorCode.INAPPROPRIATE_COMMITMENT)).toBe(false);
    expect(findings.some((finding) => finding.code === ErrorCode.PLAN_STALE)).toBe(false);
  });

  it("rejects a plan snapshot bound to stale ambiguity", () => {
    const stale = verification(AmbiguityClass.A2);
    const current = verification(AmbiguityClass.A0);
    const findings = deterministicPlanFindings(intent, state, plan(stale), current);
    expect(findings.some((finding) => finding.code === ErrorCode.PLAN_STALE)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  deriveComparisonIntegrity,
  unavailableComparisonIntegrity,
} from "./comparison-integrity.js";

function workspaceFixture(input: {
  readonly intentStateId: string;
  readonly stateHash: string;
  readonly readiness: string;
  readonly historicalStateIds: readonly string[];
  readonly blockingStage?: string;
  readonly evidenceDetail?: string;
  readonly planVerificationDetail?: string;
  readonly guardianDecision?: string;
  readonly guardianCriticalFailure?: boolean;
  readonly authorityDecision?: string;
  readonly sideEffectCount?: number;
  readonly preparedActionPresent?: boolean;
}): Record<string, unknown> {
  return {
    summary: {
      intentId: "intent-1",
      rawIntent: "same",
      principalId: "demo",
      createdAt: "2026-08-30T00:00:00.000Z",
      intentStateId: input.intentStateId,
      stateHash: input.stateHash,
      readiness: input.readiness,
      historicalStateIds: input.historicalStateIds,
    },
    guardian: {
      aggregator: {
        decision: input.guardianDecision ?? "ALLOW",
        semanticStatus: "CLEAR",
        criticalFailure: input.guardianCriticalFailure ?? false,
      },
    },
    authority: {
      decision: input.authorityDecision,
      explanation: "test",
    },
    execution: {
      phase: input.preparedActionPresent ? "PREPARE" : "BLOCKED",
      preparedAction: input.preparedActionPresent ? { id: "prep-1" } : undefined,
      sideEffects: Array.from({ length: input.sideEffectCount ?? 0 }, (_, index) => ({ id: `se-${index}` })),
      unknownPending: false,
      blockedRetry: false,
    },
    lifecycle: {
      stages: [
        { stage: "evidence", status: "COMPLETED", detail: input.evidenceDetail ?? "4 of 4 required proofs satisfied" },
        { stage: "planVerification", status: "COMPLETED", detail: input.planVerificationDetail ?? "VERIFIED" },
        { stage: "authority", status: "COMPLETED", detail: input.authorityDecision ?? "AUTHORIZED" },
      ],
      blockingStage: input.blockingStage,
    },
  };
}

function workflowFixture(input?: {
  readonly workflowId?: string;
  readonly state?: string;
  readonly decision?: string;
  readonly executionStatus?: string;
  readonly approval?: Record<string, unknown>;
  readonly commitTokenPresent?: boolean;
}): Record<string, unknown> {
  return {
    workflowId: input?.workflowId ?? "wf-1",
    state: input?.state ?? "AUTHORIZED",
    ...(input?.decision ? { evaluation: { decision: input.decision } } : {}),
    ...(input?.executionStatus ? { execution: { status: input.executionStatus } } : {}),
    ...(input?.approval ? { approval: input.approval } : {}),
    ...(input?.commitTokenPresent ? { artifacts: { commitToken: { id: "token-1" } } } : {}),
  };
}

function baseInput(overrides?: Partial<Parameters<typeof deriveComparisonIntegrity>[0]>) {
  return {
    intentId: "intent-1",
    compiledIntentStateId: "state-0",
    compiledIntentStateHash: "hash-0",
    boundIntentStateId: "state-1",
    boundIntentStateHash: "hash-1",
    controlWorkflow: workflowFixture({ workflowId: "wf-control", state: "AUTHORIZED", decision: "ALLOW" }),
    attackWorkflow: workflowFixture({ workflowId: "wf-attack", state: "BLOCKED" }),
    controlWorkspace: workspaceFixture({
      intentStateId: "state-1",
      stateHash: "hash-1",
      readiness: "ACTIONABLE",
      historicalStateIds: ["state-0"],
      authorityDecision: "ALLOW",
    }),
    attackWorkspace: workspaceFixture({
      intentStateId: "state-1",
      stateHash: "hash-1",
      readiness: "ACTIONABLE",
      historicalStateIds: ["state-0"],
      blockingStage: "planVerification",
    }),
    controlApproval: undefined,
    controlVerifiedEvidenceIds: ["evidence-1"],
    attackVerifiedEvidenceIds: ["evidence-1"],
    controlVerifiedClaimIds: ["claim-1"],
    attackVerifiedClaimIds: ["claim-1"],
    nowMs: Date.parse("2026-08-30T00:00:00.000Z"),
    ...overrides,
  };
}

describe("deriveComparisonIntegrity", () => {
  it("CASE A: shared compiled S0 stays sameIntentState=true but sameVerifiedS1=false", () => {
    const result = deriveComparisonIntegrity(baseInput({
      compiledIntentStateId: "state-0",
      compiledIntentStateHash: "hash-0",
      boundIntentStateId: "state-0",
      boundIntentStateHash: "hash-0",
      controlWorkspace: workspaceFixture({
        intentStateId: "state-0",
        stateHash: "hash-0",
        readiness: "PLANNABLE",
        historicalStateIds: [],
        authorityDecision: "ALLOW",
      }),
      attackWorkspace: workspaceFixture({
        intentStateId: "state-0",
        stateHash: "hash-0",
        readiness: "PLANNABLE",
        historicalStateIds: [],
        blockingStage: "planVerification",
      }),
    }));
    expect(result.sameIntentState).toBe(true);
    expect(result.sameVerifiedS1).toBe(false);
    expect(result.status).toBe("INCOMPLETE_COMPARISON");
  });

  it("CASE B: real verified S1 shared across control and attack passes", () => {
    const result = deriveComparisonIntegrity(baseInput());
    expect(result.sameVerifiedS1).toBe(true);
    expect(result.status).toBe("VERIFIED_COMPARISON");
  });

  it("CASE C: same state id but different hash breaks sameIntentState", () => {
    const result = deriveComparisonIntegrity(baseInput({
      attackWorkspace: workspaceFixture({
        intentStateId: "state-1",
        stateHash: "hash-2",
        readiness: "ACTIONABLE",
        historicalStateIds: ["state-0"],
        blockingStage: "planVerification",
      }),
    }));
    expect(result.sameIntentState).toBe(false);
    expect(result.sameVerifiedS1).toBe(false);
  });

  it("CASE D: same state/hash with incomplete proof coverage does not qualify as sameVerifiedS1", () => {
    const result = deriveComparisonIntegrity(baseInput({
      controlWorkspace: workspaceFixture({
        intentStateId: "state-1",
        stateHash: "hash-1",
        readiness: "ACTIONABLE",
        historicalStateIds: ["state-0"],
        authorityDecision: "ALLOW",
        evidenceDetail: "3 of 4 required proofs satisfied",
      }),
    }));
    expect(result.sameVerifiedS1).toBe(false);
    expect(result.proofCoverageComplete).toBe(false);
  });

  it("CASE E: same state/hash and proof complete but readiness PLANNABLE does not qualify as sameVerifiedS1", () => {
    const result = deriveComparisonIntegrity(baseInput({
      controlWorkspace: workspaceFixture({
        intentStateId: "state-1",
        stateHash: "hash-1",
        readiness: "PLANNABLE",
        historicalStateIds: ["state-0"],
        authorityDecision: "ALLOW",
      }),
    }));
    expect(result.sameVerifiedS1).toBe(false);
    expect(result.privilegedReadiness).toBe("PLANNABLE");
  });

  it("CASE F: differing verified evidence sets fail the comparison", () => {
    const result = deriveComparisonIntegrity(baseInput({
      attackVerifiedEvidenceIds: ["evidence-2"],
    }));
    expect(result.sameVerifiedEvidence).toBe(false);
    expect(result.status).toBe("INCOMPLETE_COMPARISON");
  });

  it("CASE G: differing verified claim sets fail the comparison", () => {
    const result = deriveComparisonIntegrity(baseInput({
      attackVerifiedClaimIds: ["claim-2"],
    }));
    expect(result.sameVerifiedClaims).toBe(false);
    expect(result.status).toBe("INCOMPLETE_COMPARISON");
  });

  it("fails closed when authoritative workspace reads are unavailable", () => {
    expect(unavailableComparisonIntegrity("BACKEND_COMPARISON_UNAVAILABLE")).toMatchObject({
      available: false,
      status: "INCOMPLETE_COMPARISON",
      reasons: ["BACKEND_COMPARISON_UNAVAILABLE"],
    });
  });
});

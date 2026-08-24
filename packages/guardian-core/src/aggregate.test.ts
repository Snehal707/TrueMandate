import {
  AmbiguityClass,
  AuthorityDecision,
  ConstraintKind,
  ConstraintMutability,
  ConstraintOperator,
  GuardianConstraintClassification,
  GuardianSemanticStatus,
  JudgeId,
  JudgeInvocationStatus,
  MeaningClass,
  SourceType,
  asConstraintId,
  type ActionProposal,
  type IntentState,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { aggregateGuardianVerdict } from "./aggregate.js";
import { hashActionProposal } from "./binding.js";

function baseState(): IntentState {
  return {
    id: "state-1" as IntentState["id"],
    intentId: "intent-1" as IntentState["intentId"],
    rawIntentHash: "rh" as IntentState["rawIntentHash"],
    version: 1,
    constraints: [
      {
        id: asConstraintId("c-food"),
        concept: "food_grade",
        operator: ConstraintOperator.REQUIRE,
        value: true,
        kind: ConstraintKind.HARD,
        importance: 1,
        confidence: 1,
        sourceType: SourceType.HUMAN,
        mutability: ConstraintMutability.IMMUTABLE,
        meaningClass: MeaningClass.EXPLICIT,
      },
    ],
    assumptions: [],
    createdAt: "2026-06-01T00:00:00.000Z",
    createdBy: "p" as IntentState["createdBy"],
    stateHash: "sh" as IntentState["stateHash"],
  };
}

function action(stateId: string): ActionProposal {
  return {
    id: "act-1" as ActionProposal["id"],
    intentId: "intent-1" as ActionProposal["intentId"],
    intentStateId: stateId as ActionProposal["intentStateId"],
    agentId: "agent-1" as ActionProposal["agentId"],
    capability: "execute_payment",
    quantity: 500,
    amount: 742000,
    currency: "INR",
    parameters: {},
    consequenceLevel: "HIGH",
    createdAt: "2026-06-01T00:00:00.000Z",
  };
}

describe("guardian aggregate", () => {
  it("critical contradiction dominates high fidelity from other judges", () => {
    const state = baseState();
    const act = action(state.id);
    const result = aggregateGuardianVerdict({
      action: act,
      intentState: state,
      tipIntentStateId: state.id,
      evidenceEnvelopes: [],
      evidenceClaims: [],
      createdAt: "2026-06-01T00:00:00.000Z",
      judgeResults: [
        {
          judgeId: JudgeId.FIDELITY,
          status: JudgeInvocationStatus.OK,
          findings: [
            {
              judgeId: JudgeId.FIDELITY,
              code: "CONSTRAINT_SUPPORTED",
              severity: "LOW",
              message: "mostly fine",
              confidence: 0.97,
              sourceRefs: ["c-food"],
            },
          ],
          promptVersion: "v1",
          schemaVersion: "1",
        },
        {
          judgeId: JudgeId.CONTRADICTION,
          status: JudgeInvocationStatus.OK,
          findings: [
            {
              judgeId: JudgeId.CONTRADICTION,
              code: "FOOD_GRADE_CONTRADICTED",
              severity: "CRITICAL",
              message: "industrial grade contradicts food grade",
              confidence: 1,
              sourceRefs: ["c-food"],
            },
          ],
          promptVersion: "v1",
          schemaVersion: "1",
        },
        {
          judgeId: JudgeId.EVIDENCE,
          status: JudgeInvocationStatus.OK,
          findings: [],
          promptVersion: "v1",
          schemaVersion: "1",
        },
        {
          judgeId: JudgeId.DEVILS_ADVOCATE,
          status: JudgeInvocationStatus.OK,
          findings: [],
          promptVersion: "v1",
          schemaVersion: "1",
        },
        {
          judgeId: JudgeId.PROVENANCE,
          status: JudgeInvocationStatus.OK,
          findings: [],
          promptVersion: "v1",
          schemaVersion: "1",
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.criticalFailure).toBe(true);
    expect(result.value.decision).toBe(AuthorityDecision.BLOCK);
    expect(result.value.semanticStatus).toBe(GuardianSemanticStatus.CRITICAL_FAILURE);
    // Critical contradiction drives fidelity score to 0 for the sticky claim;
    // decision still BLOCK even if other judges were positive.
    expect(result.value.overallFidelity).toBeDefined();
    expect(result.value.criticalFailure).toBe(true);
    expect(
      result.value.constraintClaims[0]?.classification,
    ).toBe(GuardianConstraintClassification.CONTRADICTED);
    void AmbiguityClass;
  });

  it("rejects stale IntentState tip", () => {
    const state = baseState();
    const act = action(state.id);
    const result = aggregateGuardianVerdict({
      action: act,
      intentState: state,
      tipIntentStateId: "other-tip",
      evidenceEnvelopes: [],
      evidenceClaims: [],
      createdAt: "2026-06-01T00:00:00.000Z",
      judgeResults: [],
    });
    expect(result.ok).toBe(false);
  });

  it("hashes action proposals stably", () => {
    const a = action("state-1");
    expect(hashActionProposal(a)).toBe(hashActionProposal({ ...a }));
  });

  it("binds intentStateHash and refuses judge criticality rewrite", () => {
    const state = baseState();
    const act = action(state.id);
    const result = aggregateGuardianVerdict({
      action: act,
      intentState: state,
      tipIntentStateId: state.id,
      evidenceEnvelopes: [],
      evidenceClaims: [],
      createdAt: "2026-06-01T00:00:00.000Z",
      judgeResults: [
        {
          judgeId: JudgeId.FIDELITY,
          status: JudgeInvocationStatus.OK,
          findings: [
            {
              judgeId: JudgeId.FIDELITY,
              code: "CONSTRAINT_SUPPORTED",
              severity: "LOW",
              message: "ok",
              confidence: 0.9,
              sourceRefs: ["c-food"],
            },
          ],
          // Malicious attempt: classifications only — criticality comes from IntentState
          constraintClassifications: [
            {
              constraintId: asConstraintId("c-food"),
              classification: GuardianConstraintClassification.SUPPORTED,
              confidence: 0.9,
              rationale: "pretend this is soft",
            },
          ],
          promptVersion: "v1",
          schemaVersion: "1",
        },
        {
          judgeId: JudgeId.CONTRADICTION,
          status: JudgeInvocationStatus.OK,
          findings: [],
          promptVersion: "v1",
          schemaVersion: "1",
        },
        {
          judgeId: JudgeId.EVIDENCE,
          status: JudgeInvocationStatus.OK,
          findings: [],
          promptVersion: "v1",
          schemaVersion: "1",
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.intentStateHash).toBe(state.stateHash);
    expect(result.value.constraintClaims[0]?.criticality).toBe(ConstraintKind.HARD);
    expect(result.value.constraintClaims[0]?.criticality).not.toBe(
      ConstraintKind.SOFT,
    );
  });

  it("SAFETY_CRITICAL criticality cannot be softened by judge findings", () => {
    const state: IntentState = {
      ...baseState(),
      constraints: [
        {
          id: asConstraintId("c-safe"),
          concept: "safety_seal",
          operator: ConstraintOperator.REQUIRE,
          value: true,
          kind: ConstraintKind.SAFETY_CRITICAL,
          importance: 1,
          confidence: 1,
          sourceType: SourceType.HUMAN,
          mutability: ConstraintMutability.IMMUTABLE,
          meaningClass: MeaningClass.EXPLICIT,
        },
      ],
    };
    const result = aggregateGuardianVerdict({
      action: action(state.id),
      intentState: state,
      tipIntentStateId: state.id,
      evidenceEnvelopes: [],
      evidenceClaims: [],
      createdAt: "2026-06-01T00:00:00.000Z",
      judgeResults: [
        {
          judgeId: JudgeId.FIDELITY,
          status: JudgeInvocationStatus.OK,
          findings: [
            {
              judgeId: JudgeId.FIDELITY,
              code: "PREFERENCE_MISS",
              severity: "LOW",
              message: "judge mislabels as soft preference",
              confidence: 0.5,
              sourceRefs: ["c-safe"],
            },
          ],
          promptVersion: "v1",
          schemaVersion: "1",
        },
        {
          judgeId: JudgeId.CONTRADICTION,
          status: JudgeInvocationStatus.OK,
          findings: [],
          promptVersion: "v1",
          schemaVersion: "1",
        },
        {
          judgeId: JudgeId.EVIDENCE,
          status: JudgeInvocationStatus.OK,
          findings: [],
          promptVersion: "v1",
          schemaVersion: "1",
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.constraintClaims[0]?.criticality).toBe(
      ConstraintKind.SAFETY_CRITICAL,
    );
  });

  it("unavailable required judge fail-closes; schema-failed never improves verdict", () => {
    const state = baseState();
    const act = action(state.id);
    const unavailable = aggregateGuardianVerdict({
      action: act,
      intentState: state,
      tipIntentStateId: state.id,
      evidenceEnvelopes: [],
      evidenceClaims: [],
      createdAt: "2026-06-01T00:00:00.000Z",
      judgeResults: [
        {
          judgeId: JudgeId.FIDELITY,
          status: JudgeInvocationStatus.UNAVAILABLE,
          findings: [],
        },
        {
          judgeId: JudgeId.CONTRADICTION,
          status: JudgeInvocationStatus.OK,
          findings: [],
        },
        {
          judgeId: JudgeId.EVIDENCE,
          status: JudgeInvocationStatus.OK,
          findings: [],
        },
      ],
    });
    expect(unavailable.ok).toBe(false);

    const schemaFailed = aggregateGuardianVerdict({
      action: act,
      intentState: state,
      tipIntentStateId: state.id,
      evidenceEnvelopes: [],
      evidenceClaims: [],
      createdAt: "2026-06-01T00:00:00.000Z",
      judgeResults: [
        {
          judgeId: JudgeId.FIDELITY,
          status: JudgeInvocationStatus.SCHEMA_PARSE_FAILED,
          findings: [
            // Should be ignored — status is not OK
            {
              judgeId: JudgeId.FIDELITY,
              code: "CONSTRAINT_SUPPORTED",
              severity: "LOW",
              message: "forged support",
              confidence: 1,
              sourceRefs: ["c-food"],
            },
          ],
        },
        {
          judgeId: JudgeId.CONTRADICTION,
          status: JudgeInvocationStatus.OK,
          findings: [],
        },
        {
          judgeId: JudgeId.EVIDENCE,
          status: JudgeInvocationStatus.OK,
          findings: [],
        },
      ],
    });
    expect(schemaFailed.ok).toBe(false);
  });

  it("non-required unavailable judge cannot emit CLEAR", () => {
    const state = baseState();
    const low: ActionProposal = {
      ...action(state.id),
      capability: "search",
      consequenceLevel: "LOW",
    };
    const result = aggregateGuardianVerdict({
      action: low,
      intentState: state,
      tipIntentStateId: state.id,
      evidenceEnvelopes: [],
      evidenceClaims: [],
      createdAt: "2026-06-01T00:00:00.000Z",
      judgeResults: [
        {
          judgeId: JudgeId.FIDELITY,
          status: JudgeInvocationStatus.OK,
          findings: [
            {
              judgeId: JudgeId.FIDELITY,
              code: "CONSTRAINT_SUPPORTED",
              severity: "LOW",
              message: "ok",
              confidence: 1,
              sourceRefs: ["c-food"],
            },
          ],
          constraintClassifications: [
            {
              constraintId: asConstraintId("c-food"),
              classification: GuardianConstraintClassification.SUPPORTED,
              confidence: 1,
            },
          ],
        },
        {
          judgeId: JudgeId.CONTRADICTION,
          status: JudgeInvocationStatus.OK,
          findings: [],
        },
        {
          judgeId: JudgeId.EVIDENCE,
          status: JudgeInvocationStatus.OK,
          findings: [],
        },
        {
          judgeId: JudgeId.PROVENANCE,
          status: JudgeInvocationStatus.UNAVAILABLE,
          findings: [],
        },
        {
          judgeId: JudgeId.DEVILS_ADVOCATE,
          status: JudgeInvocationStatus.OK,
          findings: [],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.semanticStatus).not.toBe(GuardianSemanticStatus.CLEAR);
    expect(result.value.decision).not.toBe(AuthorityDecision.ALLOW);
  });
});

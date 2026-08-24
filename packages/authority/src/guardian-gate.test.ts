import {
  AuthorityDecision,
  ErrorCode,
  GuardianSemanticStatus,
  JudgeId,
  JudgeInvocationStatus,
  PROTOCOL_VERSION,
  asHashDigest,
  asIntentStateId,
  type GuardianVerdict,
  type IntentState,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import {
  applyGuardianSemanticGate,
  combineAuthorityDecisions,
} from "./guardian-gate.js";

const NOW = "2026-01-01T00:00:00.000Z";
const STATE_HASH = asHashDigest("a".repeat(64));
const ACTION_HASH = asHashDigest("b".repeat(64));
const EVIDENCE_HASH = asHashDigest("c".repeat(64));

function tipState(overrides: Partial<IntentState> = {}): IntentState {
  return {
    id: asIntentStateId("state-1"),
    intentId: "intent-1" as IntentState["intentId"],
    version: 1,
    rawIntentHash: STATE_HASH,
    stateHash: STATE_HASH,
    constraints: [],
    createdAt: NOW,
    ...overrides,
  } as IntentState;
}

function verdict(overrides: Partial<GuardianVerdict> = {}): GuardianVerdict {
  return {
    id: "gv-1",
    actionId: "action-1" as GuardianVerdict["actionId"],
    intentId: "intent-1" as GuardianVerdict["intentId"],
    intentStateId: asIntentStateId("state-1"),
    intentStateHash: STATE_HASH,
    actionContentHash: ACTION_HASH,
    evidenceSnapshotHash: EVIDENCE_HASH,
    decision: AuthorityDecision.ALLOW,
    semanticStatus: GuardianSemanticStatus.CLEAR,
    constraintClaims: [],
    contradictions: [],
    uncertainty: 0,
    criticalFailure: false,
    judgeResults: [
      {
        judgeId: JudgeId.FIDELITY,
        status: JudgeInvocationStatus.OK,
        findings: [],
      },
    ],
    verdictHash: ACTION_HASH,
    protocolVersion: PROTOCOL_VERSION,
    promptVersions: {},
    schemaVersions: {},
    stale: false,
    createdAt: NOW,
    ...overrides,
  };
}

describe("applyGuardianSemanticGate", () => {
  it("rejects a stale verdict", () => {
    const result = applyGuardianSemanticGate({
      verdict: verdict({ stale: true }),
      actionContentHash: ACTION_HASH,
      tipIntentState: tipState(),
      highConsequence: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.GUARDIAN_VERDICT_STALE);
  });

  it("rejects IntentState id mismatch", () => {
    const result = applyGuardianSemanticGate({
      verdict: verdict({ intentStateId: asIntentStateId("other-state") }),
      actionContentHash: ACTION_HASH,
      tipIntentState: tipState(),
      highConsequence: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.GUARDIAN_VERDICT_STALE);
  });

  it("rejects IntentState hash mismatch", () => {
    const result = applyGuardianSemanticGate({
      verdict: verdict({ intentStateHash: asHashDigest("d".repeat(64)) }),
      actionContentHash: ACTION_HASH,
      tipIntentState: tipState(),
      highConsequence: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.GUARDIAN_VERDICT_STALE);
  });

  it("rejects ActionProposal content hash mismatch", () => {
    const result = applyGuardianSemanticGate({
      verdict: verdict(),
      actionContentHash: asHashDigest("e".repeat(64)),
      tipIntentState: tipState(),
      highConsequence: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.ACTION_PROPOSAL_MISMATCH);
  });

  it.each([
    ["criticalFailure flag", { criticalFailure: true }],
    ["CRITICAL_FAILURE status", { semanticStatus: GuardianSemanticStatus.CRITICAL_FAILURE }],
    ["decision BLOCK", { decision: AuthorityDecision.BLOCK }],
  ] as const)("returns BLOCK for %s", (_name, overrides) => {
    const result = applyGuardianSemanticGate({
      verdict: verdict(overrides),
      actionContentHash: ACTION_HASH,
      tipIntentState: tipState(),
      highConsequence: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.decision).toBe(AuthorityDecision.BLOCK);
  });

  it("CONFLICTED + highConsequence → BLOCK", () => {
    const result = applyGuardianSemanticGate({
      verdict: verdict({ semanticStatus: GuardianSemanticStatus.CONFLICTED }),
      actionContentHash: ACTION_HASH,
      tipIntentState: tipState(),
      highConsequence: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.decision).toBe(AuthorityDecision.BLOCK);
  });

  it("CONFLICTED + !highConsequence → REQUIRE_APPROVAL", () => {
    const result = applyGuardianSemanticGate({
      verdict: verdict({ semanticStatus: GuardianSemanticStatus.CONFLICTED }),
      actionContentHash: ACTION_HASH,
      tipIntentState: tipState(),
      highConsequence: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.decision).toBe(AuthorityDecision.REQUIRE_APPROVAL);
  });

  it("UNCERTAIN + highConsequence → REQUIRE_APPROVAL", () => {
    const result = applyGuardianSemanticGate({
      verdict: verdict({
        semanticStatus: GuardianSemanticStatus.UNCERTAIN,
        uncertainty: 0.5,
      }),
      actionContentHash: ACTION_HASH,
      tipIntentState: tipState(),
      highConsequence: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.decision).toBe(AuthorityDecision.REQUIRE_APPROVAL);
  });

  it("UNCERTAIN + !highConsequence → ALLOW_WITH_MONITORING", () => {
    const result = applyGuardianSemanticGate({
      verdict: verdict({
        semanticStatus: GuardianSemanticStatus.UNCERTAIN,
        uncertainty: 0.5,
      }),
      actionContentHash: ACTION_HASH,
      tipIntentState: tipState(),
      highConsequence: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.decision).toBe(AuthorityDecision.ALLOW_WITH_MONITORING);
    }
  });

  it("CLEAR → ALLOW (eligible for further deterministic checks)", () => {
    const result = applyGuardianSemanticGate({
      verdict: verdict({ semanticStatus: GuardianSemanticStatus.CLEAR }),
      actionContentHash: ACTION_HASH,
      tipIntentState: tipState(),
      highConsequence: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.decision).toBe(AuthorityDecision.ALLOW);
  });
});

describe("combineAuthorityDecisions", () => {
  const decisions = [
    AuthorityDecision.ALLOW,
    AuthorityDecision.ALLOW_WITH_MONITORING,
    AuthorityDecision.REQUIRE_APPROVAL,
    AuthorityDecision.BLOCK,
  ] as const;

  it("never downgrades: max severity of guardian and scope wins", () => {
    const rank: Record<(typeof decisions)[number], number> = {
      [AuthorityDecision.ALLOW]: 0,
      [AuthorityDecision.ALLOW_WITH_MONITORING]: 1,
      [AuthorityDecision.REQUIRE_APPROVAL]: 2,
      [AuthorityDecision.BLOCK]: 3,
    };
    for (const guardian of decisions) {
      for (const scope of decisions) {
        const combined = combineAuthorityDecisions(guardian, scope);
        const expected =
          rank[guardian] >= rank[scope] ? guardian : scope;
        expect(combined).toBe(expected);
      }
    }
  });

  it("Guardian BLOCK dominates scope ALLOW", () => {
    expect(
      combineAuthorityDecisions(
        AuthorityDecision.BLOCK,
        AuthorityDecision.ALLOW,
      ),
    ).toBe(AuthorityDecision.BLOCK);
  });

  it("scope BLOCK dominates Guardian ALLOW", () => {
    expect(
      combineAuthorityDecisions(
        AuthorityDecision.ALLOW,
        AuthorityDecision.BLOCK,
      ),
    ).toBe(AuthorityDecision.BLOCK);
  });

  it("Guardian REQUIRE_APPROVAL dominates scope ALLOW_WITH_MONITORING", () => {
    expect(
      combineAuthorityDecisions(
        AuthorityDecision.REQUIRE_APPROVAL,
        AuthorityDecision.ALLOW_WITH_MONITORING,
      ),
    ).toBe(AuthorityDecision.REQUIRE_APPROVAL);
  });

  it("scope ALLOW_WITH_MONITORING is preserved when Guardian is ALLOW", () => {
    expect(
      combineAuthorityDecisions(
        AuthorityDecision.ALLOW,
        AuthorityDecision.ALLOW_WITH_MONITORING,
      ),
    ).toBe(AuthorityDecision.ALLOW_WITH_MONITORING);
  });
});

type ComparisonStatus = "VERIFIED_COMPARISON" | "INCOMPLETE_COMPARISON";

type GovernanceOutcome =
  | "AUTHORIZED"
  | "MONITORED"
  | "REQUIRES_APPROVAL"
  | "BLOCKED"
  | "NOT_REACHED";

export interface ComparisonIntegrityView {
  readonly available: boolean;
  readonly status: ComparisonStatus;
  readonly reasons: readonly string[];
  readonly sameIntentState: boolean;
  readonly sameVerifiedEvidence: boolean;
  readonly sameVerifiedClaims: boolean;
  readonly sameVerifiedS1: boolean;
  readonly controlSemanticValid: boolean;
  readonly controlGovernanceOutcome: GovernanceOutcome;
  readonly controlGovernanceValid: boolean;
  readonly attackUnsafeAuthorityPrevented: boolean;
  readonly requiredProofCount: number;
  readonly satisfiedProofCount: number;
  readonly proofCoverageComplete: boolean;
  readonly privilegedReadiness: string;
  readonly semanticSuccessorConfirmed: boolean;
  readonly attackPreparedActionPresent: boolean;
  readonly attackCommitTokenPresent: boolean;
  readonly attackExecuted: boolean;
  readonly attackSideEffectCount: number;
}

export interface AuthoritativeVerifiedStateView {
  readonly stateId: string;
  readonly stateHash: string;
  readonly readiness: string;
  readonly previousStateId?: string;
  readonly previousStateHash?: string;
  readonly requiredProofCount: number;
  readonly satisfiedProofCount: number;
  readonly allRequiredSatisfied: boolean;
  readonly semanticArtifactPresent: boolean;
}

interface ComparisonIntegrityInput {
  readonly intentId: string;
  readonly compiledIntentStateId: string;
  readonly compiledIntentStateHash: string;
  readonly boundIntentStateId: string;
  readonly boundIntentStateHash: string;
  readonly controlWorkflow: Record<string, unknown>;
  readonly attackWorkflow: Record<string, unknown>;
  readonly controlWorkspace?: Record<string, unknown>;
  readonly attackWorkspace?: Record<string, unknown>;
  readonly controlApproval?: Record<string, unknown>;
  readonly controlVerifiedEvidenceIds: readonly string[];
  readonly attackVerifiedEvidenceIds: readonly string[];
  readonly controlVerifiedClaimIds: readonly string[];
  readonly attackVerifiedClaimIds: readonly string[];
  readonly authoritativeControlState?: AuthoritativeVerifiedStateView;
  readonly nowMs?: number;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readPath(source: Record<string, unknown> | undefined, path: readonly string[]): unknown {
  let current: unknown = source;
  for (const segment of path) {
    const next = record(current);
    if (!next) return undefined;
    current = next[segment];
  }
  return current;
}

function stringValue(source: Record<string, unknown> | undefined, path: readonly string[]): string | undefined {
  const value = readPath(source, path);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function arrayOfStrings(source: Record<string, unknown> | undefined, path: readonly string[]): readonly string[] {
  const value = readPath(source, path);
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function hasObjectValue(source: Record<string, unknown> | undefined, path: readonly string[]): boolean {
  return record(readPath(source, path)) !== undefined;
}

function stringSetEquals(left: readonly string[], right: readonly string[]): boolean {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function evidenceProofCounts(workspace: Record<string, unknown> | undefined): {
  readonly satisfied: number;
  readonly required: number;
  readonly complete: boolean;
} {
  const stages = readPath(workspace, ["lifecycle", "stages"]);
  if (!Array.isArray(stages)) {
    return { satisfied: 0, required: 0, complete: false };
  }
  const evidence = stages
    .map((entry) => record(entry))
    .find((entry) => entry?.stage === "evidence");
  const detail = typeof evidence?.detail === "string" ? evidence.detail : undefined;
  if (!detail) {
    return { satisfied: 0, required: 0, complete: false };
  }
  const match = detail.match(/^(\d+)\s+of\s+(\d+)\s+required proofs satisfied$/);
  if (!match) {
    return { satisfied: 0, required: 0, complete: false };
  }
  const satisfied = Number(match[1]);
  const required = Number(match[2]);
  if (!Number.isFinite(satisfied) || !Number.isFinite(required) || required <= 0) {
    return { satisfied: 0, required: 0, complete: false };
  }
  return { satisfied, required, complete: satisfied === required };
}

function stageDetail(workspace: Record<string, unknown> | undefined, stage: string): string | undefined {
  const stages = readPath(workspace, ["lifecycle", "stages"]);
  if (!Array.isArray(stages)) return undefined;
  const found = stages
    .map((entry) => record(entry))
    .find((entry) => entry?.stage === stage);
  return typeof found?.detail === "string" ? found.detail : undefined;
}

function authorityDecision(
  workspace: Record<string, unknown> | undefined,
  workflow: Record<string, unknown>,
): string | undefined {
  return stringValue(workspace, ["authority", "decision"]) ??
    stringValue(record(workflow.evaluation), ["evaluation", "decision"]) ??
    stringValue(record(workflow.evaluation), ["decision"]);
}

function governanceOutcome(
  workspace: Record<string, unknown> | undefined,
  workflow: Record<string, unknown>,
): GovernanceOutcome {
  const decision = authorityDecision(workspace, workflow);
  const workflowState = typeof workflow.state === "string" ? workflow.state : undefined;
  const commitStatus = stringValue(workflow, ["execution", "status"]);
  if (decision === "BLOCK" || workflowState === "BLOCKED") return "BLOCKED";
  if (decision === "REQUIRE_APPROVAL" || workflowState === "AWAITING_APPROVAL") return "REQUIRES_APPROVAL";
  if (decision === "ALLOW_WITH_MONITORING") return "MONITORED";
  if (decision === "ALLOW" || workflowState === "AUTHORIZED" || commitStatus === "SUCCESS") return "AUTHORIZED";
  return "NOT_REACHED";
}

function controlSemanticValidity(input: {
  readonly workspace?: Record<string, unknown>;
  readonly sameVerifiedS1: boolean;
}): boolean {
  if (!input.workspace || !input.sameVerifiedS1) return false;
  const blockingStage = stringValue(input.workspace, ["lifecycle", "blockingStage"]);
  if (["evidence", "planVerification", "actionFidelity", "capabilityFidelity", "guardian", "authorityEligibility"].includes(blockingStage ?? "")) {
    return false;
  }
  if (stageDetail(input.workspace, "planVerification") !== "VERIFIED") return false;
  if (readPath(input.workspace, ["guardian", "aggregator", "criticalFailure"]) === true) return false;
  if (stringValue(input.workspace, ["guardian", "aggregator", "decision"]) === "BLOCK") return false;
  return true;
}

function approvalBindingValid(input: {
  readonly intentId: string;
  readonly boundIntentStateId: string;
  readonly workflow: Record<string, unknown>;
  readonly approval?: Record<string, unknown>;
  readonly nowMs: number;
}): boolean {
  if (!input.approval) return false;
  const evaluation = record(record(input.workflow.evaluation)?.evaluation) ?? record(input.workflow.evaluation);
  const approval = input.approval;
  const expiresAt = typeof evaluation?.expiresAt === "string" ? evaluation.expiresAt : undefined;
  return approval.status === "PENDING" &&
    approval.workflowId === input.workflow.workflowId &&
    approval.intentId === input.intentId &&
    approval.intentStateId === input.boundIntentStateId &&
    approval.authorityEvaluationId === evaluation?.id &&
    typeof expiresAt === "string" &&
    Number.isFinite(Date.parse(expiresAt)) &&
    Date.parse(expiresAt) > input.nowMs;
}

function controlGovernanceValidity(input: {
  readonly intentId: string;
  readonly boundIntentStateId: string;
  readonly workspace?: Record<string, unknown>;
  readonly workflow: Record<string, unknown>;
  readonly approval?: Record<string, unknown>;
  readonly nowMs: number;
}): {
  readonly outcome: GovernanceOutcome;
  readonly valid: boolean;
} {
  const outcome = governanceOutcome(input.workspace, input.workflow);
  if (outcome === "BLOCKED" || outcome === "NOT_REACHED") {
    return { outcome, valid: false };
  }
  if (outcome !== "REQUIRES_APPROVAL") {
    return { outcome, valid: true };
  }
  const evaluation = record(record(input.workflow.evaluation)?.evaluation) ?? record(input.workflow.evaluation);
  const workflowState = typeof input.workflow.state === "string" ? input.workflow.state : undefined;
  const valid = workflowState === "AWAITING_APPROVAL" &&
    typeof evaluation?.id === "string" &&
    evaluation.materializationReason === "PENDING_APPROVAL" &&
    approvalBindingValid({
      intentId: input.intentId,
      boundIntentStateId: input.boundIntentStateId,
      workflow: input.workflow,
      approval: input.approval,
      nowMs: input.nowMs,
    });
  return { outcome, valid };
}

function semanticSuccessorConfirmed(input: {
  readonly authoritativeControlState?: AuthoritativeVerifiedStateView;
  readonly compiledIntentStateId: string;
  readonly compiledIntentStateHash: string;
  readonly boundIntentStateId: string;
  readonly boundIntentStateHash: string;
}): boolean {
  const authoritative = input.authoritativeControlState;
  if (!authoritative || !authoritative.semanticArtifactPresent) return false;
  return input.boundIntentStateId !== input.compiledIntentStateId &&
    input.boundIntentStateHash !== input.compiledIntentStateHash &&
    authoritative.stateId === input.boundIntentStateId &&
    authoritative.stateHash === input.boundIntentStateHash &&
    authoritative.previousStateId === input.compiledIntentStateId &&
    authoritative.previousStateHash === input.compiledIntentStateHash;
}

function attackUnsafeAuthorityPrevented(input: {
  readonly attackWorkflow: Record<string, unknown>;
  readonly attackWorkspace?: Record<string, unknown>;
}): {
  readonly safe: boolean;
  readonly preparedActionPresent: boolean;
  readonly commitTokenPresent: boolean;
  readonly executed: boolean;
  readonly sideEffectCount: number;
} {
  const preparedActionPresent = hasObjectValue(input.attackWorkspace, ["execution", "preparedAction"]) ||
    hasObjectValue(input.attackWorkflow, ["artifacts", "preparedAction"]);
  const commitTokenPresent = hasObjectValue(input.attackWorkflow, ["artifacts", "commitToken"]) ||
    hasObjectValue(input.attackWorkspace, ["execution", "commitToken"]);
  const executionStatus = stringValue(input.attackWorkflow, ["execution", "status"]);
  const committed = executionStatus === "SUCCESS";
  const sideEffectCount = arrayOfStrings(undefined, []).length +
    ((readPath(input.attackWorkspace, ["execution", "sideEffects"]) as unknown[] | undefined)?.length ?? 0);
  return {
    safe: !preparedActionPresent && !commitTokenPresent && !committed && sideEffectCount === 0,
    preparedActionPresent,
    commitTokenPresent,
    executed: committed,
    sideEffectCount,
  };
}

export function unavailableComparisonIntegrity(reason: string): ComparisonIntegrityView {
  return {
    available: false,
    status: "INCOMPLETE_COMPARISON",
    reasons: [reason],
    sameIntentState: false,
    sameVerifiedEvidence: false,
    sameVerifiedClaims: false,
    sameVerifiedS1: false,
    controlSemanticValid: false,
    controlGovernanceOutcome: "NOT_REACHED",
    controlGovernanceValid: false,
    attackUnsafeAuthorityPrevented: false,
    requiredProofCount: 0,
    satisfiedProofCount: 0,
    proofCoverageComplete: false,
    privilegedReadiness: "UNKNOWN",
    semanticSuccessorConfirmed: false,
    attackPreparedActionPresent: false,
    attackCommitTokenPresent: false,
    attackExecuted: false,
    attackSideEffectCount: 0,
  };
}

export function deriveComparisonIntegrity(input: ComparisonIntegrityInput): ComparisonIntegrityView {
  if (!input.controlWorkspace || !input.attackWorkspace) {
    return unavailableComparisonIntegrity("BACKEND_COMPARISON_UNAVAILABLE");
  }

  const controlStateId = stringValue(input.controlWorkspace, ["summary", "intentStateId"]);
  const controlStateHash = stringValue(input.controlWorkspace, ["summary", "stateHash"]);
  const attackStateId = stringValue(input.attackWorkspace, ["summary", "intentStateId"]);
  const attackStateHash = stringValue(input.attackWorkspace, ["summary", "stateHash"]);

  const sameIntentState = controlStateId === input.boundIntentStateId &&
    controlStateHash === input.boundIntentStateHash &&
    attackStateId === input.boundIntentStateId &&
    attackStateHash === input.boundIntentStateHash &&
    controlStateId === attackStateId &&
    controlStateHash === attackStateHash;

  const sameVerifiedEvidence = input.controlVerifiedEvidenceIds.length > 0 &&
    stringSetEquals(input.controlVerifiedEvidenceIds, input.attackVerifiedEvidenceIds);
  const sameVerifiedClaims = input.controlVerifiedClaimIds.length > 0 &&
    stringSetEquals(input.controlVerifiedClaimIds, input.attackVerifiedClaimIds);

  const proofs = input.authoritativeControlState
    ? {
        satisfied: input.authoritativeControlState.satisfiedProofCount,
        required: input.authoritativeControlState.requiredProofCount,
        complete: input.authoritativeControlState.allRequiredSatisfied,
      }
    : evidenceProofCounts(input.controlWorkspace);
  const privilegedReadiness = input.authoritativeControlState?.readiness ?? "UNKNOWN";
  const readinessValid = privilegedReadiness === "ACTIONABLE" || privilegedReadiness === "EXECUTABLE";
  const successorConfirmed = semanticSuccessorConfirmed({
    authoritativeControlState: input.authoritativeControlState,
    compiledIntentStateId: input.compiledIntentStateId,
    compiledIntentStateHash: input.compiledIntentStateHash,
    boundIntentStateId: input.boundIntentStateId,
    boundIntentStateHash: input.boundIntentStateHash,
  });

  const sameVerifiedS1 = sameIntentState &&
    proofs.complete &&
    readinessValid &&
    successorConfirmed;

  const controlSemanticValid = controlSemanticValidity({
    workspace: input.controlWorkspace,
    sameVerifiedS1,
  });

  const governance = controlGovernanceValidity({
    intentId: input.intentId,
    boundIntentStateId: input.boundIntentStateId,
    workspace: input.controlWorkspace,
    workflow: input.controlWorkflow,
    approval: input.controlApproval,
    nowMs: input.nowMs ?? Date.now(),
  });

  const attackSafety = attackUnsafeAuthorityPrevented({
    attackWorkflow: input.attackWorkflow,
    attackWorkspace: input.attackWorkspace,
  });

  const reasons: string[] = [];
  if (!sameIntentState) reasons.push("CONTROL_ATTACK_STATE_MISMATCH");
  if (!sameVerifiedEvidence) reasons.push("EVIDENCE_SET_MISMATCH");
  if (!sameVerifiedClaims) reasons.push("CLAIM_SET_MISMATCH");
  if (!proofs.complete) reasons.push("CONTROL_PROOF_INCOMPLETE");
  if (!readinessValid) reasons.push("CONTROL_NOT_PRIVILEGED_READY");
  if (!successorConfirmed) reasons.push("CONTROL_NOT_VERIFIED_S1");
  if (!controlSemanticValid) {
    const guardianBlocked = stringValue(input.controlWorkspace, ["guardian", "aggregator", "decision"]) === "BLOCK" ||
      readPath(input.controlWorkspace, ["guardian", "aggregator", "criticalFailure"]) === true;
    const planRejected = stageDetail(input.controlWorkspace, "planVerification") !== "VERIFIED";
    const blockingStage = stringValue(input.controlWorkspace, ["lifecycle", "blockingStage"]);
    if (planRejected) reasons.push("CONTROL_PLAN_REJECTED");
    if (guardianBlocked) reasons.push("CONTROL_GUARDIAN_BLOCKED");
    if (blockingStage === "actionFidelity") reasons.push("CONTROL_ACTION_FIDELITY_MISMATCH");
    if (blockingStage === "capabilityFidelity") reasons.push("CONTROL_CAPABILITY_FIDELITY_MISMATCH");
    if (!planRejected && !guardianBlocked && blockingStage === "authorityEligibility") reasons.push("CONTROL_SEMANTIC_GATE_FAILED");
  }
  if (!governance.valid) {
    reasons.push(governance.outcome === "BLOCKED" ? "CONTROL_AUTHORITY_BLOCKED" : "CONTROL_AUTHORITY_NOT_REACHED");
  }
  if (attackSafety.preparedActionPresent || attackSafety.commitTokenPresent) reasons.push("ATTACK_UNSAFE_AUTHORITY_OBTAINED");
  if (attackSafety.executed) reasons.push("ATTACK_EXECUTED");
  if (attackSafety.sideEffectCount > 0) reasons.push("ATTACK_SIDE_EFFECT_OBSERVED");

  const status: ComparisonStatus = sameIntentState &&
    sameVerifiedEvidence &&
    sameVerifiedClaims &&
    sameVerifiedS1 &&
    controlSemanticValid &&
    governance.valid &&
    attackSafety.safe
    ? "VERIFIED_COMPARISON"
    : "INCOMPLETE_COMPARISON";

  return {
    available: true,
    status,
    reasons,
    sameIntentState,
    sameVerifiedEvidence,
    sameVerifiedClaims,
    sameVerifiedS1,
    controlSemanticValid,
    controlGovernanceOutcome: governance.outcome,
    controlGovernanceValid: governance.valid,
    attackUnsafeAuthorityPrevented: attackSafety.safe,
    requiredProofCount: proofs.required,
    satisfiedProofCount: proofs.satisfied,
    proofCoverageComplete: proofs.complete,
    privilegedReadiness,
    semanticSuccessorConfirmed: successorConfirmed,
    attackPreparedActionPresent: attackSafety.preparedActionPresent,
    attackCommitTokenPresent: attackSafety.commitTokenPresent,
    attackExecuted: attackSafety.executed,
    attackSideEffectCount: attackSafety.sideEffectCount,
  };
}

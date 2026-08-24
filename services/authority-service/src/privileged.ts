import {
  applyGuardianSemanticGate,
  combineAuthorityDecisions,
  createApprovalArtifact,
  issueCommitToken,
  validateApprovalForPreparedAction,
  type CommitTokenStore,
  InMemoryCommitTokenStore,
} from "@truemandate/authority";
import { hashActionProposal } from "@truemandate/guardian-core";
import {
  AuthorityDecision,
  ErrorCode,
  err,
  ok,
  type ActionProposal,
  type ApprovalArtifact,
  type AuthorityGrant,
  type CommitToken,
  type GuardianVerdict,
  type PreparedAction,
  type Result,
} from "@truemandate/protocol";
import type { AuthorityService } from "./service.js";

function isHighConsequence(action: ActionProposal): boolean {
  return (
    action.consequenceLevel === "HIGH" ||
    action.consequenceLevel === "IRREVERSIBLE" ||
    action.capability === "execute_payment" ||
    action.capability === "non_refundable_purchase"
  );
}

export interface PrivilegedEvaluateInput {
  readonly request: unknown;
  readonly action: ActionProposal;
  readonly verdict?: GuardianVerdict;
  readonly evidenceSnapshotHash?: string;
  readonly planId?: string;
  readonly planVersion?: number;
}

/**
 * Authority evaluation that consumes GuardianVerdict as one input.
 * Guardian ALLOW never forces Authority ALLOW.
 */
export async function evaluatePrivilegedAuthority(
  service: AuthorityService,
  input: PrivilegedEvaluateInput,
): Promise<Result<{
  readonly decision: AuthorityDecision;
  readonly reasons: readonly string[];
}>> {
  const scopeEval = await service.evaluateAuthorityRequest(input.request);
  if (!scopeEval.ok) return scopeEval;

  if (!input.verdict) {
    if (isHighConsequence(input.action)) {
      return err(
        ErrorCode.GUARDIAN_VERDICT_REQUIRED,
        "High-consequence authority requires GuardianVerdict",
      );
    }
    return scopeEval;
  }

  const tip = await service.getIntentService().getCurrentIntentState(input.action.intentId);
  if (!tip.ok) return tip;

  const gate = applyGuardianSemanticGate({
    verdict: input.verdict,
    actionContentHash: hashActionProposal(input.action),
    tipIntentState: tip.value,
    highConsequence: isHighConsequence(input.action),
    expectedEvidenceSnapshotHash: input.evidenceSnapshotHash,
    planId: input.planId,
    planVersion: input.planVersion,
  });
  if (!gate.ok) return gate;

  const decision = combineAuthorityDecisions(
    gate.value.decision,
    scopeEval.value.decision,
  );
  return ok({
    decision,
    reasons: [...gate.value.reasons, ...scopeEval.value.reasons],
  });
}

export async function createGrantWithApproval(
  service: AuthorityService,
  raw: unknown,
  approval?: ApprovalArtifact,
): Promise<Result<AuthorityGrant>> {
  const parsed = raw as {
    decision?: AuthorityDecision;
    preparedAction?: PreparedAction;
    request?: { principalId?: string };
  };

  if (parsed.decision === AuthorityDecision.REQUIRE_APPROVAL) {
    if (!approval || !parsed.preparedAction || !parsed.request?.principalId) {
      return err(
        ErrorCode.APPROVAL_REQUIRED,
        "REQUIRE_APPROVAL needs ApprovalArtifact bound to PreparedAction",
      );
    }
    const check = validateApprovalForPreparedAction(
      approval,
      parsed.preparedAction,
      parsed.request.principalId,
    );
    if (!check.ok) return check;
    return service.createGrant({
      ...parsed,
      decision: AuthorityDecision.ALLOW,
    });
  }

  if (parsed.decision === AuthorityDecision.BLOCK) {
    return err(
      ErrorCode.AUTHORITY_BLOCKED,
      "Cannot issue executable grant for BLOCK decision",
    );
  }

  return service.createGrant(raw);
}

export async function issueAndStoreCommitToken(
  tokenStore: CommitTokenStore,
  input: {
    readonly grant: AuthorityGrant;
    readonly preparedAction: PreparedAction;
    readonly expiresAt: string;
    readonly createdAt?: string;
    readonly id?: string;
  },
): Promise<Result<CommitToken>> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const issued = issueCommitToken({
    id: input.id,
    grant: input.grant,
    preparedAction: input.preparedAction,
    expiresAt: input.expiresAt,
    createdAt,
  });
  if (!issued.ok) return issued;
  return tokenStore.put(issued.value);
}

export { createApprovalArtifact, InMemoryCommitTokenStore };

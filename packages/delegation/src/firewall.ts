import {
  isCapabilityScopeSubset,
  validateDelegationDepth,
} from "@truemandate/authority";
import { hashCanonical } from "@truemandate/crypto";
import {
  CapabilityName,
  CommitmentLevel,
  ErrorCode,
  PlanStatus,
  asDelegationId,
  err,
  ok,
  type CapabilityScope,
  type ConstraintId,
  type DelegationEnvelope,
  type PlanGraph,
  type PlanStep,
  type Result,
  type SemanticVerificationResult,
} from "@truemandate/protocol";
import { DelegationEnvelopeSchema, parseWithSchema } from "@truemandate/schemas";
import {
  assertCommitmentAllowedForPlan,
  type SemanticGateContext,
} from "@truemandate/semantic-readiness";

const ECONOMIC_CAPS = new Set<string>([
  CapabilityName.execute_payment,
  CapabilityName.non_refundable_purchase,
  CapabilityName.compensate,
  CapabilityName.execute_remedy,
  "payment.execute",
  "refund.issue",
  "authority.grant",
  "policy.modify",
]);

export interface MintDelegationRequest {
  readonly id?: string;
  readonly parentAgentId: string;
  readonly childAgentId: string;
  readonly intentId: string;
  readonly intentStateId: string;
  readonly tipIntentStateId: string;
  readonly parentScope: CapabilityScope;
  readonly childScope: CapabilityScope;
  readonly stickyConstraintIds: readonly ConstraintId[];
  readonly requiredConstraintIds?: readonly ConstraintId[];
  readonly plan: PlanGraph;
  readonly planStep: PlanStep;
  readonly verification: SemanticVerificationResult;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly delegationDepth: number;
  readonly permittedTransformations?: readonly string[];
  readonly prohibitedTransformations?: readonly string[];
  readonly provenanceParentNodeId?: string;
}

function mapSubsetError(result: Result<void>): Result<void> {
  if (result.ok) return result;
  if (result.code === ErrorCode.CHILD_AUTHORITY_EXCEEDS_PARENT) {
    return err(ErrorCode.DELEGATION_SCOPE_EXPANDED, result.message, result.details);
  }
  return result;
}

export function validateDelegationEnvelope(
  envelope: DelegationEnvelope,
  ctx: {
    readonly tipIntentStateId: string;
    readonly plan: PlanGraph;
    readonly planStep: PlanStep;
    readonly verification: SemanticVerificationResult;
  },
): Result<void> {
  if (ctx.plan.status === PlanStatus.STALE || ctx.plan.status === PlanStatus.REJECTED) {
    return err(ErrorCode.PLAN_STALE, "Plan is stale or rejected; delegation unusable", {
      planId: ctx.plan.id,
      status: ctx.plan.status,
    });
  }
  if (envelope.intentStateId !== ctx.tipIntentStateId) {
    return err(ErrorCode.PLAN_STALE, "Delegation IntentState is not the tip", {
      envelopeState: envelope.intentStateId,
      tip: ctx.tipIntentStateId,
    });
  }
  if (envelope.intentStateId !== ctx.plan.intentStateId) {
    return err(ErrorCode.PLAN_STALE, "Delegation IntentState does not match plan binding");
  }

  const gate: SemanticGateContext = {
    intentStateId: envelope.intentStateId,
    verification: ctx.verification,
  };
  const commitment = assertCommitmentAllowedForPlan(gate, ctx.planStep.commitmentLevel);
  if (!commitment.ok) return commitment;

  const subset = mapSubsetError(
    isCapabilityScopeSubset(envelope.childScope, envelope.parentScope),
  );
  if (!subset.ok) return subset;

  const depth = validateDelegationDepth(
    envelope.delegationDepth,
    envelope.parentScope,
  );
  if (!depth.ok) {
    return err(ErrorCode.DELEGATION_SCOPE_EXPANDED, depth.message, depth.details);
  }

  if (new Date(envelope.expiresAt).getTime() > new Date(envelope.parentScope.expiresAt ?? envelope.expiresAt).getTime()) {
    if (envelope.parentScope.expiresAt !== undefined) {
      const parentExp = Date.parse(envelope.parentScope.expiresAt);
      const childExp = Date.parse(envelope.expiresAt);
      if (childExp > parentExp) {
        return err(
          ErrorCode.DELEGATION_SCOPE_EXPANDED,
          "Child expiry extends beyond parent",
          { childExpiresAt: envelope.expiresAt, parentExpiresAt: envelope.parentScope.expiresAt },
        );
      }
    }
  }

  // Least privilege: child caps ⊆ step.requestedCapabilities ∩ parent
  for (const [cap, decision] of Object.entries(envelope.childScope.capabilities)) {
    if (decision === undefined) continue;
    if (!ctx.planStep.requestedCapabilities.includes(cap)) {
      return err(
        ErrorCode.DELEGATION_SCOPE_EXPANDED,
        "Child capability not in plan step requestedCapabilities",
        { capability: cap },
      );
    }
    if (
      ECONOMIC_CAPS.has(cap) &&
      (ctx.planStep.commitmentLevel === CommitmentLevel.READ_ONLY ||
        ctx.verification.ambiguityClass === "A2" ||
        ctx.verification.ambiguityClass === "A3" ||
        ctx.verification.ambiguityClass === "A4")
    ) {
      return err(
        ErrorCode.SEMANTIC_READINESS_INSUFFICIENT,
        "Economic capability not delegable for this readiness/commitment",
        { capability: cap },
      );
    }
  }

  // requiredFutureCapabilities must not appear as currently delegated unless also requested
  for (const future of ctx.planStep.requiredFutureCapabilities) {
    if (
      envelope.childScope.capabilities[future] !== undefined &&
      !ctx.planStep.requestedCapabilities.includes(future)
    ) {
      return err(
        ErrorCode.DELEGATION_SCOPE_EXPANDED,
        "requiredFutureCapability cannot be delegated without being requestedCapabilities",
        { capability: future },
      );
    }
  }

  for (const sticky of envelope.stickyConstraintIds) {
    const onStep =
      ctx.planStep.applicableConstraintIds.includes(sticky) ||
      ctx.planStep.inheritedConstraintIds.includes(sticky) ||
      ctx.planStep.requiredConstraintIds.includes(sticky);
    // Sticky may be deferred (not yet enforced) on READ_ONLY research steps.
    // Economic steps still require sticky presence; IRRELEVANT alone is not enough.
    if (!onStep && ctx.planStep.commitmentLevel !== CommitmentLevel.READ_ONLY) {
      if (ctx.planStep.irrelevantConstraintIds.includes(sticky)) {
        return err(
          ErrorCode.CONSTRAINT_DROPPED,
          "Sticky constraint marked IRRELEVANT on economic step; use DEFERRED only when still relevant later",
          { constraintId: sticky },
        );
      }
      return err(
        ErrorCode.CONSTRAINT_DROPPED,
        "Sticky constraint missing from step applicability records",
        { constraintId: sticky },
      );
    }
  }

  return ok();
}

export function mintDelegationEnvelope(
  request: MintDelegationRequest,
): Result<DelegationEnvelope> {
  const withoutHash = {
    id: asDelegationId(request.id ?? `del-${hashCanonical(request).slice(0, 12)}`),
    parentAgentId: request.parentAgentId as DelegationEnvelope["parentAgentId"],
    childAgentId: request.childAgentId as DelegationEnvelope["childAgentId"],
    intentId: request.intentId as DelegationEnvelope["intentId"],
    intentStateId: request.intentStateId as DelegationEnvelope["intentStateId"],
    parentScope: request.parentScope,
    childScope: request.childScope,
    stickyConstraintIds: request.stickyConstraintIds,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
    delegationDepth: request.delegationDepth,
    planId: request.plan.id,
    planStepId: request.planStep.id,
    permittedTransformations: request.permittedTransformations,
    prohibitedTransformations: request.prohibitedTransformations,
    requiredConstraintIds: request.requiredConstraintIds ?? request.planStep.requiredConstraintIds,
    provenanceParentNodeId: request.provenanceParentNodeId as
      | DelegationEnvelope["provenanceParentNodeId"]
      | undefined,
  };

  const envelope: DelegationEnvelope = {
    ...withoutHash,
    envelopeHash: hashCanonical(withoutHash),
  };

  const parsed = parseWithSchema(DelegationEnvelopeSchema, envelope, "DelegationEnvelope");
  if (!parsed.ok) return parsed;

  const validated = validateDelegationEnvelope(envelope, {
    tipIntentStateId: request.tipIntentStateId,
    plan: request.plan,
    planStep: request.planStep,
    verification: request.verification,
  });
  if (!validated.ok) return validated;

  return ok(envelope);
}

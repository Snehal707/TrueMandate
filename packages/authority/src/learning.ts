import { hashCanonical } from "@truemandate/crypto";
import {
  ErrorCode,
  LearningProposalEventType,
  LearningStatus,
  err,
  ok,
  asHashDigest,
  asIntentId,
  asLearnedContextRecordId,
  asLearningProposalId,
  asPrincipalId,
  type AuthorityDecision,
  type CapabilityScope,
  type Constraint,
  type Intent,
  type IntentState,
  type LearnedContextRecord,
  type LearningProposal,
  type LearningProposalEvent,
  type LearningProposalType,
  type Result,
} from "@truemandate/protocol";
import {
  AuthorityDecisionSchema,
  CapabilityScopeSchema,
  ConstraintSchema,
  LearningProposalSchema,
  parseWithSchema,
} from "@truemandate/schemas";
import { isCapabilityScopeSubset } from "./capability-subset.js";
import {
  assertTrustSignalCannotOverrideAuthorityDecision,
  assertTrustSignalCannotWeakenConstraint,
  parseTrustSignal,
} from "./trust-signal.js";
import { assertUserPreferenceContent } from "./preference-signal.js";
import { assertWorkflowRuleContent } from "./workflow-rule-signal.js";

/**
 * INV_011: Learning cannot rewrite historical intent.
 */
export function applyLearningProposal(
  proposal: LearningProposal,
  historicalIntent: Intent,
  historicalState: IntentState,
): Result<{ readonly intent: Intent; readonly state: IntentState }> {
  if (proposal.targetIntentId && proposal.targetIntentId === historicalIntent.id) {
    // Learning may attach preferences for future use but must not mutate history.
    return err(
      ErrorCode.LEARNING_CANNOT_REWRITE_INTENT,
      "Learning cannot rewrite historical intent; proposals apply only to future preferences",
      { learningProposalId: proposal.id, intentId: historicalIntent.id },
    );
  }
  // No mutation path: return originals unchanged for non-targeting proposals.
  void historicalState;
  return ok({ intent: historicalIntent, state: historicalState });
}

/**
 * INV_015: Critical failures cannot automatically expand authority.
 * Learning / reliability signals may propose narrower scopes only.
 */
export function assertLearningCannotExpandAuthority(
  current: CapabilityScope,
  proposedFromLearning: CapabilityScope,
): Result<void> {
  const subset = isCapabilityScopeSubset(proposedFromLearning, current);
  if (!subset.ok) {
    return err(
      ErrorCode.CRITICAL_FAILURE_CANNOT_EXPAND_AUTHORITY,
      "Learning or critical-failure signals cannot expand authority",
      subset.details,
    );
  }
  return ok();
}

/** Wave 3.1: every proposal requires explicit human confirmation. */
export function learningRequiresConfirmation(_draft: {
  readonly proposalType: LearningProposalType;
}): boolean {
  return true;
}

export interface LearningProposalDraft {
  readonly id: string;
  readonly principalId: string;
  readonly domain: string;
  readonly proposalType: LearningProposalType;
  readonly content: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly targetIntentId?: string;
}

export function learningProposalHash(
  value: Omit<LearningProposal, "contentHash">,
): string {
  return hashCanonical(value);
}

function withHash(value: Omit<LearningProposal, "contentHash">): LearningProposal {
  const { contentHash: _stale, ...canonical } = value as LearningProposal;
  return {
    ...canonical,
    contentHash: asHashDigest(learningProposalHash(canonical)),
  };
}

export function parseLearningProposal(value: unknown): Result<LearningProposal> {
  const parsed = parseWithSchema(LearningProposalSchema, value, "LearningProposal");
  if (!parsed.ok) return parsed as Result<LearningProposal>;
  const proposal = parsed.value as unknown as LearningProposal;
  const { contentHash, ...canonical } = proposal;
  if (contentHash !== learningProposalHash(canonical)) {
    return err(ErrorCode.VALIDATION_FAILED, "LearningProposal canonical hash mismatch");
  }
  return ok(proposal);
}

function tryParseScope(
  content: Readonly<Record<string, unknown>>,
  key: "currentScope" | "proposedScope",
): Result<CapabilityScope | undefined> {
  const raw = content[key];
  if (raw === undefined) return ok(undefined);
  const parsed = CapabilityScopeSchema.safeParse(raw);
  if (!parsed.success) {
    return err(ErrorCode.VALIDATION_FAILED, `LearningProposal content.${key} is invalid`, {
      issues: parsed.error.issues,
    });
  }
  return ok(parsed.data as CapabilityScope);
}

/**
 * INV_026 wiring for AGENT_RELIABILITY / COUNTERPARTY_TRUST confirms.
 * Validates optional trustSignal + optional override claims in content.
 */
function enforceTrustSignalOnConfirm(
  content: Readonly<Record<string, unknown>>,
): Result<void> {
  if (content.trustSignal !== undefined) {
    const signal = parseTrustSignal(content.trustSignal);
    if (!signal.ok) return signal;
  }

  if (content.attemptedConstraintOverride === true) {
    if (content.constraint === undefined) {
      return err(
        ErrorCode.VALIDATION_FAILED,
        "attemptedConstraintOverride requires content.constraint",
      );
    }
    const parsed = ConstraintSchema.safeParse(content.constraint);
    if (!parsed.success) {
      return err(ErrorCode.VALIDATION_FAILED, "LearningProposal content.constraint is invalid", {
        issues: parsed.error.issues,
      });
    }
    const weakened = assertTrustSignalCannotWeakenConstraint(
      parsed.data as unknown as Constraint,
      true,
    );
    if (!weakened.ok) return weakened;
  }

  if (content.baselineDecision !== undefined || content.proposedDecision !== undefined) {
    const baseline = AuthorityDecisionSchema.safeParse(content.baselineDecision);
    const proposed = AuthorityDecisionSchema.safeParse(content.proposedDecision);
    if (!baseline.success || !proposed.success) {
      return err(
        ErrorCode.VALIDATION_FAILED,
        "baselineDecision and proposedDecision must both be valid AuthorityDecision values",
      );
    }
    const decision = assertTrustSignalCannotOverrideAuthorityDecision(
      baseline.data as AuthorityDecision,
      proposed.data as AuthorityDecision,
    );
    if (!decision.ok) return decision;
  }

  return ok();
}

/**
 * Create a PROPOSED LearningProposal. If targetIntentId is set, INV_011 is
 * evaluated against the supplied historical Intent/IntentState (fail closed).
 */
export function createLearningProposal(input: {
  readonly draft: LearningProposalDraft;
  readonly historicalIntent?: Intent;
  readonly historicalState?: IntentState;
}): Result<LearningProposal> {
  const { draft } = input;
  if (draft.domain.trim().length === 0) {
    return err(ErrorCode.VALIDATION_FAILED, "LearningProposal domain is required");
  }
  if (draft.expiresAt !== undefined && Date.parse(draft.expiresAt) <= Date.parse(draft.createdAt)) {
    return err(ErrorCode.VALIDATION_FAILED, "LearningProposal expiry must follow createdAt");
  }
  if (draft.targetIntentId) {
    if (!input.historicalIntent || !input.historicalState) {
      return err(
        ErrorCode.VALIDATION_FAILED,
        "targetIntentId requires historicalIntent and historicalState for INV_011 validation",
      );
    }
    if (input.historicalIntent.id !== draft.targetIntentId) {
      return err(ErrorCode.VALIDATION_FAILED, "historicalIntent.id must match targetIntentId");
    }
  }

  const base: Omit<LearningProposal, "contentHash"> = {
    id: asLearningProposalId(draft.id),
    principalId: asPrincipalId(draft.principalId),
    domain: draft.domain,
    proposalType: draft.proposalType,
    content: draft.content,
    status: LearningStatus.PROPOSED,
    createdAt: draft.createdAt,
    expiresAt: draft.expiresAt,
    targetIntentId: draft.targetIntentId
      ? asIntentId(draft.targetIntentId)
      : undefined,
    requiresConfirmation: learningRequiresConfirmation({
      proposalType: draft.proposalType,
    }),
  };

  const proposal = withHash(base);

  if (proposal.targetIntentId && input.historicalIntent && input.historicalState) {
    const inv011 = applyLearningProposal(
      proposal,
      input.historicalIntent,
      input.historicalState,
    );
    if (!inv011.ok) return inv011;
  }

  // Defense-in-depth INV_015 when scope pair is present in content at create.
  const currentScope = tryParseScope(proposal.content, "currentScope");
  if (!currentScope.ok) return currentScope;
  const proposedScope = tryParseScope(proposal.content, "proposedScope");
  if (!proposedScope.ok) return proposedScope;
  if (currentScope.value && proposedScope.value) {
    const inv015 = assertLearningCannotExpandAuthority(
      currentScope.value,
      proposedScope.value,
    );
    if (!inv015.ok) return inv015;
  } else if (proposedScope.value && !currentScope.value) {
    return err(
      ErrorCode.VALIDATION_FAILED,
      "LearningProposal content.proposedScope requires content.currentScope",
    );
  }

  // INV_027: USER_PREFERENCE must not target protected concepts and must
  // carry subjectId / concept / value / origin for later PreferenceRecord.
  if (proposal.proposalType === "USER_PREFERENCE") {
    const inv027 = assertUserPreferenceContent(proposal.content);
    if (!inv027.ok) return inv027;
  }

  // INV_028: WORKFLOW_RULE requires repeated confirmed evidence and must
  // not target protected concepts.
  if (proposal.proposalType === "WORKFLOW_RULE") {
    const inv028 = assertWorkflowRuleContent(proposal.content);
    if (!inv028.ok) return inv028;
  }

  return ok(proposal);
}

export function proposedEvent(
  proposal: LearningProposal,
  input: { readonly eventId: string; readonly at: string },
): Result<LearningProposalEvent> {
  return ok({
    id: input.eventId,
    learningProposalId: proposal.id,
    type: LearningProposalEventType.PROPOSED,
    at: input.at,
    payload: {
      proposalType: proposal.proposalType,
      domain: proposal.domain,
      requiresConfirmation: proposal.requiresConfirmation,
    },
    dedupeKey: `learning_proposed:${proposal.id}`,
  });
}

/**
 * Lazy expiry (persist + event when it fires). Caller must refuse confirm/reject
 * after this returns an update.
 */
export function expireLearningProposalIfPast(
  proposal: LearningProposal,
  input: { readonly eventId: string; readonly at: string },
): Result<{
  readonly updated?: LearningProposal;
  readonly event?: LearningProposalEvent;
}> {
  if (proposal.status !== LearningStatus.PROPOSED) {
    return ok({});
  }
  if (!proposal.expiresAt || Date.parse(input.at) <= Date.parse(proposal.expiresAt)) {
    return ok({});
  }
  const updated = withHash({
    ...proposal,
    status: LearningStatus.EXPIRED,
  });
  const event: LearningProposalEvent = {
    id: input.eventId,
    learningProposalId: proposal.id,
    type: LearningProposalEventType.EXPIRED,
    at: input.at,
    payload: { expiresAt: proposal.expiresAt },
    dedupeKey: `learning_expired:${proposal.id}`,
  };
  return ok({ updated, event });
}

/**
 * Confirm a PROPOSED learning proposal. decidedBy MUST be the verified caller
 * identity (service layer), never request JSON.
 *
 * Re-runs INV_011 (when targetIntentId) and INV_015 (when scope pair present)
 * as fresh-commit-style revalidation. On success writes a LearnedContextRecord.
 */
export function confirmLearningProposal(
  proposal: LearningProposal,
  input: {
    readonly decidedBy: string;
    readonly at: string;
    readonly reason?: string;
    readonly eventId: string;
    readonly historicalIntent?: Intent;
    readonly historicalState?: IntentState;
    readonly currentScope?: CapabilityScope;
    readonly proposedScope?: CapabilityScope;
  },
): Result<{
  readonly updated: LearningProposal;
  readonly event: LearningProposalEvent;
  readonly learnedContext: LearnedContextRecord;
}> {
  if (proposal.status === LearningStatus.EXPIRED) {
    return err(ErrorCode.LEARNING_PROPOSAL_EXPIRED, "Learning proposal has expired");
  }
  if (proposal.status !== LearningStatus.PROPOSED) {
    return err(ErrorCode.LEARNING_PROPOSAL_NOT_PENDING, "Learning proposal already decided", {
      status: proposal.status,
    });
  }
  if (proposal.expiresAt && Date.parse(input.at) > Date.parse(proposal.expiresAt)) {
    return err(ErrorCode.LEARNING_PROPOSAL_EXPIRED, "Learning proposal has expired");
  }

  if (proposal.targetIntentId) {
    if (!input.historicalIntent || !input.historicalState) {
      return err(
        ErrorCode.VALIDATION_FAILED,
        "Confirming a targeted proposal requires historicalIntent and historicalState",
      );
    }
    const inv011 = applyLearningProposal(
      proposal,
      input.historicalIntent,
      input.historicalState,
    );
    if (!inv011.ok) return inv011;
  }

  const contentCurrent = tryParseScope(proposal.content, "currentScope");
  if (!contentCurrent.ok) return contentCurrent;
  const contentProposed = tryParseScope(proposal.content, "proposedScope");
  if (!contentProposed.ok) return contentProposed;

  const currentScope = input.currentScope ?? contentCurrent.value;
  const proposedScope = input.proposedScope ?? contentProposed.value;
  if (proposedScope && !currentScope) {
    return err(
      ErrorCode.VALIDATION_FAILED,
      "proposedScope requires currentScope for INV_015 validation",
    );
  }
  if (currentScope && proposedScope) {
    const inv015 = assertLearningCannotExpandAuthority(currentScope, proposedScope);
    if (!inv015.ok) return inv015;
  }

  // INV_026: reputation/trust proposals cannot override sticky policy or
  // Authority restrictions. Content fields are caller-declared (defense-in-depth);
  // no live AuthorityGrant/constraint source is wired yet.
  if (
    proposal.proposalType === "AGENT_RELIABILITY" ||
    proposal.proposalType === "COUNTERPARTY_TRUST"
  ) {
    const inv026 = enforceTrustSignalOnConfirm(proposal.content);
    if (!inv026.ok) return inv026;
  }

  const decidedBy = asPrincipalId(input.decidedBy);
  const updated = withHash({
    ...proposal,
    status: LearningStatus.CONFIRMED,
    decidedAt: input.at,
    decidedBy,
    reason: input.reason,
  });

  const event: LearningProposalEvent = {
    id: input.eventId,
    learningProposalId: proposal.id,
    type: LearningProposalEventType.CONFIRMED,
    at: input.at,
    actor: decidedBy,
    payload: {
      proposalType: proposal.proposalType,
      domain: proposal.domain,
      reason: input.reason,
    },
    dedupeKey: `learning_confirmed:${proposal.id}`,
  };

  const learnedContext: LearnedContextRecord = {
    id: asLearnedContextRecordId(`learned-context-${proposal.id}`),
    learningProposalId: proposal.id,
    principalId: proposal.principalId,
    domain: proposal.domain,
    proposalType: proposal.proposalType,
    content: proposal.content,
    confirmedAt: input.at,
    confirmedBy: decidedBy,
    contentHash: proposal.contentHash,
  };

  return ok({ updated, event, learnedContext });
}

/**
 * Reject a PROPOSED learning proposal. No LearnedContextRecord is written.
 */
export function rejectLearningProposal(
  proposal: LearningProposal,
  input: {
    readonly decidedBy: string;
    readonly at: string;
    readonly reason?: string;
    readonly eventId: string;
  },
): Result<{
  readonly updated: LearningProposal;
  readonly event: LearningProposalEvent;
}> {
  if (proposal.status === LearningStatus.EXPIRED) {
    return err(ErrorCode.LEARNING_PROPOSAL_EXPIRED, "Learning proposal has expired");
  }
  if (proposal.status !== LearningStatus.PROPOSED) {
    return err(ErrorCode.LEARNING_PROPOSAL_NOT_PENDING, "Learning proposal already decided", {
      status: proposal.status,
    });
  }
  if (proposal.expiresAt && Date.parse(input.at) > Date.parse(proposal.expiresAt)) {
    return err(ErrorCode.LEARNING_PROPOSAL_EXPIRED, "Learning proposal has expired");
  }

  const decidedBy = asPrincipalId(input.decidedBy);
  const updated = withHash({
    ...proposal,
    status: LearningStatus.REJECTED,
    decidedAt: input.at,
    decidedBy,
    reason: input.reason,
  });

  const event: LearningProposalEvent = {
    id: input.eventId,
    learningProposalId: proposal.id,
    type: LearningProposalEventType.REJECTED,
    at: input.at,
    actor: decidedBy,
    payload: {
      proposalType: proposal.proposalType,
      domain: proposal.domain,
      reason: input.reason,
    },
    dedupeKey: `learning_rejected:${proposal.id}`,
  };

  return ok({ updated, event });
}

import {
  AuthorityDecision,
  ErrorCode,
  err,
  ok,
  type CapabilityScope,
  type IntentState,
  type LearnedContextRecord,
  type PreferenceRecord,
  type Result,
  type TrustSignal,
  type WorkflowRule,
} from "@truemandate/protocol";
import { DECISION_RANK, isCapabilityScopeSubset } from "./capability-subset.js";

const PROTECTED_CONCEPTS = new Set([
  "budget",
  "quantity",
  "merchant",
  "deadline",
  "capability",
  "authority",
]);
const WEAK_TRUST_THRESHOLD = 0.5;

export interface AdaptiveTrustInput {
  readonly learnedContext: LearnedContextRecord;
  readonly trustSignal: TrustSignal;
}

export interface AdaptiveAuthorityActionShape {
  readonly refundable?: boolean;
  readonly deliveryTerms?: string;
}

export interface AdaptiveAuthorityInputs {
  readonly baselineDecision: AuthorityDecision;
  readonly currentIntentState: Pick<IntentState, "constraints">;
  readonly currentScope: CapabilityScope;
  readonly action: AdaptiveAuthorityActionShape;
  readonly agentTrust?: AdaptiveTrustInput;
  readonly counterpartyTrust?: AdaptiveTrustInput;
  readonly preferences: readonly PreferenceRecord[];
  readonly workflowRules: readonly WorkflowRule[];
}

export interface AdaptiveAuthorityAppliedSignals {
  readonly agentTrustContextId?: string;
  readonly counterpartyTrustContextId?: string;
  readonly weakTrustSubjects: readonly string[];
  readonly preferenceRecordIds: readonly string[];
  readonly workflowRuleIds: readonly string[];
}

export interface AdaptiveAuthorityResult {
  readonly decision: AuthorityDecision;
  readonly reasons: readonly string[];
  readonly appliedSignals: AdaptiveAuthorityAppliedSignals;
}

function conceptExplicitlySpecified(
  state: Pick<IntentState, "constraints">,
  concept: string,
): boolean {
  return (state.constraints ?? []).some(
    (constraint) => constraint.concept === concept,
  );
}

function isProtectedConcept(concept: string): boolean {
  return PROTECTED_CONCEPTS.has(concept.trim().toLowerCase());
}

function tightenToMonitoring(decision: AuthorityDecision): AuthorityDecision {
  return decision === AuthorityDecision.ALLOW
    ? AuthorityDecision.ALLOW_WITH_MONITORING
    : decision;
}

function tightenToApproval(decision: AuthorityDecision): AuthorityDecision {
  return decision === AuthorityDecision.ALLOW ||
    decision === AuthorityDecision.ALLOW_WITH_MONITORING
    ? AuthorityDecision.REQUIRE_APPROVAL
    : decision;
}

function extractWorkflowRuleValue(rule: WorkflowRule): unknown {
  const action = rule.action;
  if (action === null || action === undefined) return undefined;
  if (typeof action !== "object") return action;
  const record = action as Record<string, unknown>;
  if ("prefer" in record) return record.prefer;
  if ("value" in record) return record.value;
  if ("refundable" in record) return record.refundable;
  if ("deliveryTerms" in record) return record.deliveryTerms;
  return undefined;
}

function preferenceMismatch(
  concept: string,
  action: AdaptiveAuthorityActionShape,
  preference: PreferenceRecord,
): boolean {
  if (concept === "refundable") {
    return typeof action.refundable === "boolean" &&
      typeof preference.value === "boolean" &&
      action.refundable !== preference.value;
  }
  if (concept === "delivery_terms") {
    return typeof action.deliveryTerms === "string" &&
      typeof preference.value === "string" &&
      action.deliveryTerms !== preference.value;
  }
  return false;
}

function workflowRuleMismatch(
  concept: string,
  action: AdaptiveAuthorityActionShape,
  rule: WorkflowRule,
): boolean {
  const expected = extractWorkflowRuleValue(rule);
  if (concept === "refundable") {
    return typeof action.refundable === "boolean" &&
      typeof expected === "boolean" &&
      action.refundable !== expected;
  }
  if (concept === "delivery_terms") {
    return typeof action.deliveryTerms === "string" &&
      typeof expected === "string" &&
      action.deliveryTerms !== expected;
  }
  return false;
}

export function assertAdaptiveAuthorityDominance(input: {
  readonly baselineDecision: AuthorityDecision;
  readonly finalDecision: AuthorityDecision;
  readonly currentScope: CapabilityScope;
  readonly proposedScope?: CapabilityScope;
}): Result<void> {
  if (DECISION_RANK[input.finalDecision] > DECISION_RANK[input.baselineDecision]) {
    return err(
      ErrorCode.REPUTATION_CANNOT_OVERRIDE_POLICY,
      "Adaptive signals cannot make Authority more permissive than the fused baseline",
      {
        baselineDecision: input.baselineDecision,
        finalDecision: input.finalDecision,
      },
    );
  }
  if (input.proposedScope) {
    const subset = isCapabilityScopeSubset(input.proposedScope, input.currentScope);
    if (!subset.ok) {
      return err(
        ErrorCode.REPUTATION_CANNOT_OVERRIDE_POLICY,
        "Adaptive signals cannot expand capability bounds",
        subset.details,
      );
    }
  }
  return ok();
}

export function composeAdaptiveAuthorityDecision(
  input: AdaptiveAuthorityInputs,
): Result<AdaptiveAuthorityResult> {
  const baseline = input.baselineDecision;
  if (
    baseline === AuthorityDecision.BLOCK ||
    baseline === AuthorityDecision.REQUIRE_APPROVAL
  ) {
    return ok({
      decision: baseline,
      reasons: [],
      appliedSignals: {
        weakTrustSubjects: [],
        preferenceRecordIds: [],
        workflowRuleIds: [],
      },
    });
  }

  let decision: AuthorityDecision = baseline;
  const reasons: string[] = [];
  const weakTrustSubjects: string[] = [];
  const preferenceRecordIds = new Set<string>();
  const workflowRuleIds = new Set<string>();
  let agentTrustContextId: string | undefined;
  let counterpartyTrustContextId: string | undefined;

  const trusts = [
    input.agentTrust
      ? {
          key: "agent" as const,
          subject: `agent:${input.agentTrust.trustSignal.subjectId}`,
          value: input.agentTrust,
        }
      : undefined,
    input.counterpartyTrust
      ? {
          key: "counterparty" as const,
          subject: `counterparty:${input.counterpartyTrust.trustSignal.subjectId}`,
          value: input.counterpartyTrust,
        }
      : undefined,
  ].filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);

  for (const trust of trusts) {
    if (trust.value.trustSignal.value < WEAK_TRUST_THRESHOLD) {
      weakTrustSubjects.push(trust.subject);
      if (trust.key === "agent") {
        agentTrustContextId = trust.value.learnedContext.id;
      } else {
        counterpartyTrustContextId = trust.value.learnedContext.id;
      }
    }
  }

  let workflowRuleTightened = false;

  for (const concept of ["refundable", "delivery_terms"] as const) {
    if (
      isProtectedConcept(concept) ||
      conceptExplicitlySpecified(input.currentIntentState, concept)
    ) {
      continue;
    }

    const conceptRules = input.workflowRules.filter((rule) => rule.concept === concept);
    const mismatchedRule = conceptRules.find((rule) =>
      workflowRuleMismatch(concept, input.action, rule),
    );
    if (mismatchedRule) {
      decision = tightenToApproval(decision);
      workflowRuleIds.add(mismatchedRule.id);
      reasons.push(`confirmed workflow rule mismatch for ${concept}`);
      workflowRuleTightened = true;
      continue;
    }

    const conceptPreferences = input.preferences.filter(
      (preference) => preference.concept === concept,
    );
    const mismatchedPreference = conceptPreferences.find((preference) =>
      preferenceMismatch(concept, input.action, preference),
    );
    if (mismatchedPreference && baseline === AuthorityDecision.ALLOW) {
      decision = tightenToMonitoring(decision);
      preferenceRecordIds.add(mismatchedPreference.id);
      reasons.push(`confirmed preference mismatch for ${concept}`);
    }
  }

  if (weakTrustSubjects.length >= 2) {
    decision = tightenToApproval(decision);
    reasons.push("multiple weak confirmed trust signals require approval");
  } else if (weakTrustSubjects.length === 1) {
    if (baseline === AuthorityDecision.ALLOW_WITH_MONITORING) {
      decision = tightenToApproval(decision);
      reasons.push("weak confirmed trust signal escalates monitoring to approval");
    } else if (!workflowRuleTightened) {
      decision = tightenToMonitoring(decision);
      reasons.push("weak confirmed trust signal requires monitoring");
    }
  }

  if (
    baseline === AuthorityDecision.ALLOW_WITH_MONITORING &&
    workflowRuleTightened
  ) {
    decision = AuthorityDecision.REQUIRE_APPROVAL;
  }

  const dominance = assertAdaptiveAuthorityDominance({
    baselineDecision: baseline,
    finalDecision: decision,
    currentScope: input.currentScope,
  });
  if (!dominance.ok) return dominance;

  return ok({
    decision,
    reasons,
    appliedSignals: {
      agentTrustContextId,
      counterpartyTrustContextId,
      weakTrustSubjects,
      preferenceRecordIds: [...preferenceRecordIds],
      workflowRuleIds: [...workflowRuleIds],
    },
  });
}

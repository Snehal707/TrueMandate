/**
 * Allowlists for read-model view DTOs. Unknown keys (including future fields
 * and nested secrets) must not leak into UI projections.
 */

export const VIEW_KEY_ALLOWLISTS = {
  IntentSummaryView: [
    "intentId",
    "rawIntent",
    "principalId",
    "createdAt",
    "intentStateId",
    "intentStateVersion",
    "stateHash",
    "readiness",
    "ambiguityClass",
    "historicalStateIds",
  ],
  ConstraintView: [
    "id",
    "concept",
    "operator",
    "expectedValue",
    "criticality",
    "meaningClass",
    "sourceText",
    "sourceSpan",
    "status",
    "transformation",
    "criticalFailure",
    "modelName",
    "promptVersion",
    "groundingStatus",
  ],
  SemanticStateView: ["intentId", "constraints", "rawIntent"],
  PlanStepView: [
    "id",
    "objective",
    "agent",
    "commitmentLevel",
    "status",
    "coverage",
    "deferred",
    "irrelevant",
    "requiredConstraints",
    "proofObligations",
    "delegatedCapabilities",
  ],
  PlanView: ["planId", "steps"],
  JudgeView: [
    "judgeId",
    "status",
    "findings",
    "affectedConstraints",
    "confidence",
    "modelName",
    "promptVersion",
    "schemaVersion",
  ],
  GuardianView: ["judges", "aggregator"],
  AuthorityView: [
    "guardianRecommendation",
    "semanticGate",
    "decision",
    "capability",
    "principalId",
    "agentId",
    "merchant",
    "amount",
    "currency",
    "expiresAt",
    "cumulativeExposure",
    "approvalState",
    "grantState",
    "revocationState",
    "explanation",
  ],
  ExecutionView: [
    "phase",
    "stopReason",
    "preparedAction",
    "sideEffects",
    "unknownPending",
    "reservedExposure",
    "blockedRetry",
  ],
  OutcomeRequirementView: [
    "concept",
    "criticality",
    "state",
    "observed",
    "expected",
    "display",
  ],
  OutcomeView: [
    "contractId",
    "contractState",
    "paymentStatus",
    "requirements",
    "atRisk",
    "missingEvidence",
    "conflicts",
  ],
  RemedyOptionView: [
    "id",
    "description",
    "restorationValue",
    "financialCost",
    "timeCost",
    "criticalConstraintsPreserved",
    "reversibility",
    "authorityRequired",
    "risks",
  ],
  ResolutionView: [
    "caseId",
    "state",
    "triggerIdentity",
    "firstDivergence",
    "responsibilityState",
    "hypotheses",
    "evidenceRequests",
    "remedies",
    "blameHonest",
  ],
  ProvenanceNodeView: ["id", "kind", "label", "trustClass", "tainted", "taintClasses"],
  ProvenanceEdgeView: ["id", "from", "to", "relation"],
  ProvenanceGraphView: ["nodes", "edges", "activeFilter", "traceToHuman"],
  TimelineEventView: [
    "id",
    "type",
    "at",
    "actor",
    "summary",
    "relatedObjectIds",
    "reasonCode",
    "hashes",
    "dedupeKey",
  ],
  TimelineView: ["events"],
  IntentWorkspaceView: [
    "summary",
    "semantic",
    "plan",
    "guardian",
    "authority",
    "execution",
    "outcome",
    "resolution",
    "graph",
    "timeline",
  ],
} as const;

export type ViewAllowlistName = keyof typeof VIEW_KEY_ALLOWLISTS;

/**
 * Return a shallow copy containing only allowlisted own keys.
 */
export function pickAllowlisted<T extends Record<string, unknown>>(
  obj: T,
  allowlist: readonly string[],
): Partial<T> {
  const allowed = new Set(allowlist);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (allowed.has(k)) out[k] = v;
  }
  return out as Partial<T>;
}

/**
 * Deeply assert that every object key at any nesting depth is in the allowlist
 * (arrays recurse into elements; non-objects are ignored).
 */
export function assertNoUnknownViewKeys(
  view: unknown,
  allowlist: readonly string[],
): void {
  const allowed = new Set(allowlist);
  walk(view, allowed, "");
}

function walk(value: unknown, allowed: ReadonlySet<string>, path: string): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, allowed, `${path}[${i}]`));
    return;
  }
  if (typeof value !== "object") return;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const here = path ? `${path}.${k}` : k;
    if (!allowed.has(k)) {
      throw new Error(`Unexpected view key at ${here}`);
    }
    walk(v, allowed, here);
  }
}

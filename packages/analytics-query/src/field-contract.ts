/**
 * Documented payload field contract for Wave 3.4 / 3.5 / 3.6 cross-workflow
 * queries.
 *
 * Wave 3.3 stores CloudEventEnvelope payloads as opaque JSON. These field
 * paths are what analytics queries read via JSON_VALUE / in-memory parse.
 *
 * Wave 3.5 publishers emit the producible fields below (fail-open,
 * off-by-default via TM_GOVERNANCE_EVENTS_MODE).
 *
 * Wave 3.6 adds two real, deterministic producers:
 * - `concept` on intent.events CONSTRAINT_WEAKENED: emitted by
 *   IntentService.createIntentState() from a pure structural comparison
 *   (detectWeakenedConstraints) between the previous and new IntentState's
 *   constraints — never inferred from model output.
 * - `remedyType` on resolution.events REMEDY_COMPLETED: the deterministic
 *   RemedyOption.kind taxonomy already computed by resolution-core's
 *   remedy planner, now surfaced on RemedyProposal.remedyType and emitted
 *   only when a RemedyProposal is actually bound to the resolved case's
 *   mandate.
 *
 * Both remain intentionally absent when the runtime cannot determine them
 * deterministically (see UNAVAILABLE_ANALYTICS_FIELDS notes for residual
 * gaps) — do not fabricate.
 */
export const AnalyticsPayloadField = {
  /** Constraint concept being weakened / drifted. */
  CONCEPT: "concept",
  /** Authority / Guardian decision (ALLOW, BLOCK, REQUIRE_APPROVAL, …). */
  DECISION: "decision",
  /** Counterparty / merchant identity on outcome events. */
  MERCHANT: "merchant",
  /** Ambiguity class at plan time (A0–A4). */
  AMBIGUITY_CLASS: "ambiguityClass",
  /** Remedy type on resolution events. */
  REMEDY_TYPE: "remedyType",
  /** Whether a remedy restored original intent. */
  RESTORED: "restored",
  /** Optional agent id when present on guardian/authority events. */
  AGENT_ID: "agentId",
} as const;

export const AnalyticsEventType = {
  DRIFT_DETECTED: "DRIFT_DETECTED",
  CONSTRAINT_WEAKENED: "CONSTRAINT_WEAKENED",
  GUARDIAN_VERDICT: "GUARDIAN_VERDICT",
  AUTHORITY_DECISION: "AUTHORITY_DECISION",
  OUTCOME_PARTIAL: "OUTCOME_PARTIAL",
  OUTCOME_BREACHED: "OUTCOME_BREACHED",
  OUTCOME_SATISFIED: "OUTCOME_SATISFIED",
  PLAN_CREATED: "PLAN_CREATED",
  REMEDY_COMPLETED: "REMEDY_COMPLETED",
} as const;

export const AnalyticsTopic = {
  INTENT: "intent.events",
  SEMANTIC: "semantic.events",
  PLAN: "plan.events",
  GUARDIAN: "guardian.events",
  AUTHORITY: "authority.events",
  OUTCOME: "outcome.events",
  RESOLUTION: "resolution.events",
} as const;

/**
 * Residual fields that remain intentionally unavailable after Wave 3.6.
 * - concept on semantic.events: no runtime service constructs a
 *   SemanticVerification-stage drift/weakening producer yet (only the
 *   IntentState-transition producer on intent.events exists). Do not
 *   fabricate a semantic.events emission for a comparison that isn't made.
 * - remedyType is only emitted when a RemedyProposal was actually bound to
 *   the resolved case via an issued RemediationMandate (e.g. variance-only
 *   closures with no remedy ever proposed/bound omit it).
 */
export const UNAVAILABLE_ANALYTICS_FIELDS = [
  {
    field: AnalyticsPayloadField.CONCEPT,
    topics: [AnalyticsTopic.SEMANTIC],
    reason:
      "No runtime service performs semantic-verification-stage drift comparison; only the IntentState-transition producer (intent.events) exists.",
  },
  {
    field: AnalyticsPayloadField.REMEDY_TYPE,
    topics: [AnalyticsTopic.RESOLUTION],
    reason:
      "Only emitted when a RemedyProposal is bound to the resolved case's mandate; cases resolved without ever proposing/binding a remedy correctly omit it.",
  },
] as const;

/** Contract rows used by tests and docs — fields that producers MUST emit when known. */
export const FIELD_CONTRACT = [
  {
    topic: AnalyticsTopic.INTENT,
    eventTypes: [
      AnalyticsEventType.DRIFT_DETECTED,
      AnalyticsEventType.CONSTRAINT_WEAKENED,
    ],
    fields: [AnalyticsPayloadField.CONCEPT],
    query: "weakenedConstraints",
    /** Wave 3.6: real producer in IntentService.createIntentState(). */
    producerStatus: "wired" as const,
  },
  {
    topic: AnalyticsTopic.SEMANTIC,
    eventTypes: [
      AnalyticsEventType.DRIFT_DETECTED,
      AnalyticsEventType.CONSTRAINT_WEAKENED,
    ],
    fields: [AnalyticsPayloadField.CONCEPT],
    query: "weakenedConstraints",
    producerStatus: "unavailable" as const,
  },
  {
    topic: AnalyticsTopic.GUARDIAN,
    eventTypes: [AnalyticsEventType.GUARDIAN_VERDICT],
    fields: [AnalyticsPayloadField.DECISION, AnalyticsPayloadField.AGENT_ID],
    query: "guardianInterventionAgents",
    producerStatus: "wired" as const,
  },
  {
    topic: AnalyticsTopic.OUTCOME,
    eventTypes: [
      AnalyticsEventType.OUTCOME_PARTIAL,
      AnalyticsEventType.OUTCOME_BREACHED,
      AnalyticsEventType.OUTCOME_SATISFIED,
    ],
    fields: [AnalyticsPayloadField.MERCHANT],
    query: "counterpartyOutcomeCorrelation",
    producerStatus: "wired" as const,
  },
  {
    topic: AnalyticsTopic.PLAN,
    eventTypes: [AnalyticsEventType.PLAN_CREATED],
    fields: [AnalyticsPayloadField.AMBIGUITY_CLASS],
    query: "ambiguityBlockedCorrelation",
    producerStatus: "wired" as const,
  },
  {
    topic: AnalyticsTopic.AUTHORITY,
    eventTypes: [AnalyticsEventType.AUTHORITY_DECISION],
    fields: [AnalyticsPayloadField.DECISION],
    query: "ambiguityBlockedCorrelation",
    producerStatus: "wired" as const,
  },
  {
    topic: AnalyticsTopic.RESOLUTION,
    eventTypes: [AnalyticsEventType.REMEDY_COMPLETED],
    // `restored` is always present. `remedyType` (Wave 3.6) is present
    // whenever a RemedyProposal was bound to the case's mandate — the
    // remedyRestorationRate query groups only rows where it is set, so
    // cases resolved without a bound remedy are correctly excluded rather
    // than fabricated into a bucket.
    fields: [AnalyticsPayloadField.RESTORED],
    query: "remedyRestorationRate",
    producerStatus: "partial" as const,
  },
] as const;

export function parsePayload(
  payload: string | Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  if (typeof payload === "string") {
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }
  return { ...payload };
}

export function payloadString(
  payload: Record<string, unknown>,
  field: string,
): string | undefined {
  const v = payload[field];
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

export function payloadBool(
  payload: Record<string, unknown>,
  field: string,
): boolean | undefined {
  const v = payload[field];
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined;
}

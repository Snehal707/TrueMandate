/**
 * LIVE PROOF STAGE RAIL — pure derivation.
 *
 * Maps the real public lifecycle response onto seven judge-readable stages.
 * There is no playback and no simulation here: a stage is only `done` when the
 * corresponding artifact is actually present in a backend response.
 *
 * `active` is the one status not derived from a backend artifact. It means the
 * client currently has a request in flight — a fact about this browser, not a
 * claim that the backend reported that stage. It is labelled accordingly.
 */

export type RailStatus = "done" | "active" | "waiting" | "blocked" | "not-reached";

export type RailStageId =
  | "intent"
  | "verification"
  | "planning"
  | "guardian"
  | "authority"
  | "execution"
  | "provenance";

export interface RailStage {
  readonly id: RailStageId;
  readonly label: string;
  /** Plain-language line shown before any technical detail. */
  readonly plain: string;
  readonly status: RailStatus;
  /** Real backend value backing this stage, when one has been returned. */
  readonly detail?: string;
}

/** What the rail needs from a live run. Structural, so tests need no SDK types. */
export interface RailInput {
  readonly hasRun: boolean;
  readonly intentId?: string;
  readonly intentStateId?: string;
  readonly workspacePresent: boolean;
  readonly artifactsPresent: boolean;
  readonly evaluationPresent: boolean;
  /** `workspace.guardian.aggregator.decision` — the real Guardian artifact. */
  readonly guardianDecision?: string;
  readonly guardianSemanticStatus?: string;
  /**
   * `workspace.authority.decision` ONLY. The overall workflow state is never an
   * Authority artifact: BLOCKED is reachable from any stage, so treating it as
   * one made the rail claim Authority had returned when it was never reached.
   */
  readonly authorityDecision?: string;
  readonly workflowState?: string;
  readonly executionPhase?: string;
  readonly executionStatus?: string;
  readonly outcomePresent: boolean;
  readonly outcomeState?: string;
  readonly resolutionPresent: boolean;
  readonly evidenceCount: number;
  /** True while this client has a create/refresh request outstanding. */
  readonly requestInFlight: boolean;
  readonly errorCode?: string;
}

export type FailureClass = "governance-refusal" | "verification-unavailable" | "request-failure";

export interface FailurePresentation {
  readonly kind: FailureClass;
  readonly headline: string;
  readonly explanation: string;
  /** Every class asserts this: a refusal is never an unsafe execution. */
  readonly economicEffect: "No economic action was taken.";
}

/** Model/verification could not run. Fail-closed, but not a governance verdict. */
const VERIFICATION_UNAVAILABLE = new Set([
  "MODEL_UNAVAILABLE",
  "MODEL_OUTPUT_INVALID",
  "SCHEMA_PARSE_FAILED",
  "GUARDIAN_VERDICT_REQUIRED",
]);

/** Transport / request shape problems — not a governance decision at all. */
const REQUEST_FAILURE = new Set(["VALIDATION_FAILED", "LIVE_DEMO_ERROR"]);

/** Workflow states that mean the governed path stopped deliberately. */
const BLOCKED_WORKFLOW_STATES = new Set(["BLOCKED", "DENIED", "REJECTED"]);

/**
 * Guardian values that report an absence rather than deliver a verdict. A
 * Guardian record reading UNAVAILABLE is where the run stopped, not a stage it
 * completed, so it must not count as a returned judgment.
 */
export const GUARDIAN_UNUSABLE = new Set(["UNAVAILABLE", "UNKNOWN", "ERROR", "INDETERMINATE"]);

export function guardianVerdictIsUsable(decision?: string): boolean {
  return Boolean(decision) && !GUARDIAN_UNUSABLE.has(decision!.toUpperCase());
}

export function classifyFailure(errorCode?: string): FailurePresentation | undefined {
  if (!errorCode) return undefined;
  if (VERIFICATION_UNAVAILABLE.has(errorCode)) {
    return {
      kind: "verification-unavailable",
      headline: "Execution stopped because required verification could not be completed.",
      explanation:
        "A required model or Guardian judgment was unavailable, so TrueMandate refused to proceed rather than acting without it. This is a provider availability limit, not an unsafe execution.",
      economicEffect: "No economic action was taken.",
    };
  }
  if (REQUEST_FAILURE.has(errorCode)) {
    return {
      kind: "request-failure",
      headline: "The request could not be completed.",
      explanation:
        "The call to the public API did not succeed. Nothing was authorized and no workflow advanced.",
      economicEffect: "No economic action was taken.",
    };
  }
  return {
    kind: "governance-refusal",
    headline: "TrueMandate refused this action.",
    explanation:
      "A governance requirement was not satisfied, so the action was blocked before any privileged step could run.",
    economicEffect: "No economic action was taken.",
  };
}

function isBlockingFailure(errorCode?: string): boolean {
  const failure = classifyFailure(errorCode);
  return failure?.kind === "governance-refusal" || failure?.kind === "verification-unavailable";
}

interface StageSeed {
  readonly id: RailStageId;
  readonly label: string;
  readonly plain: string;
  readonly done: boolean;
  readonly detail?: string;
}

function seeds(input: RailInput): readonly StageSeed[] {
  // An Authority artifact, or a workflow state that is only reachable *through*
  // Authority. Blocked states are deliberately excluded: a workflow can be
  // BLOCKED at verification, planning, or Guardian without Authority ever running.
  const authorityKnown = Boolean(input.authorityDecision) ||
    input.workflowState === "AUTHORIZED" ||
    input.workflowState === "AWAITING_APPROVAL";

  // A Guardian record saying "UNAVAILABLE" is a report of absence, not a verdict.
  const guardianReturned = guardianVerdictIsUsable(input.guardianDecision) ||
    (input.evaluationPresent && !input.guardianDecision);

  const guardianDetail = input.guardianDecision
    ? input.guardianSemanticStatus
      ? `${input.guardianDecision} · ${input.guardianSemanticStatus}`
      : input.guardianDecision
    : undefined;

  return [
    {
      id: "intent",
      label: "Intent",
      plain: "The human request, recorded immutably.",
      done: input.hasRun,
      ...(input.intentId ? { detail: input.intentId } : {}),
    },
    {
      id: "verification",
      label: "Verification",
      plain: "What the request actually means, checked before anything can act on it.",
      done: input.workspacePresent || Boolean(input.intentStateId),
      ...(input.intentStateId
        ? { detail: input.intentStateId }
        : input.evidenceCount > 0
          ? { detail: `${input.evidenceCount} evidence submission(s)` }
          : {}),
    },
    {
      id: "planning",
      label: "Planning",
      plain: "The proposed steps, checked back against the verified intent.",
      done: input.artifactsPresent,
      ...(input.artifactsPresent ? { detail: "Plan artifacts returned" } : {}),
    },
    {
      id: "guardian",
      label: "Guardian",
      plain: "Five independent judges review the action before authority is considered.",
      done: guardianReturned,
      ...(guardianDetail ? { detail: guardianDetail } : {}),
    },
    {
      id: "authority",
      label: "Authority",
      plain: "Was this action actually authorized?",
      done: authorityKnown,
      // Detail comes only from a real Authority decision. The overall workflow
      // state must never be printed here as though Authority had returned it.
      ...(input.authorityDecision ? { detail: input.authorityDecision } : {}),
    },
    {
      id: "execution",
      label: "Execution",
      plain: "Whether the governed action ran, and exactly once.",
      done: Boolean(input.executionStatus),
      ...(input.executionStatus ? { detail: input.executionStatus } : {}),
    },
    {
      id: "provenance",
      label: "Provenance",
      plain: "What evidence proves what happened?",
      done: input.outcomePresent || input.resolutionPresent,
      ...(input.outcomeState
        ? { detail: input.outcomeState }
        : input.resolutionPresent
          ? { detail: "Resolution case open" }
          : {}),
    },
  ];
}

/**
 * Derive the rail. Deterministic: identical input always yields identical output.
 */
export function deriveStageRail(input: RailInput): readonly RailStage[] {
  const rows = seeds(input);
  const blocked = BLOCKED_WORKFLOW_STATES.has(input.workflowState ?? "") ||
    input.executionPhase === "BLOCKED" ||
    isBlockingFailure(input.errorCode);

  // The first stage without a returned artifact is where the run currently sits.
  const frontierIndex = rows.findIndex((row) => !row.done);

  return rows.map((row, index) => {
    if (row.done) return { ...row, status: "done" as const };
    if (index === frontierIndex && blocked) return { ...row, status: "blocked" as const };
    if (index === frontierIndex && input.requestInFlight) {
      return { ...row, status: "active" as const };
    }
    // Past the stopping point of a terminal run, these stages will never occur.
    // Showing them as "waiting" invites the judge to wait for nothing.
    if (blocked) return { ...row, status: "not-reached" as const };
    return { ...row, status: "waiting" as const };
  });
}

const STATUS_LABELS: Readonly<Record<RailStatus, string>> = {
  done: "Returned",
  active: "Working…",
  waiting: "Waiting",
  blocked: "Stopped here",
  "not-reached": "Not reached",
};

export function railStatusLabel(status: RailStatus): string {
  return STATUS_LABELS[status];
}

/**
 * Summary line for the rail header — derived, never asserted. The counts add up
 * to the full rail so a judge can see nothing has been quietly omitted.
 */
export function railProgressLabel(stages: readonly RailStage[]): string {
  const done = stages.filter((stage) => stage.status === "done").length;
  const notReached = stages.filter((stage) => stage.status === "not-reached").length;
  const blocked = stages.find((stage) => stage.status === "blocked");
  if (blocked) {
    const tail = notReached > 0 ? ` · ${notReached} not reached` : "";
    return `Stopped at ${blocked.label} · ${done} returned${tail}`;
  }
  const active = stages.find((stage) => stage.status === "active");
  if (active) return `${active.label} in progress · ${done} of ${stages.length} stages returned`;
  return `${done} of ${stages.length} stages returned`;
}

/**
 * LIVE PROOF RESULT SUMMARY — pure derivation.
 *
 * One question, answered from returned artifacts only: what actually happened to
 * this workflow? The rail, the Governance Report preamble, and the provenance
 * lead sentence all read this, so they cannot drift apart.
 *
 * The governing rule is that absence is not evidence. A missing Authority
 * artifact means "not reached", never "denied". A missing execution artifact
 * means we cannot speak to side effects, never "zero side effects". Only a
 * returned `sideEffects` array of length 0 licenses the ZERO claim.
 */

import { classifyFailure, guardianVerdictIsUsable } from "./live-stage-rail";

export { guardianVerdictIsUsable };

export type RunOutcomeClass =
  | "authorized-executed"
  | "authorized-pending"
  | "awaiting-approval"
  | "blocked-by-governance"
  | "stopped-unavailable"
  | "in-progress"
  | "request-failed"
  | "no-run";

export type EconomicEffectValue = "ZERO" | "RECORDED" | "UNKNOWN";

export interface EconomicEffect {
  readonly value: EconomicEffectValue;
  readonly statement: string;
}

/** A fact, plus the returned value backing it when one exists. */
export interface RunSummaryFact {
  readonly label: string;
  readonly detail?: string;
}

export interface RunSummary {
  readonly headline: string;
  readonly outcomeClass: RunOutcomeClass;
  /** True when nothing further can happen without a new workflow. */
  readonly terminal: boolean;
  readonly reason?: string;
  /** Which returned artifact the reason came from. */
  readonly reasonSource?: string;
  readonly succeeded: readonly RunSummaryFact[];
  readonly didNotHappen: readonly RunSummaryFact[];
  readonly economicEffect: EconomicEffect;
}

/** Structural, so tests need no SDK types. Mirrors `RailInput`. */
export interface RunSummaryInput {
  readonly hasRun: boolean;
  readonly workflowState?: string;
  readonly workspacePresent: boolean;
  readonly intentId?: string;
  readonly intentStateId?: string;
  readonly constraintsTotal?: number;
  readonly constraintsWithoutCriticalFailure?: number;
  readonly planStepCount?: number;
  readonly planArtifactsPresent: boolean;
  readonly guardianDecision?: string;
  readonly guardianSemanticStatus?: string;
  readonly guardianCriticalFailure?: boolean;
  /** `workspace.authority.decision` only. Never the overall workflow state. */
  readonly authorityDecision?: string;
  readonly authorityExplanation?: string;
  readonly approvalStatus?: string;
  readonly executionPhase?: string;
  readonly executionStopReason?: string;
  readonly executionStatus?: string;
  /** `workspace.execution.sideEffects.length`. Undefined when not returned. */
  readonly sideEffectCount?: number;
  readonly outcomePresent: boolean;
  readonly outcomeState?: string;
  readonly resolutionPresent: boolean;
  readonly requestInFlight: boolean;
  readonly errorCode?: string;
}

/** Authority decisions that actually grant. */
const AUTHORITY_GRANTING = new Set(["ALLOW", "ALLOWED", "GRANT", "GRANTED", "AUTHORIZE", "AUTHORIZED"]);

const TERMINAL_WORKFLOW_STATES = new Set(["BLOCKED", "DENIED", "REJECTED"]);

export function authorityGranted(decision?: string): boolean {
  return Boolean(decision) && AUTHORITY_GRANTING.has(decision!.toUpperCase());
}

function isTerminal(input: RunSummaryInput): boolean {
  if (TERMINAL_WORKFLOW_STATES.has(input.workflowState ?? "")) return true;
  if (input.executionPhase === "BLOCKED") return true;
  const failure = classifyFailure(input.errorCode);
  return failure?.kind === "governance-refusal" || failure?.kind === "verification-unavailable";
}

/**
 * Why the run stopped. Preference order is strictly most-authoritative-first, and
 * every branch is a returned value or a fixed sentence about a returned value.
 */
function deriveReason(
  input: RunSummaryInput,
): { readonly reason: string; readonly reasonSource: string } | undefined {
  if (input.executionStopReason) {
    return { reason: input.executionStopReason, reasonSource: "execution.stopReason" };
  }
  if (input.guardianDecision && !guardianVerdictIsUsable(input.guardianDecision)) {
    const status = input.guardianSemanticStatus ? ` Semantic status was ${input.guardianSemanticStatus}.` : "";
    return {
      reason: `Required Guardian judgment was ${input.guardianDecision}.${status}`,
      reasonSource: "guardian.aggregator",
    };
  }
  if (input.guardianCriticalFailure === true) {
    return {
      reason: "Guardian recorded a critical failure against the verified intent.",
      reasonSource: "guardian.aggregator",
    };
  }
  if (input.authorityDecision && !authorityGranted(input.authorityDecision)) {
    return {
      reason: input.authorityExplanation ?? `Authority returned ${input.authorityDecision}.`,
      reasonSource: "authority.decision",
    };
  }
  const failure = classifyFailure(input.errorCode);
  if (failure) return { reason: failure.explanation, reasonSource: "errorCode" };
  return undefined;
}

function deriveEconomicEffect(input: RunSummaryInput): EconomicEffect {
  if (input.sideEffectCount !== undefined && input.sideEffectCount > 0) {
    return {
      value: "RECORDED",
      statement: `${input.sideEffectCount} recorded side effect${input.sideEffectCount === 1 ? "" : "s"}.`,
    };
  }
  // Zero is only claimable from a returned side-effect list.
  if (input.sideEffectCount === 0) {
    return input.executionStatus
      ? {
          value: "UNKNOWN",
          statement: `Execution reported ${input.executionStatus} but no side effects were recorded. Treated as unresolved rather than zero.`,
        }
      : { value: "ZERO", statement: "No economic action was taken." };
  }
  if (input.executionStatus) {
    return {
      value: "UNKNOWN",
      statement: `Execution reported ${input.executionStatus}. No public side-effect record was returned.`,
    };
  }
  return {
    value: "UNKNOWN",
    statement: "No execution record was returned, so no side-effect claim is made.",
  };
}

function deriveOutcomeClass(input: RunSummaryInput): RunOutcomeClass {
  if (!input.hasRun) return "no-run";
  const failure = classifyFailure(input.errorCode);
  if (failure?.kind === "request-failure") return "request-failed";
  if (input.executionStatus) return "authorized-executed";
  if (input.approvalStatus === "PENDING" || input.workflowState === "AWAITING_APPROVAL") {
    return "awaiting-approval";
  }
  if (isTerminal(input)) {
    // A governance refusal requires an actual refusing artifact. Without one,
    // the run stopped because something was unavailable — not because it was judged.
    const refused =
      Boolean(input.authorityDecision && !authorityGranted(input.authorityDecision)) ||
      input.guardianCriticalFailure === true;
    return refused ? "blocked-by-governance" : "stopped-unavailable";
  }
  if (authorityGranted(input.authorityDecision) || input.workflowState === "AUTHORIZED") {
    return "authorized-pending";
  }
  return "in-progress";
}

const HEADLINES: Readonly<Record<RunOutcomeClass, string>> = {
  "no-run": "No workflow has been created yet",
  "request-failed": "The request never reached the governed pipeline",
  "authorized-executed": "Authorized and executed under governance",
  "authorized-pending": "Authorized — execution not yet committed",
  "awaiting-approval": "Held for human approval before authorization",
  "blocked-by-governance": "Workflow blocked by governance before execution",
  "stopped-unavailable": "Workflow blocked before authorization",
  "in-progress": "Workflow in progress",
};

export function deriveRunSummary(input: RunSummaryInput): RunSummary {
  const outcomeClass = deriveOutcomeClass(input);
  const terminal = isTerminal(input);
  const derivedReason = deriveReason(input);

  const succeeded: RunSummaryFact[] = [];
  const didNotHappen: RunSummaryFact[] = [];

  if (input.intentId) {
    succeeded.push({ label: "Intent recorded", detail: input.intentId });
  } else if (input.hasRun) {
    succeeded.push({ label: "Intent recorded" });
  }

  if (input.intentStateId) {
    const total = input.constraintsTotal ?? 0;
    const clean = input.constraintsWithoutCriticalFailure ?? 0;
    succeeded.push({
      label: "Constraints verified",
      ...(total > 0 ? { detail: `${clean} of ${total} without critical failure` } : {}),
    });
  } else if (input.workspacePresent) {
    didNotHappen.push({ label: "Semantic verification did not produce a verified state" });
  }

  if (input.planArtifactsPresent || (input.planStepCount ?? 0) > 0) {
    succeeded.push({
      label: "Plan created",
      ...(input.planStepCount ? { detail: `${input.planStepCount} step${input.planStepCount === 1 ? "" : "s"}` } : {}),
    });
  } else if (terminal) {
    didNotHappen.push({ label: "No plan was created" });
  }

  if (guardianVerdictIsUsable(input.guardianDecision)) {
    succeeded.push({ label: "Guardian returned a verdict", detail: input.guardianDecision });
  } else if (input.guardianDecision) {
    didNotHappen.push({ label: "Guardian did not return a usable verdict", detail: input.guardianDecision });
  }

  if (authorityGranted(input.authorityDecision)) {
    succeeded.push({ label: "Authority granted", detail: input.authorityDecision });
  } else if (input.authorityDecision) {
    didNotHappen.push({ label: "Authority did not grant", detail: input.authorityDecision });
  } else {
    // No Authority artifact at all — say exactly that, never "denied".
    didNotHappen.push({ label: "Authority was not reached" });
  }

  if (input.executionStatus) {
    succeeded.push({ label: "Execution ran", detail: input.executionStatus });
  } else {
    didNotHappen.push({ label: "The action was not executed" });
  }

  if (input.outcomePresent) {
    succeeded.push({
      label: "Outcome contract created",
      ...(input.outcomeState ? { detail: input.outcomeState } : {}),
    });
  } else {
    didNotHappen.push({ label: "No outcome was created" });
  }

  if (input.resolutionPresent) {
    succeeded.push({ label: "Resolution case opened" });
  }

  return {
    headline: HEADLINES[outcomeClass],
    outcomeClass,
    terminal,
    ...(derivedReason ? { reason: derivedReason.reason, reasonSource: derivedReason.reasonSource } : {}),
    succeeded,
    didNotHappen,
    economicEffect: deriveEconomicEffect(input),
  };
}

/**
 * One sentence describing what this run's audit trail actually proves.
 * Every clause is gated on artifacts that are genuinely present or genuinely absent.
 */
export function provenanceClaim(
  summary: RunSummary,
  recordedNodeCount: number,
): string {
  if (recordedNodeCount === 0) {
    return "No public provenance records have been returned for this workflow yet.";
  }
  const recorded = summary.succeeded.map((fact) => fact.label.toLowerCase());
  const recordedList = recorded.length
    ? recorded.join(", ")
    : "the artifacts returned so far";

  const noAuthority = summary.didNotHappen.some((fact) =>
    fact.label === "Authority was not reached" || fact.label === "Authority did not grant",
  );
  const noExecution = summary.didNotHappen.some((fact) => fact.label === "The action was not executed");

  if (noAuthority && noExecution) {
    return `These ${recordedNodeCount} recorded artifacts show ${recordedList} — and contain no authority grant and no execution record, which is what proves the action was never authorized or performed.`;
  }
  return `These ${recordedNodeCount} recorded artifacts show ${recordedList}, each one a durable record rather than a generated explanation.`;
}

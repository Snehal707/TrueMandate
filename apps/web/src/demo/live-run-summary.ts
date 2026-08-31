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

import { classifyFailure, guardianVerdictIsUsable, type LifecycleView } from "./live-stage-rail";

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
  /**
   * `workspace.lifecycle`, when the backend returned one. Authoritative when
   * present, for exactly the same reason as `RailInput.lifecycle`: it is the
   * backend's own execution-order derivation, not a guess from missing fields.
   */
  readonly lifecycle?: LifecycleView;
}

/** Authority decisions that actually grant. */
const AUTHORITY_GRANTING = new Set(["ALLOW", "ALLOWED", "GRANT", "GRANTED", "AUTHORIZE", "AUTHORIZED"]);

const TERMINAL_WORKFLOW_STATES = new Set(["BLOCKED", "DENIED", "REJECTED"]);

export function authorityGranted(decision?: string): boolean {
  return Boolean(decision) && AUTHORITY_GRANTING.has(decision!.toUpperCase());
}

function isTerminal(input: RunSummaryInput): boolean {
  // The backend's own execution-order derivation, when available: a run is
  // terminal exactly when something actually stopped it.
  if (input.lifecycle) return Boolean(input.lifecycle.blockingStage);
  if (TERMINAL_WORKFLOW_STATES.has(input.workflowState ?? "")) return true;
  if (input.executionPhase === "BLOCKED") return true;
  const failure = classifyFailure(input.errorCode);
  return failure?.kind === "governance-refusal" || failure?.kind === "verification-unavailable";
}

/**
 * Why the run stopped. Preference order is strictly most-authoritative-first, and
 * every branch is a returned value or a fixed sentence about a returned value.
 *
 * `lifecycle.blockingReason` — the backend's own execution-order derivation —
 * takes precedence over every heuristic below. Without it, a plan-verification
 * or missing-proof block fell through every branch here (Guardian had a real,
 * usable verdict; Authority was never reached; there was no error code) and
 * produced no reason at all, or worse, blamed whatever heuristic fired first.
 */
function deriveReason(
  input: RunSummaryInput,
): { readonly reason: string; readonly reasonSource: string } | undefined {
  if (input.lifecycle?.blockingStage) {
    return {
      reason: input.lifecycle.blockingReason ?? `Blocked at ${input.lifecycle.blockingStage}.`,
      reasonSource: `lifecycle.${input.lifecycle.blockingStage}`,
    };
  }
  if (input.executionStopReason) {
    return { reason: input.executionStopReason, reasonSource: "execution.stopReason" };
  }
  if (input.guardianDecision && !guardianVerdictIsUsable(input.guardianDecision)) {
    // Without a lifecycle projection this client cannot tell a genuine Guardian
    // unavailability apart from the legacy placeholder substituted whenever no
    // workflow artifact was ever projected for this run — the exact confusion
    // that once presented every stop, whatever its real cause, as a Guardian
    // failure. A historical or pre-projection response must not be read as a
    // confident Guardian-caused stop.
    return {
      reason: "Lifecycle detail unavailable for this historical run. The stopping stage cannot be confidently attributed.",
      reasonSource: "legacy-workspace-projection",
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
  const executionCompleted = input.lifecycle?.stages.some(
    (stage) => stage.stage === "execution" && stage.status === "COMPLETED",
  ) ?? false;
  if (executionCompleted) return "authorized-executed";
  if (input.approvalStatus === "PENDING" || input.workflowState === "AWAITING_APPROVAL") {
    return "awaiting-approval";
  }
  if (isTerminal(input)) {
    // A governance refusal requires an actual refusing artifact. Without one,
    // the run stopped because something was unavailable — not because it was judged.
    // Every `lifecycle.blockingStage` value names a governance decision to stop
    // (plan verification, missing proof, action fidelity, Guardian, authority
    // eligibility) — never a provider/model unavailability, which surfaces
    // through `errorCode` instead.
    const refused = input.lifecycle
      ? Boolean(input.lifecycle.blockingStage)
      : Boolean(input.authorityDecision && !authorityGranted(input.authorityDecision)) ||
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

  // AUTHORIZED and AWAITING_APPROVAL are only reachable *through* Authority, so
  // they are evidence that it ran even when the decision artifact is not public.
  // BLOCKED is not: it is reachable from any stage, which is the whole bug.
  const authorityRanPerState =
    input.workflowState === "AUTHORIZED" || input.workflowState === "AWAITING_APPROVAL";

  if (authorityGranted(input.authorityDecision)) {
    succeeded.push({ label: "Authority granted", detail: input.authorityDecision });
  } else if (input.authorityDecision) {
    didNotHappen.push({ label: "Authority did not grant", detail: input.authorityDecision });
  } else if (authorityRanPerState) {
    // Name the source, so this never reads as a returned Authority decision.
    succeeded.push({ label: "Authority granted", detail: `workflow state ${input.workflowState}` });
  } else {
    // No Authority artifact at all — say exactly that, never "denied".
    didNotHappen.push({ label: "Authority was not reached" });
  }

  const executionCompleted = input.lifecycle?.stages.some(
    (stage) => stage.stage === "execution" && stage.status === "COMPLETED",
  ) ?? false;
  if (executionCompleted && input.executionStatus) {
    // The only executor this system has ever had is a mock economic adapter —
    // see MockPaymentAdapter in the gateway service. When the backend's own
    // lifecycle confirms execution completed, say so in terms that cannot be
    // mistaken for a real payment, booking, purchase, or shipment.
    const executionLabel =
      input.lifecycle?.stages.find((stage) => stage.stage === "execution")?.status === "COMPLETED"
        ? "Governed mock execution completed"
        : "Execution ran";
    succeeded.push({ label: executionLabel, detail: input.executionStatus });
  } else if (input.executionStatus) {
    didNotHappen.push({
      label: "Execution not yet committed",
      detail: input.executionStatus,
    });
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
 * What the returned artifacts establish about this run — and nothing more.
 *
 * ABSENCE IS NOT EVIDENCE. A missing authority grant or execution result is
 * reported as a missing record, never as proof that authorization or execution
 * did not occur. The stronger claim about economic effect is licensed only by
 * explicit returned evidence: terminal workflow semantics plus a returned
 * side-effect list that is actually empty.
 */
export function provenanceClaim(
  summary: RunSummary,
  recordedNodeCount: number,
): string {
  if (recordedNodeCount === 0) {
    return "No public provenance records have been returned for this workflow.";
  }
  const recorded = summary.succeeded.map((fact) => fact.label.toLowerCase());
  const recordedList = recorded.length
    ? recorded.join(", ")
    : "the artifacts returned so far";

  const sentences = [
    `The public record for this workflow contains ${recordedNodeCount} returned artifacts covering ${recordedList}.`,
  ];

  const missing: string[] = [];
  if (
    summary.didNotHappen.some(
      (fact) => fact.label === "Authority was not reached" || fact.label === "Authority did not grant",
    )
  ) {
    missing.push("no returned authority grant");
  }
  if (summary.didNotHappen.some((fact) => fact.label === "The action was not executed")) {
    missing.push("no returned execution result");
  }
  if (missing.length > 0) {
    // Stated as an absence of records, not as a proven non-occurrence.
    sentences.push(`It contains ${missing.join(" and ")}.`);
  }

  if (summary.terminal && summary.economicEffect.value === "ZERO") {
    sentences.push(
      "The workflow is in a terminal state and the returned side-effect list is empty, so no economic action was taken.",
    );
  }

  return sentences.join(" ");
}

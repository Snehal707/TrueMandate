import type {
  Constraint,
  GuardianVerdict,
  Intent,
  IntentState,
  OutcomeContract,
  PreparedAction,
  ProvenanceEdge,
  ProvenanceNode,
  RemedyProposal,
  ResolutionCase,
  ResponsibilityHypothesis,
  SideEffectRecord,
} from "@truemandate/protocol";
import { redactForUi } from "./redaction.js";
import type {
  AuthorityView,
  ConstraintView,
  ExecutionView,
  GraphFilter,
  GuardianView,
  IntentSummaryView,
  LifecycleStageStatus,
  LifecycleStageView,
  LifecycleView,
  IntentWorkspaceView,
  OutcomeView,
  PlanView,
  ProvenanceGraphView,
  ResolutionView,
  SemanticStateView,
  TimelineEventView,
  TimelineView,
} from "./views.js";

/** Projectors are pure: they never write to canonical stores. */

export function projectIntentSummary(input: {
  readonly intent: Intent;
  readonly tipState?: IntentState;
  readonly historicalStates?: readonly IntentState[];
  readonly readiness?: string;
  readonly ambiguityClass?: string;
}): IntentSummaryView {
  return redactForUi({
    intentId: input.intent.id,
    rawIntent: input.intent.rawText,
    principalId: input.intent.principalId,
    createdAt: input.intent.createdAt,
    intentStateId: input.tipState?.id,
    intentStateVersion: input.tipState?.version,
    stateHash: input.tipState?.stateHash,
    readiness: input.readiness,
    ambiguityClass: input.ambiguityClass,
    historicalStateIds: (input.historicalStates ?? []).map((s) => s.id),
  });
}

export function projectSemanticState(input: {
  readonly intent: Intent;
  readonly constraints: readonly Constraint[];
  readonly transformations?: Readonly<Record<string, ConstraintView["transformation"]>>;
}): SemanticStateView {
  const constraints: ConstraintView[] = input.constraints.map((c) => ({
    id: c.id,
    concept: c.concept,
    operator: String(c.operator),
    expectedValue: c.value,
    criticality: String(c.kind),
    meaningClass: String(c.meaningClass),
    sourceText: c.sourceText,
    sourceSpan: c.sourceSpan,
    transformation: input.transformations?.[c.id] ?? "PRESERVED",
    criticalFailure:
      String(c.kind) === "SAFETY_CRITICAL" || String(c.kind) === "HARD"
        ? input.transformations?.[c.id] === "DROPPED" ||
          input.transformations?.[c.id] === "WEAKENED" ||
          input.transformations?.[c.id] === "CONTRADICTED"
        : false,
    groundingStatus: c.sourceSpan ? "GROUNDED" : "UNGROUNDED",
  }));
  return redactForUi({
    intentId: input.intent.id,
    rawIntent: input.intent.rawText,
    constraints,
  });
}

export function sliceSourceGrounding(
  rawIntent: string,
  span: { readonly start: number; readonly end: number },
): string {
  return rawIntent.slice(span.start, span.end);
}

export function projectGuardian(verdict?: GuardianVerdict | null): GuardianView {
  if (!verdict) {
    return {
      judges: [],
      aggregator: {
        decision: "UNAVAILABLE",
        semanticStatus: "UNCERTAIN",
        criticalFailure: false,
      },
    };
  }
  return redactForUi({
    judges: (verdict.judgeResults ?? []).map((j) => ({
      judgeId: String(j.judgeId),
      status: String(j.status),
      findings: (j.findings ?? []).map((f) => f.message ?? f.code ?? JSON.stringify(f)),
      affectedConstraints: [],
      modelName: undefined,
      promptVersion: undefined,
      schemaVersion: undefined,
    })),
    aggregator: {
      decision: String(verdict.decision),
      semanticStatus: String(verdict.semanticStatus),
      criticalFailure: Boolean(verdict.criticalFailure),
      overallFidelity: verdict.overallFidelity,
    },
  });
}

export function projectAuthority(input: {
  readonly guardianDecision?: string;
  readonly authorityDecision?: string;
  readonly capability?: string;
  readonly principalId?: string;
  readonly agentId?: string;
  readonly merchant?: string;
  readonly amount?: number;
  readonly currency?: string;
  readonly expiresAt?: string;
  readonly cumulativeExposure?: number;
  readonly approvalState?: string;
  readonly grantState?: string;
  readonly revocationState?: string;
  readonly semanticGate?: string;
}): AuthorityView {
  return redactForUi({
    guardianRecommendation: input.guardianDecision,
    semanticGate: input.semanticGate,
    decision: input.authorityDecision,
    capability: input.capability,
    principalId: input.principalId,
    agentId: input.agentId,
    merchant: input.merchant,
    amount: input.amount,
    currency: input.currency,
    expiresAt: input.expiresAt,
    cumulativeExposure: input.cumulativeExposure,
    approvalState: input.approvalState,
    grantState: input.grantState,
    revocationState: input.revocationState,
    explanation:
      "Guardian recommends. Authority decides. Gateway enforces. UI does not compute decisions.",
  });
}

export function projectExecution(input: {
  readonly prepared?: PreparedAction;
  readonly sideEffects?: readonly SideEffectRecord[];
  readonly phase?: ExecutionView["phase"];
  readonly stopReason?: string;
  readonly unknownPending?: boolean;
  readonly reservedExposure?: number;
  readonly blockedRetry?: boolean;
}): ExecutionView {
  const inferredPhase: ExecutionView["phase"] = input.phase
    ? input.phase
    : input.sideEffects && input.sideEffects.length > 0
      ? "EXECUTE"
      : input.prepared
        ? "PREPARE"
        : "PROPOSE";
  return redactForUi({
    phase: inferredPhase,
    stopReason: input.stopReason,
    preparedAction: input.prepared
      ? {
          id: input.prepared.id,
          merchant: input.prepared.parameters?.merchant as string | undefined,
          product: input.prepared.parameters?.product as string | undefined,
          quantity: input.prepared.parameters?.quantity as number | undefined,
          amount: input.prepared.parameters?.amount as number | undefined,
          currency: input.prepared.parameters?.currency as string | undefined,
          capability: input.prepared.capability,
          parameterHash: String(input.prepared.parameterHash),
          outcomeContractId: input.prepared.outcomeContractId
            ? String(input.prepared.outcomeContractId)
            : undefined,
          outcomeContractHash: input.prepared.outcomeContractHash
            ? String(input.prepared.outcomeContractHash)
            : undefined,
          expiresAt: input.prepared.expiresAt,
        }
      : undefined,
    sideEffects: (input.sideEffects ?? []).map((s) => ({
      id: s.executionId,
      tool: s.toolId,
      agent: undefined,
      amount: s.amount,
      result: String(s.resultState),
      reconciliationState: String(s.reconciliationState),
      at: s.requestTimestamp,
    })),
    unknownPending: Boolean(input.unknownPending),
    reservedExposure: input.reservedExposure,
    blockedRetry: Boolean(input.blockedRetry),
  });
}

export function projectOutcome(contract?: OutcomeContract | null): OutcomeView | undefined {
  if (!contract) return undefined;
  return redactForUi({
    contractId: contract.id,
    contractState: String(contract.state),
    paymentStatus: String(contract.paymentStatus),
    requirements: (contract.requirements ?? []).map((r) => ({
      concept: r.concept,
      criticality: String(r.criticality),
      state: String(r.state),
      observed: r.value,
      expected: r.value,
      display: `${r.concept}: ${String(r.value ?? "")} (${r.state})`,
    })),
    atRisk:
      String(contract.state) === "AT_RISK"
        ? deriveAtRiskFromRequirements(contract.requirements ?? [])
        : undefined,
    missingEvidence: [],
    conflicts: [],
  });
}

function deriveAtRiskFromRequirements(
  requirements: readonly {
    readonly concept: string;
    readonly value?: unknown;
    readonly deadline?: string;
  }[],
): NonNullable<OutcomeView["atRisk"]> {
  const details: {
    deadline?: string;
    eta?: string;
    basis?: string;
    confidence?: number;
  } = {};
  for (const r of requirements) {
    if (r.deadline && !details.deadline) {
      details.deadline = r.deadline;
    }
    if (
      !details.deadline &&
      typeof r.value === "string" &&
      (r.concept.includes("deadline") ||
        r.concept.includes("delivery_before") ||
        r.concept === "delivery_before")
    ) {
      details.deadline = r.value;
    }
  }
  return details;
}

export function projectResolution(input: {
  readonly case?: ResolutionCase | null;
  readonly hypotheses?: readonly ResponsibilityHypothesis[];
  readonly remedies?: readonly RemedyProposal[];
  readonly evidenceRequests?: readonly string[];
  readonly firstDivergence?: string;
  /** Optional per-remedy override; when omitted, derived from unmetRequirementIds or false. */
  readonly criticalConstraintsPreserved?: Readonly<Record<string, boolean>>;
}): ResolutionView | undefined {
  if (!input.case) return undefined;
  const resp = String(input.case.responsibilityState);
  return redactForUi({
    caseId: input.case.id,
    state: String(input.case.state),
    triggerIdentity: input.case.triggerIdentity
      ? String(input.case.triggerIdentity)
      : undefined,
    firstDivergence: input.firstDivergence,
    responsibilityState: resp,
    hypotheses: (input.hypotheses ?? []).map((h) => ({
      id: h.id,
      cause: String(h.assertedCause),
      status: String(h.status),
      confidence: h.confidence,
      supporting: [...h.supportingEvidenceIds],
      contradictory: [...h.contradictoryEvidenceIds],
      missing: [...h.missingEvidence],
    })),
    evidenceRequests: input.evidenceRequests ?? [],
    remedies: (input.remedies ?? []).map((r) => ({
      id: r.id,
      description: r.description,
      restorationValue: r.expectedRecoveryValue,
      financialCost: r.financialCost ?? r.estimatedAmount,
      timeCost: r.timeCost,
      criticalConstraintsPreserved:
        input.criticalConstraintsPreserved?.[r.id] ??
        (r.unmetRequirementIds !== undefined
          ? r.unmetRequirementIds.length === 0
          : false),
      reversibility: r.reversibility,
      authorityRequired: r.requiresFinancialAction,
      risks: r.risks ?? [],
    })),
    blameHonest: resp === "UNKNOWN" || resp === "POSSIBLE",
  });
}

export function projectPlan(steps: PlanView["steps"] = []): PlanView {
  return redactForUi({ steps });
}

const FILTER_KINDS: Record<GraphFilter, readonly string[]> = {
  semantic: ["INTENT", "INTENT_STATE", "CONSTRAINT", "ASSUMPTION", "PLAN", "FINDING"],
  authority: ["PRINCIPAL", "AUTHORITY", "ACTION", "DELEGATION"],
  external: ["EXTERNAL", "EVIDENCE", "CLAIM"],
  tainted: [], // special: use taint flag
  execution: ["ACTION", "PREPARED_ACTION", "COMMIT", "EXECUTION", "SIDE_EFFECT"],
  outcome: ["OUTCOME", "OUTCOME_CONTRACT", "OUTCOME_EVENT"],
  resolution: ["RESOLUTION", "REMEDY"],
  critical: [],
};

export function projectProvenanceGraph(input: {
  readonly nodes: readonly ProvenanceNode[];
  readonly edges: readonly ProvenanceEdge[];
  readonly filter?: GraphFilter;
  readonly maxNodes?: number;
  readonly tracePath?: readonly string[];
}): ProvenanceGraphView {
  const max = input.maxNodes ?? 80;
  let nodes = input.nodes.map((n) => ({
    id: n.id,
    kind: String(n.kind),
    label: n.label,
    trustClass: n.trustClass ? String(n.trustClass) : undefined,
    tainted: Boolean(n.taint?.classes?.length),
    taintClasses: n.taint?.classes ? n.taint.classes.map(String) : [],
  }));
  const filter = input.filter;
  if (filter === "tainted") {
    nodes = nodes.filter((n) => n.tainted);
  } else if (filter && FILTER_KINDS[filter]?.length) {
    const kinds = new Set(FILTER_KINDS[filter]);
    nodes = nodes.filter((n) => kinds.has(n.kind) || kinds.has(n.kind.toUpperCase()));
  }
  nodes = nodes.slice(0, max);
  const keep = new Set(nodes.map((n) => n.id));
  const edges = input.edges
    .filter((e) => keep.has(e.from) && keep.has(e.to))
    .map((e) => ({
      id: e.id,
      from: e.from,
      to: e.to,
      relation: String(e.relation),
    }));
  return redactForUi({
    nodes,
    edges,
    activeFilter: filter,
    traceToHuman: input.tracePath,
  });
}

export function mergeTimeline(
  events: readonly TimelineEventView[],
): TimelineView {
  const seen = new Set<string>();
  const out: TimelineEventView[] = [];
  for (const e of [...events].sort((a, b) => a.at.localeCompare(b.at))) {
    const key = e.dedupeKey ?? e.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return redactForUi({ events: out });
}

/** One durable workflow artifact, as the owner stores it. */
export interface LifecycleArtifactRow {
  readonly kind: string;
  readonly payload: Record<string, unknown>;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Derive what actually happened from durable artifacts.
 *
 * The blocking stage is the first gate that failed **in execution order** — the
 * order the engine evaluates them — not the first stage a UI happens to find
 * incomplete. Those differ: a run can complete Guardian and still be stopped by
 * something evaluated before it, and reporting Guardian in that case names the
 * wrong component.
 *
 * Only public-safe values are read: statuses, decisions, counts and identifiers
 * the workflow already exposes. No token, grant, credential, evidence body or
 * model internal is touched.
 */
export function projectLifecycle(input: {
  readonly artifacts: readonly LifecycleArtifactRow[];
  readonly readiness?: string;
  readonly sideEffectCount?: number;
  readonly provenanceNodeCount?: number;
  /**
   * The durable OutcomeContract, fetched by the caller from the separate
   * outcomeContracts collection (keyed by the EXECUTION_AUTHORIZATION
   * artifact's outcomeContractId -- not itself present in `artifacts`).
   * Distinct from `of("OUTCOME_CONTRACT")` below, which checks for a
   * semantic-artifact kind this pipeline never actually writes.
   */
  readonly outcomeContract?: { readonly state?: string; readonly paymentStatus?: string };
}): LifecycleView {
  const of = (kind: string) => input.artifacts.find((row) => row.kind === kind)?.payload;
  const all = (kind: string) => input.artifacts.filter((row) => row.kind === kind).map((row) => row.payload);

  const workflow = of("WORKFLOW");
  const plan = of("PLAN");
  const planVerification = record(of("PLAN_VERIFICATION")?.verification);
  const action = of("ACTION");
  const guardianVerdict = record(of("GUARDIAN")?.verdict);
  const proofs = all("PROOF");
  const outcome = of("OUTCOME_CONTRACT") ?? of("OUTCOME");
  /**
   * Durable proof that Authority granted, a PreparedAction was minted, and a
   * CommitToken was issued -- written once by generic-workflow-engine.ts
   * right after bindAndMint. Its mere existence is authoritative: a BLOCKed
   * workflow never reaches that call, so there is no false-positive case to
   * guard against. This is a stronger, later signal than the WORKFLOW
   * artifact's own `state`, which is written once, immutably, at Guardian
   * time and never updated as the workflow progresses further -- relying on
   * it alone permanently freezes authority/preparedAction at whatever state
   * existed at that one snapshot (observed live: frozen at
   * "AUTHORITY_EVALUATION" for workflows that had already reached AUTHORIZED).
   */
  const executionAuthorization = of("EXECUTION_AUTHORIZATION");

  const workflowState = typeof workflow?.state === "string" ? workflow.state : undefined;
  const authorityReached = Boolean(executionAuthorization) ||
    workflowState === "AUTHORITY_EVALUATION" ||
    workflowState === "AUTHORIZED" ||
    workflowState === "AWAITING_APPROVAL" ||
    workflowState === "EXECUTED";
  const fidelity = record(action?.deterministicActionFidelity);
  const fidelityFailed = fidelity?.preservesIntent === false;
  const capabilityFidelity = record(action?.capabilityFidelity);
  const capabilityMismatch = capabilityFidelity?.matches === false;

  const unsatisfied = proofs.filter((proof) => proof.status !== "SATISFIED");
  const proofsAbsent = proofs.some(
    (proof) => typeof proof.method === "string" && proof.method.endsWith("-absent"),
  );
  const planVerified = planVerification?.status === "VERIFIED";
  const guardianDecision = typeof guardianVerdict?.decision === "string" ? guardianVerdict.decision : undefined;
  const guardianBlocked = guardianDecision === "BLOCK" || guardianVerdict?.criticalFailure === true;

  // Execution order: plan verification, then proofs, then action fidelity,
  // then capability fidelity, then Guardian, then the eligibility
  // conjunction itself. capabilityFidelity is deliberately its own stage —
  // distinct from actionFidelity (which never inspects action.capability;
  // see generic-workflow-engine.ts) and from Guardian/authorityEligibility
  // — so a capability-substitution attack is never misattributed to any of
  // those.
  let blockingStage: string | undefined;
  let blockingReason: string | undefined;
  if (plan && !planVerified) {
    blockingStage = "planVerification";
    blockingReason = "Plan verification did not verify the plan against the recorded intent.";
  } else if (proofsAbsent) {
    blockingStage = "evidence";
    blockingReason = "Required proofs were not established: no verified evidence was bound to this workflow.";
  } else if (unsatisfied.length > 0) {
    blockingStage = "evidence";
    blockingReason = `${unsatisfied.length} of ${proofs.length} required proof obligations were not satisfied.`;
  } else if (fidelityFailed) {
    blockingStage = "actionFidelity";
    blockingReason = "The proposed action did not preserve the recorded human intent.";
  } else if (capabilityMismatch) {
    blockingStage = "capabilityFidelity";
    blockingReason = "The proposed capability is outside the capability authorized by this workflow domain.";
  } else if (guardianBlocked) {
    blockingStage = "guardian";
    blockingReason = "Guardian review blocked the action.";
  } else if (workflowState === "BLOCKED") {
    blockingStage = "authorityEligibility";
    blockingReason = "The workflow did not become eligible for authority evaluation.";
  }

  const blockedAt = (stage: string): LifecycleStageStatus =>
    blockingStage === stage ? "BLOCKED" : "COMPLETED";

  const stages: LifecycleStageView[] = [
    { stage: "intent", status: "COMPLETED" },
    { stage: "verification", status: "COMPLETED", ...(input.readiness ? { detail: input.readiness } : {}) },
  ];

  if (proofs.length > 0) {
    stages.push({
      stage: "evidence",
      status: blockingStage === "evidence" ? "BLOCKED" : "COMPLETED",
      detail: `${proofs.length - unsatisfied.length} of ${proofs.length} required proofs satisfied`,
    });
  } else {
    stages.push({ stage: "evidence", status: "NOT_REACHED" });
  }

  stages.push({ stage: "plan", status: plan ? "COMPLETED" : "NOT_REACHED" });
  stages.push({
    stage: "planVerification",
    status: planVerification ? blockedAt("planVerification") : "NOT_REACHED",
    ...(planVerification?.status ? { detail: String(planVerification.status) } : {}),
  });

  // Guardian completing and Guardian permitting are different facts. A completed
  // review whose verdict is not publicly exposable is still COMPLETED, never
  // "unavailable" — absence of an exposed verdict is not absence of a review.
  stages.push({
    stage: "guardian",
    status: guardianVerdict
      ? (guardianBlocked ? "BLOCKED" : "COMPLETED")
      : "NOT_REACHED",
    ...(guardianDecision ? { detail: guardianDecision } : guardianVerdict ? { detail: "REVIEW_COMPLETED" } : {}),
  });

  stages.push({
    stage: "authority",
    status: authorityReached ? "COMPLETED" : "NOT_REACHED",
    ...(executionAuthorization
      ? { detail: "AUTHORIZED" }
      : workflowState
        ? { detail: workflowState }
        : {}),
  });
  stages.push({
    stage: "preparedAction",
    status: executionAuthorization || workflowState === "AUTHORIZED" || workflowState === "EXECUTED"
      ? "COMPLETED"
      : "NOT_REACHED",
  });

  // Execution is claimed from a recorded side effect when the caller supplies
  // one, or from the durable OutcomeContract's own paymentStatus -- a real,
  // separate write the commit step makes, unlike this pipeline's semantic
  // artifacts (which never gain a post-authorize entry; see
  // EXECUTION_AUTHORIZATION above). Neither an authorized-but-uncommitted
  // workflow (paymentStatus stays PENDING) nor a merely-created outcome
  // contract satisfies this.
  const sideEffects = input.sideEffectCount ?? 0;
  const executionConfirmedByOutcome = input.outcomeContract?.paymentStatus === "SUCCESS";
  stages.push({
    stage: "execution",
    status: sideEffects > 0 || executionConfirmedByOutcome ? "COMPLETED" : "NOT_REACHED",
    detail: `${sideEffects} recorded side effect(s)`,
  });
  stages.push({
    stage: "outcome",
    status: outcome || input.outcomeContract ? "COMPLETED" : "NOT_PRODUCED",
  });
  stages.push({
    stage: "provenance",
    status: (input.provenanceNodeCount ?? 0) > 0 ? "COMPLETED" : "NOT_PRODUCED",
    ...(input.provenanceNodeCount ? { detail: `${input.provenanceNodeCount} recorded node(s)` } : {}),
  });

  return redactForUi({
    stages,
    ...(blockingStage ? { blockingStage } : {}),
    ...(blockingReason ? { blockingReason } : {}),
  });
}

export function assembleWorkspace(parts: {
  readonly summary: IntentSummaryView;
  readonly semantic: SemanticStateView;
  readonly plan?: PlanView;
  readonly guardian?: GuardianView;
  readonly authority?: AuthorityView;
  readonly execution?: ExecutionView;
  readonly outcome?: OutcomeView;
  readonly resolution?: ResolutionView;
  readonly graph: ProvenanceGraphView;
  readonly timeline: TimelineView;
  readonly lifecycle?: LifecycleView;
}): IntentWorkspaceView {
  return redactForUi({
    ...(parts.lifecycle ? { lifecycle: parts.lifecycle } : {}),
    summary: parts.summary,
    semantic: parts.semantic,
    plan: parts.plan ?? { steps: [] },
    guardian: parts.guardian ?? {
      judges: [],
      aggregator: {
        decision: "UNAVAILABLE",
        semanticStatus: "UNCERTAIN",
        criticalFailure: false,
      },
    },
    authority: parts.authority ?? {
      explanation:
        "Guardian recommends. Authority decides. Gateway enforces. UI does not compute decisions.",
    },
    execution: parts.execution ?? {
      phase: "PROPOSE",
      sideEffects: [],
      unknownPending: false,
      blockedRetry: false,
    },
    outcome: parts.outcome,
    resolution: parts.resolution,
    graph: parts.graph,
    timeline: parts.timeline,
  });
}

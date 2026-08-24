import type {
  IntentWorkspaceView,
  SdkApprovalView,
  SdkEvidenceView,
  SdkOutcomeView,
  SdkResolutionCaseView,
  SdkWorkflowCommitResult,
  SdkWorkflowRequest,
  SdkWorkflowView,
} from "@truemandate/sdk-core";

export type TruthSource = "PUBLIC_API" | "DERIVED_PRESENTATION";

export type LiveEvidenceRecord = {
  readonly label: string;
  readonly submittedAt: string;
  readonly envelopeIds: readonly string[];
  readonly claimIds: readonly string[];
  readonly evidenceReads: readonly SdkEvidenceView[];
  readonly lineage?: {
    readonly workflowId?: string;
    readonly intentId?: string;
    readonly intentStateId?: string;
    readonly outcomeContractId?: string;
  };
};

export interface LiveWorkflowTruthInput {
  readonly createdAt: string;
  readonly domainLabel: string;
  readonly request: SdkWorkflowRequest;
  readonly workflow: SdkWorkflowView;
  readonly workspace?: IntentWorkspaceView;
  readonly approval?: SdkApprovalView;
  readonly outcome?: SdkOutcomeView;
  readonly resolution?: SdkResolutionCaseView;
  readonly commit?: SdkWorkflowCommitResult;
  readonly evidenceSubmissions: readonly LiveEvidenceRecord[];
}

export type LiveGraphStage =
  | "intent"
  | "semantic"
  | "evidence"
  | "plan"
  | "plan-verification"
  | "guardian"
  | "authority"
  | "approval-monitoring"
  | "execution"
  | "outcome"
  | "resolution"
  | "other";

export interface LiveGraphNode {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly stage: LiveGraphStage;
  readonly state?: string;
  readonly timestamp?: string;
  readonly workflowId: string;
  readonly intentId?: string;
  readonly intentStateId?: string;
  readonly decision?: string;
  readonly findings: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly predecessorIds: readonly string[];
  readonly trustClass?: string;
  readonly tainted?: boolean;
  readonly source: TruthSource;
}

export interface LiveGraphEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly relation: string;
  readonly source: TruthSource;
}

export interface LiveProvenanceModel {
  readonly nodes: readonly LiveGraphNode[];
  readonly edges: readonly LiveGraphEdge[];
  readonly recordedEdgeCount: number;
  readonly fallbackEdgeCount: number;
}

export interface GovernanceReportRow {
  readonly label: string;
  readonly value: string;
  readonly source: TruthSource;
}

export interface GovernanceReportSection {
  readonly id: string;
  readonly title: string;
  readonly availability: "PRESENT" | "NOT_CREATED" | "NOT_REACHED" | "NOT_PUBLIC";
  readonly rows: readonly GovernanceReportRow[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function nestedText(value: unknown, path: readonly string[]): string | undefined {
  let current = value;
  for (const key of path) {
    const row = record(current);
    if (!row) return undefined;
    current = row[key];
  }
  return text(current);
}

export function intentIdFromRequest(request: SdkWorkflowRequest): string | undefined {
  if (request.intent.kind === "RAW") return request.intent.id;
  return request.intent.intentId;
}

function stageForKind(kind: string): LiveGraphStage {
  const normalized = kind.trim().toUpperCase();
  if (normalized === "INTENT") return "intent";
  if (["INTENT_STATE", "SEMANTIC_VERIFICATION", "CONSTRAINT", "ASSUMPTION"].includes(normalized)) return "semantic";
  if (["EVIDENCE", "EVIDENCE_ENVELOPE", "CLAIM", "PROOF"].includes(normalized)) return "evidence";
  if (normalized === "PLAN") return "plan";
  if (normalized === "PLAN_VERIFICATION") return "plan-verification";
  if (normalized === "GUARDIAN" || normalized === "GUARDIAN_VERDICT") return "guardian";
  if (["AUTHORITY", "AUTHORITY_EVALUATION"].includes(normalized)) return "authority";
  if (["APPROVAL", "APPROVAL_REQUEST", "MONITORING", "MONITORING_CONTRACT"].includes(normalized)) return "approval-monitoring";
  if (["ACTION", "PREPARED_ACTION", "COMMIT", "EXECUTION", "SIDE_EFFECT"].includes(normalized)) return "execution";
  if (["OUTCOME", "OUTCOME_CONTRACT", "OUTCOME_EVENT"].includes(normalized)) return "outcome";
  if (["RESOLUTION", "RESOLUTION_CASE", "REMEDY"].includes(normalized)) return "resolution";
  return "other";
}

const ARTIFACT_KEYS: Readonly<Record<string, string>> = {
  workflow: "WORKFLOW",
  plan: "PLAN",
  planVerification: "PLAN_VERIFICATION",
  action: "ACTION",
  guardian: "GUARDIAN",
};

function artifactReferences(artifacts: unknown): readonly { id: string; kind: string }[] {
  const root = record(artifacts);
  if (!root) return [];
  const refs: { id: string; kind: string }[] = [];
  for (const [key, kind] of Object.entries(ARTIFACT_KEYS)) {
    const id = text(record(root[key])?.id);
    if (id) refs.push({ id, kind });
  }
  if (Array.isArray(root.proofs)) {
    for (const proof of root.proofs) {
      const id = text(record(proof)?.id);
      if (id) refs.push({ id, kind: "PROOF" });
    }
  }
  return refs;
}

function nodeDecision(input: LiveWorkflowTruthInput, stage: LiveGraphStage): string | undefined {
  if (stage === "guardian") return input.workspace?.guardian.aggregator.decision;
  if (stage === "authority") {
    return input.workspace?.authority.decision ??
      nestedText(input.workflow.evaluation, ["evaluation", "decision"]) ??
      nestedText(input.workflow.evaluation, ["decision"]);
  }
  return undefined;
}

function nodeState(input: LiveWorkflowTruthInput, stage: LiveGraphStage): string | undefined {
  switch (stage) {
    case "intent": return "RECORDED";
    case "semantic": return input.workspace?.summary.readiness;
    case "plan": return input.workspace?.plan.steps.length ? "CREATED" : undefined;
    case "plan-verification": return artifactReferences(input.workflow.artifacts).some((item) => item.kind === "PLAN_VERIFICATION") ? "CREATED" : undefined;
    case "guardian": return input.workspace?.guardian.aggregator.semanticStatus;
    case "authority": return input.workspace?.authority.decision;
    case "approval-monitoring": return input.approval?.status;
    case "execution": return input.workflow.execution?.status ?? input.commit?.status ?? input.workspace?.execution.phase;
    case "outcome": return input.outcome?.state ?? input.workspace?.outcome?.contractState;
    case "resolution": return input.resolution?.state ?? input.workspace?.resolution?.state;
    default: return undefined;
  }
}

function findingsForStage(input: LiveWorkflowTruthInput, stage: LiveGraphStage): readonly string[] {
  if (stage === "guardian") {
    return input.workspace?.guardian.judges.flatMap((judge) => judge.findings) ?? [];
  }
  if (stage === "authority") {
    return input.workspace?.authority.explanation ? [input.workspace.authority.explanation] : [];
  }
  if (stage === "outcome") {
    return [
      ...(input.workspace?.outcome?.missingEvidence ?? []),
      ...(input.workspace?.outcome?.conflicts ?? []),
    ];
  }
  if (stage === "resolution" && input.workspace?.resolution?.firstDivergence) {
    return [input.workspace.resolution.firstDivergence];
  }
  return [];
}

function timelineTimestamp(input: LiveWorkflowTruthInput, nodeId: string): string | undefined {
  return input.workspace?.timeline.events.find((event) => event.relatedObjectIds.includes(nodeId))?.at;
}

function safeAddNode(target: Map<string, LiveGraphNode>, node: LiveGraphNode): void {
  const existing = target.get(node.id);
  if (!existing) {
    target.set(node.id, node);
    return;
  }
  target.set(node.id, {
    ...existing,
    ...node,
    findings: [...new Set([...existing.findings, ...node.findings])],
    evidenceRefs: [...new Set([...existing.evidenceRefs, ...node.evidenceRefs])],
    predecessorIds: [...new Set([...existing.predecessorIds, ...node.predecessorIds])],
    source: existing.source === "PUBLIC_API" || node.source === "PUBLIC_API" ? "PUBLIC_API" : "DERIVED_PRESENTATION",
  });
}

export function buildLiveProvenanceModel(input: LiveWorkflowTruthInput): LiveProvenanceModel {
  const nodes = new Map<string, LiveGraphNode>();
  const workflowId = input.workflow.workflowId;
  const intentId = input.workspace?.summary.intentId ?? input.outcome?.intentId ?? input.approval?.intentId ?? intentIdFromRequest(input.request);
  const intentStateId = input.workspace?.summary.intentStateId ?? input.outcome?.intentStateId ?? input.approval?.intentStateId;

  for (const graphNode of input.workspace?.graph.nodes ?? []) {
    const stage = stageForKind(graphNode.kind);
    safeAddNode(nodes, {
      id: graphNode.id,
      label: graphNode.label,
      kind: graphNode.kind,
      stage,
      state: nodeState(input, stage),
      timestamp: timelineTimestamp(input, graphNode.id),
      workflowId,
      intentId,
      intentStateId,
      decision: nodeDecision(input, stage),
      findings: findingsForStage(input, stage),
      evidenceRefs: [],
      predecessorIds: [],
      trustClass: graphNode.trustClass,
      tainted: graphNode.tainted,
      source: "PUBLIC_API",
    });
  }

  if (intentId) {
    safeAddNode(nodes, {
      id: intentId,
      label: "Human Intent",
      kind: "INTENT",
      stage: "intent",
      state: "RECORDED",
      timestamp: input.workspace?.summary.createdAt ?? input.createdAt,
      workflowId,
      intentId,
      intentStateId,
      findings: [],
      evidenceRefs: [],
      predecessorIds: [],
      source: "PUBLIC_API",
    });
  }
  if (intentStateId) {
    safeAddNode(nodes, {
      id: intentStateId,
      label: "IntentState / Semantic Verification",
      kind: "INTENT_STATE",
      stage: "semantic",
      state: input.workspace?.summary.readiness,
      workflowId,
      intentId,
      intentStateId,
      findings: [],
      evidenceRefs: [],
      predecessorIds: intentId ? [intentId] : [],
      source: "PUBLIC_API",
    });
  }

  for (const artifact of artifactReferences(input.workflow.artifacts)) {
    const stage = stageForKind(artifact.kind);
    safeAddNode(nodes, {
      id: artifact.id,
      label: artifact.kind.replaceAll("_", " "),
      kind: artifact.kind,
      stage,
      state: nodeState(input, stage),
      timestamp: timelineTimestamp(input, artifact.id),
      workflowId,
      intentId,
      intentStateId,
      decision: nodeDecision(input, stage),
      findings: findingsForStage(input, stage),
      evidenceRefs: [],
      predecessorIds: [],
      source: "PUBLIC_API",
    });
  }

  const approvalOrMonitoring: readonly { id?: string; kind: string; label: string; state?: string }[] = [
    { id: input.approval?.id, kind: "APPROVAL_REQUEST", label: "Approval Request", state: input.approval?.status },
    { id: text(record(input.workflow.monitoringContract)?.id), kind: "MONITORING_CONTRACT", label: "Monitoring Contract", state: text(record(input.workflow.monitoringContract)?.state) },
  ];
  for (const row of approvalOrMonitoring) {
    if (!row.id) continue;
    safeAddNode(nodes, {
      id: row.id,
      label: row.label,
      kind: row.kind,
      stage: "approval-monitoring",
      state: row.state,
      workflowId,
      intentId,
      intentStateId,
      findings: [],
      evidenceRefs: [],
      predecessorIds: [],
      source: "PUBLIC_API",
    });
  }

  const executionId = input.workflow.execution?.executionId ?? input.commit?.executionId;
  if (executionId) {
    safeAddNode(nodes, {
      id: executionId,
      label: "Execution",
      kind: "EXECUTION",
      stage: "execution",
      state: input.workflow.execution?.status ?? input.commit?.status,
      workflowId,
      intentId,
      intentStateId,
      findings: [],
      evidenceRefs: [],
      predecessorIds: [],
      source: "PUBLIC_API",
    });
  }

  const outcomeId = input.outcome?.id ?? text(record(input.workflow.outcomeContract)?.id);
  if (outcomeId) {
    safeAddNode(nodes, {
      id: outcomeId,
      label: "Outcome Contract",
      kind: "OUTCOME_CONTRACT",
      stage: "outcome",
      state: input.outcome?.state ?? input.workspace?.outcome?.contractState,
      timestamp: input.outcome?.updatedAt,
      workflowId,
      intentId,
      intentStateId,
      findings: findingsForStage(input, "outcome"),
      evidenceRefs: input.evidenceSubmissions.flatMap((submission) => submission.envelopeIds),
      predecessorIds: executionId ? [executionId] : [],
      source: "PUBLIC_API",
    });
  }
  if (input.resolution) {
    safeAddNode(nodes, {
      id: input.resolution.id,
      label: "Resolution Case",
      kind: "RESOLUTION_CASE",
      stage: "resolution",
      state: input.resolution.state,
      timestamp: input.resolution.updatedAt ?? input.resolution.openedAt,
      workflowId,
      intentId,
      intentStateId,
      findings: findingsForStage(input, "resolution"),
      evidenceRefs: [],
      predecessorIds: [input.resolution.contractId],
      source: "PUBLIC_API",
    });
  }

  for (const submission of input.evidenceSubmissions) {
    for (const evidence of submission.evidenceReads) {
      safeAddNode(nodes, {
        id: evidence.id,
        label: submission.label,
        kind: "EVIDENCE",
        stage: "evidence",
        state: evidence.trustClass,
        timestamp: evidence.captureTime,
        workflowId,
        intentId: submission.lineage?.intentId ?? intentId,
        intentStateId: submission.lineage?.intentStateId ?? intentStateId,
        findings: [],
        evidenceRefs: [evidence.id],
        predecessorIds: [],
        trustClass: evidence.trustClass,
        tainted: evidence.trustClass === "UNTRUSTED_EXTERNAL",
        source: "PUBLIC_API",
      });
    }
  }

  const recordedEdges: LiveGraphEdge[] = (input.workspace?.graph.edges ?? [])
    .filter((edge) => nodes.has(edge.from) && nodes.has(edge.to))
    .map((edge) => ({ ...edge, source: "PUBLIC_API" }));

  for (const submission of input.evidenceSubmissions) {
    const target = submission.lineage?.outcomeContractId;
    if (!target || !nodes.has(target)) continue;
    for (const evidenceId of submission.envelopeIds) {
      if (!nodes.has(evidenceId)) continue;
      recordedEdges.push({
        id: `submission-${evidenceId}-${target}`,
        from: evidenceId,
        to: target,
        relation: "SUBMITTED_FOR",
        source: "PUBLIC_API",
      });
    }
  }

  const stageOrder: readonly LiveGraphStage[] = [
    "intent", "semantic", "plan", "plan-verification", "guardian", "authority",
    "approval-monitoring", "execution", "outcome", "resolution",
  ];
  const primaryByStage = new Map<LiveGraphStage, LiveGraphNode>();
  for (const stage of stageOrder) {
    const candidate = [...nodes.values()].find((node) => node.stage === stage);
    if (candidate) primaryByStage.set(stage, candidate);
  }
  const fallbackEdges: LiveGraphEdge[] = [];
  const ordered = stageOrder.flatMap((stage) => primaryByStage.get(stage) ?? []);
  for (let index = 1; index < ordered.length; index += 1) {
    const from = ordered[index - 1]!;
    const to = ordered[index]!;
    const alreadyLinked = recordedEdges.some((edge) => edge.from === from.id && edge.to === to.id);
    if (!alreadyLinked) {
      fallbackEdges.push({
        id: `stage-order-${from.id}-${to.id}`,
        from: from.id,
        to: to.id,
        relation: "STAGE_ORDER",
        source: "DERIVED_PRESENTATION",
      });
    }
  }

  const predecessors = new Map<string, string[]>();
  for (const edge of [...recordedEdges, ...fallbackEdges]) {
    predecessors.set(edge.to, [...(predecessors.get(edge.to) ?? []), edge.from]);
  }
  const withPredecessors = [...nodes.values()].map((node) => ({
    ...node,
    predecessorIds: [...new Set([...node.predecessorIds, ...(predecessors.get(node.id) ?? [])])],
  }));

  return {
    nodes: withPredecessors,
    edges: [...recordedEdges, ...fallbackEdges],
    recordedEdgeCount: recordedEdges.length,
    fallbackEdgeCount: fallbackEdges.length,
  };
}

function row(label: string, value: unknown, source: TruthSource = "PUBLIC_API"): GovernanceReportRow | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return { label, value: typeof value === "string" ? value : JSON.stringify(value), source };
}

function section(
  id: string,
  title: string,
  availability: GovernanceReportSection["availability"],
  rows: readonly (GovernanceReportRow | undefined)[],
): GovernanceReportSection {
  return { id, title, availability, rows: rows.filter((item): item is GovernanceReportRow => Boolean(item)) };
}

export function buildGovernanceReport(input: LiveWorkflowTruthInput, graph: LiveProvenanceModel): readonly GovernanceReportSection[] {
  const workspace = input.workspace;
  const monitoring = record(input.workflow.monitoringContract);
  const constraintSummary = workspace
    ? `${workspace.semantic.constraints.filter((constraint) => !constraint.criticalFailure).length}/${workspace.semantic.constraints.length} without critical failure`
    : undefined;
  const executionStatus = input.workflow.execution?.status ?? input.commit?.status ?? workspace?.execution.phase;
  const outcomeState = input.outcome?.state ?? workspace?.outcome?.contractState;
  const paymentStatus = input.outcome?.paymentStatus ?? workspace?.outcome?.paymentStatus;

  return [
    section("intent", "Intent", "PRESENT", [
      row("Workflow", input.workflow.workflowId),
      row("Domain", input.domainLabel),
      row("Human request", input.request.intent.kind === "RAW" ? input.request.intent.rawText : `Intent reference ${input.request.intent.intentId}`),
      row("Intent", workspace?.summary.intentId ?? intentIdFromRequest(input.request)),
      row("IntentState", workspace?.summary.intentStateId),
      row("Readiness", workspace?.summary.readiness),
      row("Ambiguity", workspace?.summary.ambiguityClass),
    ]),
    section("decision", "Decision Summary", workspace ? "PRESENT" : "NOT_PUBLIC", [
      row("Guardian", workspace?.guardian.aggregator.decision),
      row("Semantic status", workspace?.guardian.aggregator.semanticStatus),
      row("Authority", workspace?.authority.decision ?? nestedText(input.workflow.evaluation, ["evaluation", "decision"])),
      row("Explanation", workspace?.authority.explanation),
    ]),
    section("constraints", "Constraint Verification", workspace ? "PRESENT" : "NOT_PUBLIC", [
      row("Coverage", constraintSummary, "DERIVED_PRESENTATION"),
      row("Constraints", workspace?.semantic.constraints.map((constraint) => `${constraint.concept}: ${constraint.status ?? (constraint.criticalFailure ? "CRITICAL_FAILURE" : "RECORDED")}`).join(" | ")),
      row("Candidate evidence", input.evidenceSubmissions.flatMap((submission) => submission.evidenceReads.map((evidence) => `${evidence.id} (${evidence.trustClass})`)).join(" | ") || undefined),
    ]),
    section("authority", "Authority & Monitoring", workspace?.authority.decision || monitoring ? "PRESENT" : "NOT_REACHED", [
      row("Decision", workspace?.authority.decision ?? nestedText(input.workflow.evaluation, ["evaluation", "decision"])),
      row("Capability", workspace?.authority.capability),
      row("Approval", input.approval ? `${input.approval.id} / ${input.approval.status}` : undefined),
      row("Monitoring", text(monitoring?.id)),
      row("Monitoring state", text(monitoring?.state)),
    ]),
    section("execution", "Execution", executionStatus ? "PRESENT" : "NOT_REACHED", [
      row("Status", executionStatus),
      row("Execution", input.workflow.execution?.executionId ?? input.commit?.executionId),
      row("Result", input.workflow.execution?.resultRef ?? input.commit?.resultRef),
      row("Recorded side effects", workspace ? String(workspace.execution.sideEffects.length) : undefined),
    ]),
    section("outcome", "Outcome", outcomeState || input.outcome ? "PRESENT" : "NOT_CREATED", [
      row("Contract", input.outcome?.id ?? workspace?.outcome?.contractId),
      row("Payment / execution", paymentStatus),
      row("Outcome", outcomeState),
      row("Requirement results", workspace?.outcome?.requirements.map((requirement) => `${requirement.concept}: ${requirement.state}`).join(" | ")),
      row("Core distinction", paymentStatus && outcomeState ? `${paymentStatus} execution is distinct from ${outcomeState} outcome` : undefined, "DERIVED_PRESENTATION"),
    ]),
    section("resolution", "Resolution", input.resolution || workspace?.resolution ? "PRESENT" : "NOT_CREATED", [
      row("Case", input.resolution?.id ?? workspace?.resolution?.caseId),
      row("State", input.resolution?.state ?? workspace?.resolution?.state),
      row("Responsibility", input.resolution?.responsibilityState ?? workspace?.resolution?.responsibilityState),
      row("First divergence", workspace?.resolution?.firstDivergence),
    ]),
    section("provenance", "Provenance / Audit Trail", graph.nodes.length ? "PRESENT" : "NOT_PUBLIC", [
      row("Recorded nodes", String(graph.nodes.filter((node) => node.source === "PUBLIC_API").length)),
      row("Recorded relationships", String(graph.recordedEdgeCount)),
      row("Presentation order links", String(graph.fallbackEdgeCount), "DERIVED_PRESENTATION"),
      row("Timeline events", workspace ? String(workspace.timeline.events.length) : undefined),
    ]),
    section("observability", "Observability", workspace?.timeline.events.length ? "PRESENT" : "NOT_PUBLIC", [
      row("Public audit timeline", workspace?.timeline.events.map((event) => `${event.at} ${event.type}: ${event.summary}`).join(" | ")),
      row("Live Gemini activity summary", "Not publicly available through the public API", "DERIVED_PRESENTATION"),
      row("Trace/log correlation", "Not publicly available", "DERIVED_PRESENTATION"),
    ]),
  ];
}

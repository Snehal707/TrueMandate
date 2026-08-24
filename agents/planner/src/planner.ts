import { hashCanonical } from "@truemandate/crypto";
import { PROTOCOL_VERSION, type ModelPort } from "@truemandate/model";
import {
  CommitmentLevel,
  ConsequenceLevel,
  ErrorCode,
  PlanStatus,
  asAgentId,
  asAssumptionId,
  asConstraintId,
  asPlanId,
  asPlanStepId,
  asProvenanceNodeId,
  err,
  type Intent,
  type IntentState,
  type PlanGraph,
  type PlanStep,
  type Result,
  type SemanticVerificationResult,
} from "@truemandate/protocol";
import { PlannerModelOutputSchema } from "@truemandate/schemas";
import {
  assertPlanningAllowed,
  deriveRequiredProofObligations,
  executionCriticalRuleForConcept,
  type ConceptFamily,
  type ExecutionCriticalConceptRule,
} from "@truemandate/semantic-readiness";
import {
  PLANNER_PROMPT_VERSION,
  PLANNER_SCHEMA_ID,
  PLANNER_SCHEMA_VERSION,
  PLANNER_SYSTEM_INSTRUCTION,
} from "./prompts/v1.js";

export interface PlanOptions {
  readonly model: ModelPort;
  readonly modelId?: string;
  readonly requestId?: string;
  readonly previousPlanId?: string;
  readonly version?: number;
  readonly planningContext?: PlanningContext;
}

export interface PlanningContext {
  readonly domainId: string;
  readonly executionCapability: string;
  readonly executionLabel: string;
  readonly requiredPhases: readonly string[];
  readonly conceptFamilies: readonly ConceptFamily[];
  readonly executionCriticalConceptRules: readonly ExecutionCriticalConceptRule[];
  readonly authoritativeActionSummary?: {
    readonly capability: string;
    readonly merchant: string;
    readonly product: string;
    readonly quantity: number;
    readonly amount: number;
    readonly currency: string;
    readonly refundable?: boolean;
    readonly deliveryTerms?: string;
  };
}

function uniqueIds<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

type NormalizedProofObligation = PlanGraph["proofObligations"][number];

function hasBindingPhaseStep(
  steps: readonly PlanStep[],
  obligationConstraintIds: readonly string[],
): boolean {
  return steps.some((step) => {
    if (step.commitmentLevel !== CommitmentLevel.READ_ONLY || step.privileged) {
      return false;
    }
    const text = `${step.objective} ${step.expectedOutput}`.toLowerCase();
    const touchesConstraint = obligationConstraintIds.some(
      (id) =>
        step.requiredConstraintIds.includes(asConstraintId(id)) ||
        step.applicableConstraintIds.includes(asConstraintId(id)),
    );
    return (
      touchesConstraint &&
      (step.requestedCapabilities.includes("request_evidence") ||
        text.includes("bind evidence") ||
        text.includes("evidence bound") ||
        text.includes("proof obligation"))
    );
  });
}

/**
 * Deterministic required plan step classes derived from authoritative intent
 * semantics — never from model discretion. An executable purchase request
 * (purchase verb + financial constraint + EXECUTABLE/ACTIONABLE readiness)
 * requires a privileged ECONOMIC execution step.
 */
export function deriveRequiredPlanStepKinds(
  intent: { readonly rawText: string },
  intentState: { readonly constraints: readonly { readonly id: string; readonly kind: string; readonly concept: string }[] },
  verification: { readonly readiness: string },
): readonly string[] {
  const purchaseIntent = /buy|purchase|procure|order|acquire|book|pay\b/i.test(intent.rawText);
  const economicIntent = intentState.constraints.some(
    (c) => c.kind === "FINANCIAL" || /budget|cost|amount|price/.test(c.concept),
  );
  const executable =
    verification.readiness === "EXECUTABLE" ||
    verification.readiness === "ACTIONABLE";
  return purchaseIntent && economicIntent && executable ? ["ECONOMIC"] : [];
}

/**
 * A step qualifies as the required ECONOMIC execution step only when it is
 * privileged, ECONOMIC, carries the execute_payment capability, and binds the
 * authoritative financial/purchase constraint — an unrelated economic action
 * does not satisfy the requirement. No parameters are ever fabricated here:
 * supplier/quantity/price/evidence stay grounded in the authoritative intent
 * and the verified offer.
 */
function findEconomicExecutionStep(
  steps: readonly PlanStep[],
  constraints: readonly { readonly id: string; readonly kind: string; readonly concept: string }[],
  planningContext: PlanningContext | undefined,
) {
  return steps.find((step) => {
    if (step.commitmentLevel !== "ECONOMIC" || !step.privileged) return false;
    const executionCapability = planningContext?.executionCapability ?? "execute_payment";
    const capability =
      step.requestedCapabilities.includes(executionCapability) ||
      step.requiredFutureCapabilities.includes(executionCapability);
    if (!capability) return false;
    const binds = (id: string) =>
      constraints.some(
        (c) =>
          c.id === id &&
          (
            c.kind === "FINANCIAL" ||
            /budget|cost|amount|price/.test(c.concept) ||
            (planningContext !== undefined && executionCriticalRuleForConcept(c.concept, planningContext) !== undefined)
          ),
      );
    return (
      step.applicableConstraintIds.some(binds) ||
      step.requiredConstraintIds.some(binds)
    );
  });
}

function ensureBindingPhase(
  steps: readonly PlanStep[],
  constraints: readonly { readonly id: string; readonly kind: string; readonly concept: string }[],
  proofObligations: readonly NormalizedProofObligation[],
  planningContext: PlanningContext | undefined,
): {
  readonly steps: readonly PlanStep[];
  readonly proofObligations: readonly NormalizedProofObligation[];
} {
  if (!planningContext?.requiredPhases.includes("BIND_EVIDENCE")) {
    return { steps, proofObligations };
  }

  const obligationConstraintIds = uniqueIds(
    proofObligations
      .map((obligation) => obligation.constraintId)
      .filter((value): value is ReturnType<typeof asConstraintId> => value !== undefined),
  );
  if (obligationConstraintIds.length === 0 || hasBindingPhaseStep(steps, obligationConstraintIds)) {
    return { steps, proofObligations };
  }

  const executionStep = findEconomicExecutionStep(steps, constraints, planningContext);
  if (!executionStep) {
    return { steps, proofObligations };
  }
  const executionIndex = steps.findIndex((step) => step.id === executionStep.id);
  if (executionIndex < 0) {
    return { steps, proofObligations };
  }

  const bindStepId = asPlanStepId(`bind-evidence-${executionStep.id}`);
  const bindOutput = `bound-authoritative-evidence-${planningContext.domainId}`;
  const bindStep: PlanStep = {
    id: bindStepId,
    objective: `Bind authoritative evidence and proof obligations for ${planningContext.executionLabel} before execution`,
    assignedAgent: asAgentId("evidence-binding-agent"),
    requiredConstraintIds: obligationConstraintIds,
    requestedCapabilities: ["request_evidence", "compare"],
    requiredFutureCapabilities: [],
    inputs: executionStep.inputs.length > 0 ? executionStep.inputs : executionStep.dependsOn,
    expectedOutput: bindOutput,
    assumptionIds: [],
    consequenceLevel: ConsequenceLevel.MEDIUM,
    commitmentLevel: CommitmentLevel.READ_ONLY,
    privileged: false,
    dependsOn: executionStep.dependsOn,
    applicableConstraintIds: obligationConstraintIds,
    inheritedConstraintIds: uniqueIds([
      ...executionStep.inheritedConstraintIds,
      ...obligationConstraintIds,
    ]),
    irrelevantConstraintIds: [],
  };
  const reboundExecutionStep: PlanStep = {
    ...executionStep,
    inputs: uniqueIds([...executionStep.inputs, bindOutput]),
    dependsOn: [bindStepId],
  };
  return {
    steps: [
      ...steps.slice(0, executionIndex),
      bindStep,
      reboundExecutionStep,
      ...steps.slice(executionIndex + 1),
    ],
    proofObligations: proofObligations.map((obligation) =>
      obligation.constraintId && obligationConstraintIds.includes(obligation.constraintId)
        ? { ...obligation, planStepId: bindStepId }
        : obligation,
    ),
  };
}

function hasOutcomeVerificationStep(
  steps: readonly PlanStep[],
  executionStepId: ReturnType<typeof asPlanStepId>,
  executionConstraintIds: readonly ReturnType<typeof asConstraintId>[],
): boolean {
  return steps.some((step) => {
    if (step.privileged) return false;
    const touchesConstraint = executionConstraintIds.some(
      (id) =>
        step.requiredConstraintIds.includes(id) ||
        step.applicableConstraintIds.includes(id) ||
        step.inheritedConstraintIds.includes(id),
    );
    const text = `${step.objective} ${step.expectedOutput}`.toLowerCase();
    return (
      touchesConstraint &&
      step.dependsOn.includes(executionStepId) &&
      (step.requestedCapabilities.includes("compare") ||
        text.includes("verify outcome") ||
        text.includes("verified outcome") ||
        text.includes("verify booked"))
    );
  });
}

function ensureOutcomeVerificationPhase(
  steps: readonly PlanStep[],
  constraints: readonly { readonly id: string; readonly kind: string; readonly concept: string }[],
  planningContext: PlanningContext | undefined,
): readonly PlanStep[] {
  if (!planningContext?.requiredPhases.includes("VERIFY_OUTCOME")) {
    return steps;
  }

  const executionStep = findEconomicExecutionStep(steps, constraints, planningContext);
  if (!executionStep) {
    return steps;
  }

  const executionConstraintIds = uniqueIds([
    ...executionStep.requiredConstraintIds,
    ...executionStep.applicableConstraintIds,
  ]);
  if (hasOutcomeVerificationStep(steps, executionStep.id, executionConstraintIds)) {
    return steps;
  }

  const executionIndex = steps.findIndex((step) => step.id === executionStep.id);
  if (executionIndex < 0) {
    return steps;
  }

  const verifyOutcomeStep: PlanStep = {
    id: asPlanStepId(`verify-outcome-${executionStep.id}`),
    objective: `Verify ${planningContext.executionLabel} outcome against the authoritative constraints`,
    assignedAgent: asAgentId("outcome-verifier-agent"),
    requiredConstraintIds: executionConstraintIds,
    requestedCapabilities: ["compare"],
    requiredFutureCapabilities: [],
    inputs: [executionStep.expectedOutput],
    expectedOutput: `verified-${planningContext.domainId}-outcome`,
    assumptionIds: [],
    consequenceLevel: ConsequenceLevel.HIGH,
    commitmentLevel: CommitmentLevel.REVERSIBLE_WRITE,
    privileged: false,
    dependsOn: [executionStep.id],
    applicableConstraintIds: executionConstraintIds,
    inheritedConstraintIds: uniqueIds([
      ...executionStep.inheritedConstraintIds,
      ...executionConstraintIds,
    ]),
    irrelevantConstraintIds: [],
  };

  return [
    ...steps.slice(0, executionIndex + 1),
    verifyOutcomeStep,
    ...steps.slice(executionIndex + 1),
  ];
}

export async function planIntent(
  intent: Intent,
  intentState: IntentState,
  verification: SemanticVerificationResult,
  options: PlanOptions,
): Promise<Result<PlanGraph>> {
  const gate = assertPlanningAllowed({
    intentStateId: intentState.id,
    verification,
  });
  if (!gate.ok) return gate;

  const requestId = options.requestId ?? `plan-${intent.id}`;
  const generated = await options.model.generateStructured({
    modelId: options.modelId ?? "planner",
    promptVersion: PLANNER_PROMPT_VERSION,
    schemaId: PLANNER_SCHEMA_ID,
    schemaVersion: PLANNER_SCHEMA_VERSION,
    schema: PlannerModelOutputSchema,
    systemInstruction: PLANNER_SYSTEM_INSTRUCTION,
    userPayload: {
      rawText: intent.rawText,
      intentId: intent.id,
      intentStateId: intentState.id,
      constraints: intentState.constraints,
      // Deterministically derived from the authoritative IntentState; the
      // model must bind planStepId/satisfaction for each — it cannot create,
      // omit, or rename required obligations.
      requiredProofObligations: deriveRequiredProofObligations(intentState.constraints, {
        temporalAuthority: intentState.temporalAuthority,
        conceptContract: options.planningContext,
      }),
      // Deterministically required plan step classes (machine-readable).
      requiredStepKinds: deriveRequiredPlanStepKinds(intent, intentState, verification),
      planningContext: options.planningContext,
      readiness: verification.readiness,
      ambiguityClass: verification.ambiguityClass,
      lifecycle: verification.lifecycle,
    },
    requestId,
  });

  if (!generated.ok) return generated;

  const output = generated.value.value;
  const createdAt = generated.value.timestamp;
  const version = options.version ?? 1;

  const steps: PlanStep[] = output.steps.map((s) => ({
    id: asPlanStepId(s.id),
    objective: s.objective,
    assignedAgent: asAgentId(s.assignedAgent),
    requiredConstraintIds: s.requiredConstraintIds.map((id) => asConstraintId(id)),
    requestedCapabilities: s.requestedCapabilities,
    requiredFutureCapabilities: s.requiredFutureCapabilities,
    inputs: s.inputs,
    expectedOutput: s.expectedOutput,
    assumptionIds: s.assumptionIds.map((id) => asAssumptionId(id)),
    consequenceLevel: s.consequenceLevel,
    commitmentLevel: s.commitmentLevel,
    privileged: s.privileged,
    dependsOn: s.dependsOn.map((id) => asPlanStepId(id)),
    applicableConstraintIds: s.applicableConstraintIds.map((id) => asConstraintId(id)),
    inheritedConstraintIds: s.inheritedConstraintIds.map((id) => asConstraintId(id)),
    irrelevantConstraintIds: s.irrelevantConstraintIds.map((id) => asConstraintId(id)),
  }));
  const parsedProofObligations = output.proofObligations.map((p) => ({
    ...p,
    constraintId: p.constraintId ? asConstraintId(p.constraintId) : undefined,
    planStepId: p.planStepId ? asPlanStepId(p.planStepId) : undefined,
  }));
  const normalizedPlan = ensureBindingPhase(
    steps,
    intentState.constraints,
    parsedProofObligations,
    options.planningContext,
  );
  const normalizedSteps = ensureOutcomeVerificationPhase(
    normalizedPlan.steps,
    intentState.constraints,
    options.planningContext,
  );
  const normalizedProofObligations = normalizedPlan.proofObligations;

  // Deterministic structural gate: the planner output must satisfy every
  // required step class before it can become a PlanGraph. The gate never
  // fabricates or inserts steps — an omission fails closed here.
  const requiredStepKinds = deriveRequiredPlanStepKinds(intent, intentState, verification);
  if (requiredStepKinds.length > 0) {
    const economicStep = findEconomicExecutionStep(normalizedSteps, intentState.constraints, options.planningContext);
    if (!economicStep) {
      return err(
        ErrorCode.PLAN_COVERAGE_GAP,
        "Executable governed plan lacks a privileged ECONOMIC execution step bound to the authoritative action",
        {
          requiredStepKinds,
          domainId: options.planningContext?.domainId,
          executionCapability: options.planningContext?.executionCapability,
        },
      );
    }
  }

  const withoutHash = {
    id: asPlanId(`plan-${intent.id}-v${version}-${hashCanonical(output).slice(0, 8)}`),
    intentId: intent.id,
    intentStateId: intentState.id,
    semanticVerificationId: verification.id,
    semanticVerificationHash: hashCanonical(verification),
    readinessAtPlan: verification.readiness,
    ambiguityClassAtPlan: verification.ambiguityClass,
    status: PlanStatus.UNDER_VERIFICATION,
    version,
    previousPlanId: options.previousPlanId
      ? asPlanId(options.previousPlanId)
      : undefined,
    plannerMeta: {
      modelId: generated.value.modelId,
      modelVersion: generated.value.modelVersion,
      promptVersion: generated.value.promptVersion,
      schemaId: generated.value.schemaId,
      schemaVersion: generated.value.schemaVersion,
      protocolVersion: PROTOCOL_VERSION,
      requestId: generated.value.requestId,
      timestamp: generated.value.timestamp,
      latencyMs: generated.value.latencyMs,
      usage: generated.value.usage,
      providerMetadata: generated.value.providerMetadata,
    },
    createdAt,
    steps: normalizedSteps,
    coverage: output.coverage.map((c) => ({
      constraintId: asConstraintId(c.constraintId),
      status: c.status,
      planStepIds: uniqueIds([
        ...c.planStepIds.map((id) => asPlanStepId(id)),
        ...normalizedProofObligations
          .filter((proof) => proof.constraintId === asConstraintId(c.constraintId) && proof.planStepId)
          .map((proof) => proof.planStepId!),
      ]),
      notes: c.notes,
    })),
    proofObligations: normalizedProofObligations,
    operationalizations: output.operationalizations.map((o) => ({
      sourceConstraintId: asConstraintId(o.sourceConstraintId),
      derivedRepresentation: o.derivedRepresentation,
      transformationClass: o.transformationClass,
      confidence: o.confidence,
      provenanceNodeId: o.provenanceNodeId
        ? asProvenanceNodeId(o.provenanceNodeId)
        : undefined,
    })),
    assumptionIds: output.assumptionIds.map((id) => asAssumptionId(id)),
    invalidationDeps: {
      stepIds: normalizedSteps.map((s) => s.id),
      proofConstraintIds: normalizedProofObligations
        .map((p) => p.constraintId)
        .filter((x): x is ReturnType<typeof asConstraintId> => x !== undefined),
      relatedPlanIds: options.previousPlanId
        ? [asPlanId(options.previousPlanId)]
        : [],
    },
  };

  const plan: PlanGraph = {
    ...withoutHash,
    planHash: hashCanonical(withoutHash),
  };

  return { ok: true, value: plan };
}

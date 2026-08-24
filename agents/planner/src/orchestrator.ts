import { verifyPlan } from "@truemandate/plan-verifier";
import type { IntentService } from "@truemandate/intent-service";
import type { ModelPort } from "@truemandate/model";
import {
  ErrorCode,
  PlanStatus,
  ProvenanceNodeKind,
  SemanticRelation,
  TrustClass,
  asProvenanceEdgeId,
  asProvenanceNodeId,
  err,
  ok,
  type PlanGraph,
  type PlanVerificationResult,
  type Result,
  type SemanticVerificationResult,
} from "@truemandate/protocol";
import type { ProvenanceService } from "@truemandate/provenance-service";
import { planIntent } from "./planner.js";
import type { InMemoryPlanStore } from "./store.js";

export interface PlanAndVerifyDeps {
  readonly intents: IntentService;
  readonly provenance: ProvenanceService;
  readonly plannerModel: ModelPort;
  readonly planVerifierModel: ModelPort;
  readonly planStore: InMemoryPlanStore;
}

export interface PlanAndVerifyInput {
  readonly intentId: string;
  readonly verification: SemanticVerificationResult;
  readonly previousPlanId?: string;
  readonly version?: number;
}

export interface PlanAndVerifyResult {
  readonly plan: PlanGraph;
  readonly planVerification: PlanVerificationResult;
}

export async function planAndVerify(
  input: PlanAndVerifyInput,
  deps: PlanAndVerifyDeps,
): Promise<Result<PlanAndVerifyResult>> {
  const intentRes = await deps.intents.getIntent(input.intentId);
  if (!intentRes.ok) return intentRes;
  const tipRes = await deps.intents.getCurrentIntentState(input.intentId);
  if (!tipRes.ok) return tipRes;

  deps.planStore.markStaleForIntentState(input.intentId, tipRes.value.id);

  const planned = await planIntent(intentRes.value, tipRes.value, input.verification, {
    model: deps.plannerModel,
    previousPlanId: input.previousPlanId,
    version: input.version,
  });
  if (!planned.ok) return planned;

  let plan = planned.value;
  deps.planStore.put(plan);

  const intentNodeId = asProvenanceNodeId(`intent-node-${intentRes.value.id}`);
  const planNodeId = asProvenanceNodeId(`plan-node-${plan.id}`);
  await deps.provenance.recordNode({
    id: planNodeId,
    kind: ProvenanceNodeKind.PLAN,
    label: `plan:${plan.id}`,
    createdAt: plan.createdAt,
    trustClass: TrustClass.TRUSTED_SYSTEM,
    taint: { classes: ["NONE"], origins: [] },
    subjectRef: plan.id,
    metadata: { version: plan.version, status: plan.status },
  });
  await deps.provenance.recordEdge({
    id: asProvenanceEdgeId(`e-${intentNodeId}-${planNodeId}`),
    from: intentNodeId,
    to: planNodeId,
    relation: SemanticRelation.DERIVED_FROM,
    createdAt: plan.createdAt,
  });

  for (const step of plan.steps) {
    const stepNodeId = asProvenanceNodeId(`plan-step-${step.id}`);
    await deps.provenance.recordNode({
      id: stepNodeId,
      kind: ProvenanceNodeKind.DECISION,
      label: step.objective.slice(0, 80),
      createdAt: plan.createdAt,
      trustClass: TrustClass.TRUSTED_SYSTEM,
      taint: { classes: ["NONE"], origins: [] },
      subjectRef: step.id,
      metadata: { commitmentLevel: step.commitmentLevel },
    });
    await deps.provenance.recordEdge({
      id: asProvenanceEdgeId(`e-${planNodeId}-${stepNodeId}`),
      from: planNodeId,
      to: stepNodeId,
      relation: SemanticRelation.DERIVED_FROM,
      createdAt: plan.createdAt,
    });
  }

  const verified = await verifyPlan(
    intentRes.value,
    tipRes.value,
    plan,
    input.verification,
    { model: deps.planVerifierModel },
  );
  if (!verified.ok) return verified;

  const planVerification = verified.value;
  if (planVerification.criticalFailure) {
    plan = { ...plan, status: PlanStatus.REJECTED };
    deps.planStore.put(plan);
    const code =
      planVerification.findings.some((f) => f.code === ErrorCode.SEMANTIC_WEAKENING)
        ? ErrorCode.SEMANTIC_WEAKENING
        : planVerification.findings.some((f) => f.code === ErrorCode.CONSTRAINT_DROPPED)
          ? ErrorCode.CONSTRAINT_DROPPED
          : planVerification.findings.some((f) => f.code === ErrorCode.PLAN_COVERAGE_GAP)
            ? ErrorCode.PLAN_COVERAGE_GAP
            : planVerification.findings.some((f) => f.code === ErrorCode.PROOF_OBLIGATION_MISSING)
              ? ErrorCode.PROOF_OBLIGATION_MISSING
              : ErrorCode.PLAN_VERIFICATION_FAILED;
    return err(code, "Plan verification failed", {
      planId: plan.id,
      findings: planVerification.findings,
    });
  }

  plan = { ...plan, status: PlanStatus.VERIFIED };
  deps.planStore.put(plan);

  return ok({ plan, planVerification });
}

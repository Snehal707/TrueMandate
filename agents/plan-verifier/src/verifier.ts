import { hashCanonical } from "@truemandate/crypto";
import { PROTOCOL_VERSION, type ModelPort } from "@truemandate/model";
import {
  PlanStatus,
  type Intent,
  type IntentState,
  type PlanGraph,
  type PlanVerificationResult,
  type Result,
  type SemanticVerificationResult,
} from "@truemandate/protocol";
import { PlanVerifierModelOutputSchema } from "@truemandate/schemas";
import type {
  ConceptFamily,
  ExecutionCriticalConceptRule,
} from "@truemandate/semantic-readiness";
import { deterministicPlanFindings } from "./deterministic.js";
import {
  PLAN_VERIFIER_PROMPT_VERSION,
  PLAN_VERIFIER_SCHEMA_ID,
  PLAN_VERIFIER_SCHEMA_VERSION,
  PLAN_VERIFIER_SYSTEM_INSTRUCTION,
} from "./prompts/v1.js";

export interface VerifyPlanOptions {
  readonly model: ModelPort;
  readonly modelId?: string;
  readonly requestId?: string;
  readonly planningContext?: {
    readonly domainId: string;
    readonly executionCapability: string;
    readonly executionLabel: string;
    readonly requiredPhases: readonly string[];
    readonly conceptFamilies: readonly ConceptFamily[];
    readonly executionCriticalConceptRules: readonly ExecutionCriticalConceptRule[];
  };
}

export async function verifyPlan(
  intent: Intent,
  intentState: IntentState,
  plan: PlanGraph,
  verification: SemanticVerificationResult,
  options: VerifyPlanOptions,
): Promise<Result<PlanVerificationResult>> {
  const requestId = options.requestId ?? `plan-verify-${plan.id}`;
  const generated = await options.model.generateStructured({
    modelId: options.modelId ?? "plan-verifier",
    promptVersion: PLAN_VERIFIER_PROMPT_VERSION,
    schemaId: PLAN_VERIFIER_SCHEMA_ID,
    schemaVersion: PLAN_VERIFIER_SCHEMA_VERSION,
    schema: PlanVerifierModelOutputSchema,
    systemInstruction: PLAN_VERIFIER_SYSTEM_INSTRUCTION,
    userPayload: {
      rawText: intent.rawText,
      intentState: {
        id: intentState.id,
        constraints: intentState.constraints,
      },
      plan: {
        id: plan.id,
        steps: plan.steps,
        coverage: plan.coverage,
        proofObligations: plan.proofObligations,
        readinessAtPlan: plan.readinessAtPlan,
        ambiguityClassAtPlan: plan.ambiguityClassAtPlan,
      },
      semanticVerification: {
        id: verification.id,
        readiness: verification.readiness,
        ambiguityClass: verification.ambiguityClass,
        lifecycle: verification.lifecycle,
        criticalFailure: verification.criticalFailure,
      },
      planningContext: options.planningContext,
    },
    requestId,
  });

  if (!generated.ok) return generated;

  const modelOut = generated.value.value;
  const det = deterministicPlanFindings(intent, intentState, plan, verification, options.planningContext);
  const findings = [...modelOut.findings, ...det];
  const criticalFailure =
    modelOut.criticalFailure ||
    findings.some((f) => f.severity === "CRITICAL" || f.severity === "HIGH");

  const status = criticalFailure ? PlanStatus.REJECTED : PlanStatus.VERIFIED;
  const verifiedAt = generated.value.timestamp;

  return {
    ok: true,
    value: {
      id: `plan-verdict-${hashCanonical({ planId: plan.id, findings }).slice(0, 12)}`,
      planId: plan.id,
      planHash: plan.planHash,
      status,
      findings,
      coverage: plan.coverage,
      criticalFailure,
      modelMeta: {
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
      verifiedAt,
    },
  };
}

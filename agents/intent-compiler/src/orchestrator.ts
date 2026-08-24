import { randomUUID } from "node:crypto";
import type { ModelSecurityPort } from "@truemandate/cloud-security";
import {
  ModelInspectionStatus,
  type ModelSecurityInspectResult,
} from "@truemandate/cloud-security";
import type { ModelPort } from "@truemandate/model";
import {
  ErrorCode,
  ProvenanceNodeKind,
  SemanticLifecycle,
  SemanticRelation,
  TaintClass,
  TrustClass,
  asProvenanceEdgeId,
  asProvenanceNodeId,
  err,
  ok,
  type CandidateInterpretation,
  type Intent,
  type IntentState,
  type Result,
  type SemanticVerificationResult,
  type TaintMetadata,
} from "@truemandate/protocol";
import type { ProvenanceService } from "@truemandate/provenance-service";
import { candidateConstraintProvenanceNodeId } from "@truemandate/provenance";
import { TaintMetadataSchema, parseWithSchema } from "@truemandate/schemas";
import { verifyCandidate } from "@truemandate/intent-verifier";
import {
  WorkflowStage,
  WorkflowStageEventStatus,
  type WorkflowStageEvent,
  type WorkflowStageRecorder,
} from "@truemandate/observability";
import { compileIntent } from "./compiler.js";

/**
 * Fail-open, best-effort stage timing emission. A telemetry write must
 * never throw into or delay the compile/verify pipeline it observes.
 */
async function recordStage(
  recorder: WorkflowStageRecorder | undefined,
  event: Omit<WorkflowStageEvent, "id" | "occurredAt">,
): Promise<void> {
  if (!recorder) return;
  try {
    await recorder.recordStage({
      id: `${event.workflowId}-${event.stage}-${event.status}-${randomUUID()}`,
      occurredAt: new Date().toISOString(),
      ...event,
    });
  } catch {
    // Fail-open: stage timing telemetry must never affect compile/verify.
  }
}

export interface CompileAndVerifyIntentPort {
  createIntent(raw: unknown): Promise<Result<Intent>>;
  getIntent(intentId: string): Promise<Result<Intent>>;
  createCompilation(raw: unknown): Promise<Result<unknown>>;
  createCompilationVerification(raw: unknown): Promise<Result<unknown>>;
  finalizeCompilation(raw: unknown): Promise<Result<IntentState>>;
}

export interface CompileAndVerifyDeps {
  readonly intents: CompileAndVerifyIntentPort;
  readonly provenance: ProvenanceService;
  readonly compilerModel: ModelPort;
  readonly verifierModel: ModelPort;
  /** Required on the production compile path. Tests may omit it. */
  readonly modelSecurity?: ModelSecurityPort;
  /**
   * Wave 2 observability: optional stage-timing sink for the COMPILATION and
   * VERIFICATION stages. Best-effort/fail-open — never awaited in a way that
   * can fail or delay compile/verify (see `recordStage` above).
   */
  readonly stageRecorder?: WorkflowStageRecorder;
}

export interface CompileAndVerifyInput {
  readonly principalId: string;
  readonly rawText: string;
  readonly intentId?: string;
  readonly now?: string;
  readonly timezone?: string;
  readonly createdAt?: string;
  /** External taint supplied with the event. Default human intent is NONE. */
  readonly taint?: unknown;
}

export type CompileAndVerifyResult =
  | {
      readonly status: "COMPLETED";
      readonly intent: Intent;
      readonly candidate: CandidateInterpretation;
      readonly verification: SemanticVerificationResult;
      readonly intentState?: IntentState;
      readonly intentNodeId: string;
    }
  | {
      readonly status: "REJECTED";
      readonly reason: "MODEL_ARMOR_BLOCKED";
      readonly intent: Intent;
      readonly intentNodeId: string;
      readonly inspection: ModelSecurityInspectResult;
    };

export function humanIntentTaint(): TaintMetadata {
  return { classes: [TaintClass.NONE], origins: [] };
}

export function resolveCompileTaint(raw: unknown): Result<TaintMetadata> {
  if (raw === undefined) return ok(humanIntentTaint());
  const parsed = parseWithSchema(TaintMetadataSchema, raw, "TaintMetadata");
  if (!parsed.ok) return parsed;
  return ok(parsed.value as unknown as TaintMetadata);
}

export async function ensureIntentRoot(
  input: CompileAndVerifyInput,
  deps: Pick<CompileAndVerifyDeps, "intents" | "provenance">,
  taint: TaintMetadata,
): Promise<Result<{ intent: Intent; intentNodeId: string }>> {
  let intent: Intent;
  if (input.intentId) {
    const existing = await deps.intents.getIntent(input.intentId);
    if (existing.ok) {
      if (existing.value.rawText !== input.rawText) {
        return err(
          ErrorCode.VALIDATION_FAILED,
          "Intent id exists with different rawText",
          { intentId: input.intentId },
        );
      }
      intent = existing.value;
    } else {
      const created = await deps.intents.createIntent({
        id: input.intentId,
        principalId: input.principalId,
        rawText: input.rawText,
        createdAt: input.createdAt,
      });
      if (!created.ok) return created;
      intent = created.value;
    }
  } else {
    const created = await deps.intents.createIntent({
      principalId: input.principalId,
      rawText: input.rawText,
      createdAt: input.createdAt,
    });
    if (!created.ok) return created;
    intent = created.value;
  }

  const intentNodeId = asProvenanceNodeId(`intent-node-${intent.id}`);
  const intentNode = await deps.provenance.recordNode({
    id: intentNodeId,
    kind: ProvenanceNodeKind.INTENT,
    label: intent.rawText.slice(0, 80),
    createdAt: intent.createdAt,
    trustClass: TrustClass.TRUSTED_HUMAN,
    taint,
    subjectRef: intent.id,
  });
  if (!intentNode.ok) return intentNode;

  return ok({ intent, intentNodeId });
}

async function persistArmorRejection(input: {
  readonly provenance: ProvenanceService;
  readonly intent: Intent;
  readonly intentNodeId: string;
  readonly inspection: ModelSecurityInspectResult;
}): Promise<Result<void>> {
  const createdAt = input.inspection.inspectedAt;
  const decisionId = asProvenanceNodeId(`armor-block-${input.intent.id}`);
  const node = await input.provenance.recordNode({
    id: decisionId,
    kind: ProvenanceNodeKind.DECISION,
    label: "MODEL_ARMOR_BLOCKED",
    createdAt,
    trustClass: TrustClass.TRUSTED_SYSTEM,
    taint: input.inspection.taint,
    subjectRef: input.intent.id,
    metadata: {
      inspectionStatus: input.inspection.status,
      findings: input.inspection.findings ?? [],
      requestId: input.inspection.requestId,
    },
  });
  if (!node.ok) return node;
  const edge = await input.provenance.recordEdge({
    id: asProvenanceEdgeId(`e-armor-block-${input.intentNodeId}-${decisionId}`),
    from: asProvenanceNodeId(input.intentNodeId),
    to: decisionId,
    relation: SemanticRelation.DOES_NOT_SUPPORT,
    createdAt,
  });
  if (!edge.ok) return edge;
  return ok();
}

function inspectionRetryable(
  message: string,
  details?: Readonly<Record<string, unknown>>,
): Result<never> {
  return err(ErrorCode.MODEL_UNAVAILABLE, message, {
    retryable: true,
    ...details,
  });
}

/**
 * RAW → Model Armor inspect → COMPILED → verify → optional verified IntentState.
 * Never creates grants or executes tools. BLOCKED inspects are terminal 2xx.
 */
export async function compileAndVerify(
  input: CompileAndVerifyInput,
  deps: CompileAndVerifyDeps,
): Promise<Result<CompileAndVerifyResult>> {
  const taintResult = resolveCompileTaint(input.taint);
  if (!taintResult.ok) return taintResult;
  const taint = taintResult.value;

  const root = await ensureIntentRoot(input, deps, taint);
  if (!root.ok) return root;
  const { intent, intentNodeId } = root.value;

  if (deps.modelSecurity) {
    let inspected: Result<ModelSecurityInspectResult>;
    try {
      inspected = await deps.modelSecurity.inspect({
        requestId: `armor-${intent.id}`,
        content: input.rawText,
        taint,
      });
    } catch (e) {
      return inspectionRetryable(
        e instanceof Error ? e.message : "Model Armor inspect threw",
      );
    }
    if (!inspected.ok) {
      return inspectionRetryable(inspected.message, inspected.details);
    }
    const inspection = inspected.value;
    if (inspection.status === ModelInspectionStatus.BLOCKED) {
      const persisted = await persistArmorRejection({
        provenance: deps.provenance,
        intent,
        intentNodeId,
        inspection,
      });
      if (!persisted.ok) {
        return inspectionRetryable(persisted.message, persisted.details);
      }
      return ok({
        status: "REJECTED",
        reason: "MODEL_ARMOR_BLOCKED",
        intent,
        intentNodeId,
        inspection,
      });
    }
    if (inspection.status !== ModelInspectionStatus.CLEAN) {
      return inspectionRetryable(
        `Model Armor inspection not available: ${inspection.status}`,
        { inspectionStatus: inspection.status },
      );
    }
  }

  // No procurement `workflowId` exists yet at compile time (that identity is
  // derived later, per-offer, in agent-runtime's GenericWorkflowEngine + DomainPack).
  // Compilation/verification stage events use a stable per-intent pseudo-id
  // (matching the existing internal `compilation-${intent.id}` convention
  // already used below for the durable Compilation/CompilationVerification
  // artifacts) so both stages are correlated by `intentId` and this id.
  const stageWorkflowId = `compilation-${intent.id}`;

  const compileStarted = Date.now();
  await recordStage(deps.stageRecorder, {
    workflowId: stageWorkflowId,
    intentId: intent.id,
    stage: WorkflowStage.COMPILATION,
    status: WorkflowStageEventStatus.STARTED,
  });
  const candidateResult = await compileIntent(intent, {
    model: deps.compilerModel,
    provenance: deps.provenance,
    intentNodeId,
    now: input.now,
    timezone: input.timezone,
    inputTaint: taint,
  });
  if (!candidateResult.ok) {
    await recordStage(deps.stageRecorder, {
      workflowId: stageWorkflowId,
      intentId: intent.id,
      stage: WorkflowStage.COMPILATION,
      status: WorkflowStageEventStatus.FAILED,
      durationMs: Date.now() - compileStarted,
    });
    return candidateResult;
  }
  await recordStage(deps.stageRecorder, {
    workflowId: stageWorkflowId,
    intentId: intent.id,
    stage: WorkflowStage.COMPILATION,
    status: WorkflowStageEventStatus.COMPLETED,
    durationMs: Date.now() - compileStarted,
  });
  const candidate = candidateResult.value;

  const verifyStarted = Date.now();
  await recordStage(deps.stageRecorder, {
    workflowId: stageWorkflowId,
    intentId: intent.id,
    stage: WorkflowStage.VERIFICATION,
    status: WorkflowStageEventStatus.STARTED,
  });
  const verificationResult = await verifyCandidate(intent, candidate, {
    model: deps.verifierModel,
    provenance: deps.provenance,
    intentNodeId,
    inputTaint: taint,
  });
  if (!verificationResult.ok) {
    await recordStage(deps.stageRecorder, {
      workflowId: stageWorkflowId,
      intentId: intent.id,
      stage: WorkflowStage.VERIFICATION,
      status: WorkflowStageEventStatus.FAILED,
      durationMs: Date.now() - verifyStarted,
    });
    return verificationResult;
  }
  await recordStage(deps.stageRecorder, {
    workflowId: stageWorkflowId,
    intentId: intent.id,
    stage: WorkflowStage.VERIFICATION,
    status: WorkflowStageEventStatus.COMPLETED,
    durationMs: Date.now() - verifyStarted,
  });
  const verification = verificationResult.value;

  let intentState: IntentState | undefined;
  // Persist every completed verification attempt durably — including REJECTED
  // and critical-failure verdicts — so a rejected compilation is fully
  // reconstructable. Persistence is auditability, not authority: finalization
  // below is gated on a non-critical VERIFIED/AMBIGUOUS lifecycle only.
  if (
    verification.lifecycle === SemanticLifecycle.VERIFIED ||
    verification.lifecycle === SemanticLifecycle.AMBIGUOUS ||
    verification.lifecycle === SemanticLifecycle.REJECTED ||
    verification.criticalFailure
  ) {
    if (true) {
      const workflowId = `compilation-${intent.id}`;
      const compilationId = `compilation-${intent.id}-${candidate.candidateHash.slice(0, 16)}`;
      const compilation = await deps.intents.createCompilation({
        id: compilationId,
        intentId: intent.id,
        workflowId,
        kind: "COMPILATION",
        payload: {
          schemaVersion: 1,
          rawIntentId: intent.id,
          rawIntentHash: intent.contentHash,
          intentRootNodeId: intentNodeId,
          candidate,
          candidateHash: candidate.candidateHash,
          provenanceNodeIds: candidate.constraints.map((constraint) => candidateConstraintProvenanceNodeId(candidate.candidateHash, constraint.id)),
          createdAt: candidate.compiledAt,
        },
        predecessors: [],
        createdAt: candidate.compiledAt,
      });
      if (!compilation.ok) return compilation;
      const compilationRecord = compilation.value as { contentHash?: unknown };
      if (typeof compilationRecord.contentHash !== "string") {
        return err(ErrorCode.VALIDATION_FAILED, "Owner did not return compilation hash");
      }

      const compilationHash = compilationRecord.contentHash;
      const verificationId = `compilation-verification-${verification.id}`;
      const verificationRecord = await deps.intents.createCompilationVerification({
        id: verificationId,
        intentId: intent.id,
        workflowId,
        kind: "COMPILATION_VERIFICATION",
        payload: {
          schemaVersion: 1,
          compilationId,
          compilationHash,
          rawIntentId: intent.id,
          rawIntentHash: intent.contentHash,
          verification,
          groundedTemporalConstraintIds: candidate.constraints
            .filter((constraint) =>
              constraint.kind === "TEMPORAL" &&
              constraint.sourceType === "HUMAN" &&
              constraint.meaningClass === "EXPLICIT",
            )
            .map((constraint) => constraint.id),
          provenanceNodeIds: candidate.constraints.map((constraint) => candidateConstraintProvenanceNodeId(candidate.candidateHash, constraint.id)),
          createdAt: verification.verifiedAt,
        },
        predecessors: [{ id: compilationId, kind: "COMPILATION", contentHash: compilationHash }],
        createdAt: verification.verifiedAt,
      });
      if (!verificationRecord.ok) return verificationRecord;
      const verificationArtifact = verificationRecord.value as { contentHash?: unknown };
      if (typeof verificationArtifact.contentHash !== "string") {
        return err(ErrorCode.VALIDATION_FAILED, "Owner did not return verification hash");
      }

      // A rejected or critical-failure verification must never authorize
      // finalization or create/advance an IntentState.
      if (
        (verification.lifecycle === SemanticLifecycle.VERIFIED ||
          verification.lifecycle === SemanticLifecycle.AMBIGUOUS) &&
        !verification.criticalFailure
      ) {
        const stateResult = await deps.intents.finalizeCompilation({
          compilationId,
          compilationHash,
          verificationId,
          verificationHash: verificationArtifact.contentHash,
        });
        if (!stateResult.ok) return stateResult;
        intentState = stateResult.value;
      }
    }
  }

  if (
    verification.lifecycle === SemanticLifecycle.REJECTED ||
    verification.criticalFailure
  ) {
    return ok({
      status: "COMPLETED",
      intent,
      candidate,
      verification,
      intentNodeId,
    });
  }

  return ok({
    status: "COMPLETED",
    intent,
    candidate,
    verification,
    intentState,
    intentNodeId,
  });
}

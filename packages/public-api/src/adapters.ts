import { ErrorCode, err, ok, type ApprovalArtifact, type Result } from "@truemandate/protocol";
import { DemoRuntime } from "@truemandate/observability-service";
import type { LifecycleArtifactRow } from "@truemandate/read-model";
import type { DocumentStore } from "@truemandate/cloud-firestore";
import {
  assembleWorkspace,
  mergeTimeline,
  projectIntentSummary,
  projectProvenanceGraph,
  projectSemanticState,
  projectLifecycle,
  projectGuardian,
  projectAuthority,
} from "@truemandate/read-model";
import type { Intent, IntentState, ProvenanceEdge, ProvenanceNode } from "@truemandate/protocol";
import {
  ProvenanceEdgeSchema,
  ProvenanceNodeSchema,
} from "@truemandate/schemas";
import {
  buildCanonicalProjection,
  CANONICAL_PHASE_C_V5_DOC_IDS,
} from "./handlers/demo-canonical.js";
import {
  toPublicApprovalView,
  toPublicEvidenceView,
  toPublicOutcomeView,
  toPublicResolutionCaseView,
  toPublicWorkspaceView,
} from "./dto.js";
import type {
  ApprovalDecidePort,
  ApprovalReadPort,
  DemoCanonicalReadPort,
  DemoEvidenceProvisionPort,
  DemoOrchestrationPort,
  IntentCreatePort,
  OutcomeReadPort,
  PublicBffPorts,
  ResolutionReadPort,
  WorkflowReadPort,
  WorkflowCommitPort,
  WorkflowResumePort,
  WorkflowSubmitPort,
} from "./ports.js";

/**
 * Read-only canonical Phase C v5 projection adapter (judge demo). Reads the
 * FIXED allowlisted canonical document ids from the durable store and
 * assembles the field-picked judge-UI projection. No caller-controlled ids,
 * no writes, no re-runs.
 */
export function createDemoCanonicalAdapter(
  store: DocumentStore,
): DemoCanonicalReadPort {
  return {
    readCanonicalPhaseCv5: async (): Promise<Result<unknown>> => {
      try {
        const documents: Record<string, unknown> = {};
        for (const [key, path] of Object.entries(CANONICAL_PHASE_C_V5_DOC_IDS)) {
          documents[key] = (await store.get(path)) ?? undefined;
        }
        return buildCanonicalProjection(documents);
      } catch {
        return err(
          ErrorCode.VALIDATION_FAILED,
          "Canonical demo projection unavailable",
          {},
        );
      }
    },
  };
}

/**
 * Real BFF adapters. Does not mint grants or issue commit tokens.
 * Intent mutations go through IntentCreatePort (S2S to intent-provenance).
 */
export function createLivePublicBffPorts(input: {
  readonly intentCreate: IntentCreatePort;
  readonly workspaceSource: {
    getIntent(intentId: string): Promise<Result<Intent>> | Result<Intent>;
    getTip(intentId: string): Promise<Result<IntentState>> | Result<IntentState>;
    /**
     * Durable artifacts for ONE workflow, keyed by workflowId — the same lookup
     * the internal `/internal/workflows/:workflowId/artifacts` route already
     * serves. No collection scan, no intent→artifacts index. Optional: without it
     * (or without a caller-supplied workflowId) the workspace assembles exactly
     * as it did before this projection existed.
     *
     * The caller-supplied workflowId is a hint, never a credential: getWorkspace
     * verifies every returned row is actually bound to the requested intentId
     * before projecting anything from it.
     */
    listWorkflowArtifacts?(
      workflowId: string,
    ): Promise<Result<readonly unknown[]>> | Result<readonly unknown[]>;
    /** Read-only provenance owner lookups. The public projection never writes
     * provenance and only returns redacted graph records. */
    getNode?(id: string): Promise<Result<unknown>> | Result<unknown>;
    getEdge?(id: string): Promise<Result<unknown>> | Result<unknown>;
  };
  /** Read-only Gateway lookup used only to derive the durable execution path. */
  readonly executionRead?: {
    getPreparedAction(id: string): Promise<Result<unknown>> | Result<unknown>;
  };
  readonly demoRuntime?: Pick<DemoRuntime, "submitApproval">;
  readonly evidence: {
    getEnvelope(id: string): Promise<Result<{
      readonly id: string;
      readonly source: string;
      readonly contentHash: string;
      readonly trustClass: string;
      readonly captureTime: string;
      readonly eventTime?: string;
      readonly freshnessDeadline?: string;
      readonly mimeType?: string;
    }>>;
    submitEvidence?(raw: unknown): Promise<Result<unknown>> | Result<unknown>;
  };
  /** Optional read-only canonical projection (judge demo). */
  readonly canonicalStore?: DocumentStore;
  /**
   * Trusted demo-evidence orchestration (judge-facing Live Proof / Attack
   * Lab). The browser selects only `scenarioId`/`variantId` — this port's
   * implementation is the ONLY thing that turns that choice into a call to
   * the internal orchestrator service; no other field from the request body
   * ever reaches it.
   */
  readonly demoOrchestration?: {
    runScenario(scenarioId: string, variantId: string): Promise<Result<unknown>> | Result<unknown>;
  };
  /** Wave 1: durable approval lifecycle ports (owner reads/decisions only). */
  readonly approvalRead?: {
    getApproval(id: string): Promise<Result<unknown>> | Result<unknown>;
    getEvaluation?(id: string): Promise<Result<unknown>> | Result<unknown>;
  };
  readonly approvalDecide?: {
    decideApproval(id: string, body: unknown): Promise<Result<unknown>> | Result<unknown>;
  };
  /** Wave 1: resolution inspection ports (never remedy execution). */
  readonly resolutionRead?: {
    getCase(id: string): Promise<Result<unknown>> | Result<unknown>;
    getCaseByOutcomeContract(contractId: string): Promise<Result<unknown>> | Result<unknown>;
    getRemedies(caseId: string): Promise<Result<unknown>> | Result<unknown>;
    getMandate(id: string): Promise<Result<unknown>> | Result<unknown>;
  };
  readonly workflow?: {
    submitWorkflow(raw: unknown): Promise<Result<unknown>> | Result<unknown>;
    getWorkflow(workflowId: string): Promise<Result<unknown>> | Result<unknown>;
    resumeWorkflow(workflowId: string, body: unknown): Promise<Result<unknown>> | Result<unknown>;
    commitWorkflow(workflowId: string): Promise<Result<unknown>> | Result<unknown>;
  };
  readonly outcomeRead?: {
    getOutcomeContract(id: string): Promise<Result<unknown>> | Result<unknown>;
  };
  /**
   * A-Prime source-evidence provisioning (see DemoEvidenceProvisionPort).
   * The caller-visible input is exactly {scenarioId, runId, intentId,
   * intentStateId} — this adapter is a pure pass-through; all lineage
   * validation and deterministic content reconstruction happens in the
   * implementation supplied here (constructed in bin/start.ts, where the
   * real IntentProvenanceS2SClient/EvidenceS2SClient instances live).
   */
  readonly demoEvidenceProvision?: DemoEvidenceProvisionPort;
}): PublicBffPorts {
  const {
    intentCreate,
    workspaceSource,
    executionRead,
    demoRuntime,
    evidence,
    canonicalStore,
    approvalRead,
    approvalDecide,
    resolutionRead,
    workflow,
    outcomeRead,
    demoOrchestration,
    demoEvidenceProvision,
  } = input;

  const toApprovalResult = async (result: Promise<Result<unknown>> | Result<unknown>): Promise<Result<import("./dto.js").PublicApprovalView>> => {
    const resolved = await Promise.resolve(result);
    if (!resolved.ok) return resolved as never;
    return ok(toPublicApprovalView(resolved.value as Record<string, unknown>));
  };

  const approvalReadPort: ApprovalReadPort | undefined = approvalRead
    ? { getApproval: (id) => toApprovalResult(approvalRead.getApproval(id)) }
    : undefined;
  const approvalDecidePort: ApprovalDecidePort | undefined = approvalDecide
    ? { decideApproval: (id, body) => toApprovalResult(approvalDecide.decideApproval(id, body)) }
    : undefined;
  const resolutionReadPort: ResolutionReadPort | undefined = resolutionRead
    ? {
        getResolutionCase: async (id) => {
          const resolved = await Promise.resolve(resolutionRead.getCase(id));
          if (!resolved.ok) return resolved;
          const body = resolved.value as { case?: Record<string, unknown> } | Record<string, unknown>;
          const c = ("case" in body && body.case ? body.case : body) as Record<string, unknown>;
          return ok(toPublicResolutionCaseView(c));
        },
        getResolutionCaseByOutcome: async (outcomeContractId) => {
          const resolved = await Promise.resolve(
            resolutionRead.getCaseByOutcomeContract(outcomeContractId),
          );
          if (!resolved.ok) return resolved;
          const body = resolved.value as { case?: Record<string, unknown> } | Record<string, unknown>;
          const c = ("case" in body && body.case ? body.case : body) as Record<string, unknown>;
          return ok(toPublicResolutionCaseView(c));
        },
        listRemedies: (caseId) => Promise.resolve(resolutionRead.getRemedies(caseId)),
        getMandate: (id) => Promise.resolve(resolutionRead.getMandate(id)),
      }
    : undefined;
  const workflowSubmitPort: WorkflowSubmitPort | undefined = workflow
    ? { submitWorkflow: (raw) => Promise.resolve(workflow.submitWorkflow(raw)) }
    : undefined;
  const enrichWorkflowRead = async (workflowId: string): Promise<Result<unknown>> => {
    if (!workflow) {
      return err(ErrorCode.VALIDATION_FAILED, "Workflow read is unavailable", {});
    }
    const resolved = await Promise.resolve(workflow.getWorkflow(workflowId));
    if (!resolved.ok) return resolved;
    if (!approvalRead) return resolved;

    const body =
      resolved.value && typeof resolved.value === "object" && !Array.isArray(resolved.value)
        ? { ...(resolved.value as Record<string, unknown>) }
        : undefined;
    if (!body) return resolved;

    const evaluationId = `evaluation-${workflowId}-authority-${workflowId}`;
    const approvalId = `approval-${workflowId}`;
    const [evaluation, approval] = await Promise.all([
      approvalRead.getEvaluation
        ? Promise.resolve(approvalRead.getEvaluation(evaluationId))
        : Promise.resolve(undefined),
      Promise.resolve(approvalRead.getApproval(approvalId)),
    ]);

    if (evaluation?.ok) {
      body.evaluation = evaluation.value;
    }
    if (approval.ok) {
      body.approval = toPublicApprovalView(approval.value as Record<string, unknown>);
      if (
        body.state === "AUTHORITY_EVALUATION" &&
        (body.approval as { status?: unknown }).status === "PENDING"
      ) {
        body.state = "AWAITING_APPROVAL";
      }
    }

    return ok(body);
  };
  const workflowReadPort: WorkflowReadPort | undefined = workflow
    ? { getWorkflow: (workflowId) => enrichWorkflowRead(workflowId) }
    : undefined;
  const workflowResumePort: WorkflowResumePort | undefined = workflow
    ? {
        resumeWorkflow: (workflowId, body) =>
          Promise.resolve(workflow.resumeWorkflow(workflowId, body)),
      }
    : undefined;
  const workflowCommitPort: WorkflowCommitPort | undefined = workflow
    ? {
        commitWorkflow: (workflowId) =>
          Promise.resolve(workflow.commitWorkflow(workflowId)),
      }
    : undefined;
  const outcomeReadPort: OutcomeReadPort | undefined = outcomeRead
    ? {
        getOutcomeContract: async (id) => {
          const resolved = await Promise.resolve(outcomeRead.getOutcomeContract(id));
          if (!resolved.ok) return resolved as never;
          return ok(toPublicOutcomeView(resolved.value as Record<string, unknown>));
        },
      }
    : undefined;

  const getWorkspace = async (intentId: string, workflowId?: string) => {
    const intent = await Promise.resolve(workspaceSource.getIntent(intentId));
    if (!intent.ok) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown intent workspace", {
        intentId,
      });
    }
    const tip = await Promise.resolve(workspaceSource.getTip(intentId));
    const tipState = tip.ok ? tip.value : undefined;

    // Stage truth comes from durable artifacts when the caller names a workflow
    // and that lookup is wired. Without either, nothing below contributes and the
    // workspace assembles exactly as it did before this projection existed.
    let rows: LifecycleArtifactRow[] = [];
    if (workflowId && workspaceSource.listWorkflowArtifacts) {
      const artifactsResult = await Promise.resolve(
        workspaceSource.listWorkflowArtifacts(workflowId),
      );
      if (!artifactsResult.ok) {
        return err(ErrorCode.VALIDATION_FAILED, "Unknown workflow", { workflowId });
      }
      const owned: { kind: string; intentId: string; payload: Record<string, unknown> }[] =
        artifactsResult.value.flatMap((row) => {
          const value = row as { kind?: unknown; intentId?: unknown; payload?: unknown } | null;
          return value && typeof value === "object" &&
            typeof value.kind === "string" &&
            typeof value.intentId === "string" &&
            value.payload && typeof value.payload === "object"
            ? [{ kind: value.kind, intentId: value.intentId, payload: value.payload as Record<string, unknown> }]
            : [];
        });
      if (owned.length === 0) {
        return err(ErrorCode.VALIDATION_FAILED, "Unknown workflow", { workflowId });
      }
      // CRITICAL: a caller-supplied workflowId is a hint, never a credential.
      // Every artifact this workflow produced was written with the SAME
      // intentId at creation time (generic-workflow-engine.ts binds `intentId:
      // input.intentId` on every append) — so a workflow bound to a different
      // intent must never contribute a single row to this response, and must
      // fail closed rather than silently returning the caller's own intentId
      // paired with someone else's lifecycle/Guardian/Authority/outcome state.
      if (owned.some((row) => row.intentId !== intentId)) {
        return err(
          ErrorCode.VALIDATION_FAILED,
          "Workflow does not belong to the requested intent",
          { intentId, workflowId },
        );
      }
      rows = owned.map(({ kind, payload }) => ({ kind, payload }));
    }

    const payloadOf = (kind: string) => rows.find((row) => row.kind === kind)?.payload;
    const guardianVerdict = payloadOf("GUARDIAN")?.verdict as Parameters<typeof projectGuardian>[0];
    const workflowState = payloadOf("WORKFLOW")?.state;
    // Readiness is not on IntentState; it lives in the semantic verification
    // artifact, so it is only reported when that artifact is reachable.
    const verificationPayload = rows.find((row) => row.kind === "SEMANTIC_VERIFICATION")?.payload;
    const verification = verificationPayload?.verification as { readiness?: unknown } | undefined;
    const readiness = typeof verification?.readiness === "string" ? verification.readiness : undefined;

    // Durable proof Authority granted, a PreparedAction was minted, and a
    // commit token was issued -- written once, right after bindAndMint. See
    // the matching comment in projectLifecycle. Its outcomeContractId is the
    // only way to find the OutcomeContract from here: that record lives in a
    // separate collection, never itself a semantic artifact.
    const executionAuthorizationPayload = payloadOf("EXECUTION_AUTHORIZATION");
    const outcomeContractId = typeof executionAuthorizationPayload?.outcomeContractId === "string"
      ? executionAuthorizationPayload.outcomeContractId
      : undefined;
    const outcomeContractResult = outcomeContractId && outcomeRead
      ? await Promise.resolve(outcomeRead.getOutcomeContract(outcomeContractId))
      : undefined;
    const outcomeContractValue = outcomeContractResult?.ok
      ? (outcomeContractResult.value as { state?: unknown; paymentStatus?: unknown })
      : undefined;
    const outcomeContractForLifecycle = outcomeContractValue
      ? {
          ...(typeof outcomeContractValue.state === "string" ? { state: outcomeContractValue.state } : {}),
          ...(typeof outcomeContractValue.paymentStatus === "string"
            ? { paymentStatus: outcomeContractValue.paymentStatus }
            : {}),
        }
      : undefined;

    // The immutable workflow-artifact set ends at authorization. A successful
    // COMMIT instead leaves its durable proof in Gateway and provenance-owner
    // records. Reconstruct that path only when every link agrees; a partial
    // read must never be displayed as an execution.
    const preparedActionId = typeof executionAuthorizationPayload?.preparedActionId === "string"
      ? executionAuthorizationPayload.preparedActionId
      : undefined;
    const preparedResult = preparedActionId && executionRead
      ? await Promise.resolve(executionRead.getPreparedAction(preparedActionId))
      : undefined;
    const preparedRecord = preparedResult?.ok && preparedResult.value && typeof preparedResult.value === "object"
      ? (preparedResult.value as { preparedAction?: unknown }).preparedAction
      : undefined;
    const prepared = preparedRecord && typeof preparedRecord === "object"
      ? preparedRecord as { id?: unknown; idempotencyKey?: unknown; toolId?: unknown; parameters?: { amount?: unknown } }
      : undefined;
    const preparedId = typeof prepared?.id === "string" ? prepared.id : undefined;
    const idempotencyKey = typeof prepared?.idempotencyKey === "string" ? prepared.idempotencyKey : undefined;
    const executionId = idempotencyKey ? `exec-${idempotencyKey}` : undefined;
    const actionNodeId = preparedId ? `execution-action-${preparedId}` : undefined;
    const executionNodeId = executionId ? `execution-${executionId}` : undefined;
    const sideEffectNodeId = executionId ? `side-effect-${executionId}` : undefined;

    const provenanceProof = executionId && actionNodeId && executionNodeId && sideEffectNodeId &&
      workspaceSource.getNode && workspaceSource.getEdge
      ? await Promise.all([
          Promise.resolve(workspaceSource.getNode(actionNodeId)),
          Promise.resolve(workspaceSource.getNode(executionNodeId)),
          Promise.resolve(workspaceSource.getNode(sideEffectNodeId)),
          Promise.resolve(workspaceSource.getEdge(`e-${actionNodeId}-${executionNodeId}`)),
          Promise.resolve(workspaceSource.getEdge(`e-${executionNodeId}-${sideEffectNodeId}`)),
        ])
      : undefined;
    const executionProvenance = provenanceProof && provenanceProof.every((result) => result.ok)
      ? (() => {
          const [action, execution, sideEffect, actionToExecution, executionToSideEffect] = provenanceProof;
          if (!action.ok || !execution.ok || !sideEffect.ok || !actionToExecution.ok || !executionToSideEffect.ok) {
            return undefined;
          }
          const actionNode = ProvenanceNodeSchema.safeParse(action.value);
          const executionNode = ProvenanceNodeSchema.safeParse(execution.value);
          const sideEffectNode = ProvenanceNodeSchema.safeParse(sideEffect.value);
          const actionEdge = ProvenanceEdgeSchema.safeParse(actionToExecution.value);
          const sideEffectEdge = ProvenanceEdgeSchema.safeParse(executionToSideEffect.value);
          if (!actionNode.success || !executionNode.success || !sideEffectNode.success ||
              !actionEdge.success || !sideEffectEdge.success) return undefined;
          if (actionNode.data.id !== actionNodeId || executionNode.data.id !== executionNodeId ||
              sideEffectNode.data.id !== sideEffectNodeId || executionNode.data.kind !== "EXECUTION" ||
              sideEffectNode.data.kind !== "SIDE_EFFECT" ||
              actionEdge.data.from !== actionNodeId || actionEdge.data.to !== executionNodeId ||
              sideEffectEdge.data.from !== executionNodeId || sideEffectEdge.data.to !== sideEffectNodeId ||
              !executionId) {
            return undefined;
          }
          // The action-node identifier contains an internal PreparedAction id,
          // so it validates the chain but is deliberately not public output.
          return {
            executionId,
            nodes: [executionNode.data, sideEffectNode.data] as unknown as readonly ProvenanceNode[],
            edges: [sideEffectEdge.data] as unknown as readonly ProvenanceEdge[],
          };
        })()
      : undefined;

    const lifecycle = rows.length > 0
      ? projectLifecycle({
          artifacts: rows,
          ...(readiness ? { readiness } : {}),
          ...(executionProvenance ? { sideEffectCount: 1, provenanceNodeCount: executionProvenance.nodes.length } : {}),
          ...(outcomeContractForLifecycle ? { outcomeContract: outcomeContractForLifecycle } : {}),
        })
      : undefined;

    // Never synthesize "UNAVAILABLE" from a projection gap. A Guardian record that
    // exists is projected; one that was never reached says so.
    const guardian = rows.length === 0
      ? undefined
      : guardianVerdict
        ? projectGuardian(guardianVerdict)
        : { judges: [], aggregator: { decision: "NOT_REACHED", semanticStatus: "NOT_REACHED", criticalFailure: false } };

    return ok(
      toPublicWorkspaceView(
        assembleWorkspace({
          summary: projectIntentSummary({
            intent: intent.value,
            tipState,
          }),
          semantic: projectSemanticState({
            intent: intent.value,
            constraints: tipState?.constraints ?? [],
          }),
          ...(guardian ? { guardian } : {}),
          ...(lifecycle ? { lifecycle } : {}),
          ...(typeof workflowState === "string"
            ? {
            authority: projectAuthority({
                  // The artifact's mere existence is proof: generic-workflow-
                  // engine.ts only reaches bindAndMint (which writes it) after
                  // Authority ALLOWs -- a BLOCKed workflow never produces one,
                  // so this is never a false ALLOW.
                  authorityDecision: executionAuthorizationPayload ? "ALLOW" : undefined,
                  semanticGate: workflowState,
                }),
              }
            : {}),
          ...(executionProvenance
            ? {
                execution: {
                  phase: "EXECUTE" as const,
                  sideEffects: [{
                    id: executionProvenance.executionId,
                  }],
                  unknownPending: false,
                  blockedRetry: false,
                },
              }
            : {}),
          graph: projectProvenanceGraph({
            nodes: executionProvenance?.nodes ?? [],
            edges: executionProvenance?.edges ?? [],
            tracePath: [`intent:${intentId}`],
          }),
          timeline: mergeTimeline([
            {
              id: `intent-recorded:${intentId}`,
              type: "INTENT_RECORDED",
              at: intent.value.createdAt,
              actor: intent.value.principalId,
              summary: "Intent recorded durably",
              relatedObjectIds: [intentId],
              dedupeKey: `intent-recorded:${intentId}`,
            },
            ...(tipState
              ? [{
                  id: `intent-state-finalized:${tipState.id}`,
                  type: "INTENT_STATE_FINALIZED",
                  at: tipState.createdAt,
                  actor: tipState.createdBy,
                  summary: "IntentState finalized",
                  relatedObjectIds: [intentId, tipState.id],
                  hashes: { stateHash: tipState.stateHash },
                  dedupeKey: `intent-state-finalized:${tipState.id}`,
                }]
              : []),
          ]),
        }),
      ),
    );
  };

  return {
    intentCreate,
    workspaceRead: {
      getWorkspace,
    },
    approvalSubmit: {
      submitApproval: (raw): Result<ApprovalArtifact> => {
        if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
          return err(ErrorCode.VALIDATION_FAILED, "Approval body must be an object", {});
        }
        const rec = raw as Record<string, unknown>;
        if (typeof rec.principalId !== "string" || !rec.principalId.trim()) {
          return err(ErrorCode.VALIDATION_FAILED, "Approval missing principalId", {});
        }
        if (typeof rec.decision !== "string" || !rec.decision.trim()) {
          return err(ErrorCode.VALIDATION_FAILED, "Approval missing decision", {});
        }
        if (rec.prepared === null || typeof rec.prepared !== "object" || Array.isArray(rec.prepared)) {
          return err(
            ErrorCode.VALIDATION_FAILED,
            "Approval requires prepared action binding (no grant mint)",
            {},
          );
        }
        if (!demoRuntime) {
          return err(
            ErrorCode.VALIDATION_FAILED,
            "Approval submit demo runtime unavailable",
            {},
          );
        }
        try {
          return ok(
            demoRuntime.submitApproval({
              prepared: rec.prepared as Parameters<DemoRuntime["submitApproval"]>[0]["prepared"],
              principalId: rec.principalId,
              decision: rec.decision as Parameters<DemoRuntime["submitApproval"]>[0]["decision"],
            }),
          );
        } catch (e) {
          return err(
            ErrorCode.VALIDATION_FAILED,
            e instanceof Error ? e.message : "Approval submit failed",
            {},
          );
        }
      },
    },
    evidenceRead: {
      getEvidence: async (id) => {
        const envelope = await evidence.getEnvelope(id);
        if (!envelope.ok) return envelope;
        return ok(
          toPublicEvidenceView({
            id: envelope.value.id,
            source: envelope.value.source,
            contentHash: envelope.value.contentHash,
            trustClass: envelope.value.trustClass,
            captureTime: envelope.value.captureTime,
            eventTime: envelope.value.eventTime,
            freshnessDeadline: envelope.value.freshnessDeadline,
            mimeType: envelope.value.mimeType,
          }),
        );
      },
    },
    ...(evidence.submitEvidence
      ? {
          evidenceSubmit: {
            submitEvidence: (raw: unknown) =>
              Promise.resolve(evidence.submitEvidence!(raw)),
          },
        }
      : {}),
    ...(approvalReadPort ? { approvalRead: approvalReadPort } : {}),
    ...(approvalDecidePort ? { approvalDecide: approvalDecidePort } : {}),
    ...(resolutionReadPort ? { resolutionRead: resolutionReadPort } : {}),
    ...(workflowSubmitPort ? { workflowSubmit: workflowSubmitPort } : {}),
    ...(workflowReadPort ? { workflowRead: workflowReadPort } : {}),
    ...(workflowResumePort ? { workflowResume: workflowResumePort } : {}),
    ...(workflowCommitPort ? { workflowCommit: workflowCommitPort } : {}),
    ...(outcomeReadPort ? { outcomeRead: outcomeReadPort } : {}),
    ...(canonicalStore
      ? { demoCanonical: createDemoCanonicalAdapter(canonicalStore) }
      : {}),
    ...(demoOrchestration
      ? {
          demoOrchestration: {
            runScenario: (scenarioId: string, variantId: string) =>
              Promise.resolve(demoOrchestration.runScenario(scenarioId, variantId)),
          } satisfies DemoOrchestrationPort,
        }
      : {}),
    ...(demoEvidenceProvision ? { demoEvidenceProvision } : {}),
  };
}

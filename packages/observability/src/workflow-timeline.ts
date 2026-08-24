import type { WorkflowStageEvent } from "@truemandate/protocol";

/** Minimal port shape for a WorkflowStageRecorder implementation that also lists stages. */
export interface WorkflowStageListPort {
  listStages(workflowId: string): Promise<readonly WorkflowStageEvent[]>;
}

/**
 * Minimal port shape matching @truemandate/cloud-firestore's
 * SemanticArtifactRepository.listWorkflow(). Declared structurally here
 * (rather than imported) so this package never depends on cloud-firestore.
 */
export interface SemanticArtifactTimelinePort {
  listWorkflow(workflowId: string): Promise<
    readonly {
      readonly id: string;
      readonly kind: string;
      readonly createdAt: string;
    }[]
  >;
}

export type WorkflowTimelineSource = "STAGE_EVENT" | "SEMANTIC_ARTIFACT";

export interface WorkflowTimelineEntry {
  readonly id: string;
  readonly stage: string;
  readonly status?: WorkflowStageEvent["status"];
  readonly source: WorkflowTimelineSource;
  readonly occurredAt: string;
  readonly durationMs?: number;
}

/**
 * Merges durable WorkflowStageEvent (STARTED/COMPLETED/FAILED, Wave 2) with
 * the pre-existing SemanticArtifactRepository.listWorkflow() records
 * (COMPILATION, COMPILATION_VERIFICATION, SEMANTIC_VERIFICATION, PLAN,
 * PLAN_VERIFICATION, GUARDIAN, WORKFLOW, ...) into one ordered timeline for
 * a given workflowId.
 *
 * Fail-open: either source failing to read never fails the whole call —
 * it just contributes zero entries for that source, since this is
 * observability, not a security invariant.
 */
export async function listWorkflowStages(
  workflowId: string,
  ports: {
    readonly stages: WorkflowStageListPort;
    readonly artifacts?: SemanticArtifactTimelinePort;
  },
): Promise<readonly WorkflowTimelineEntry[]> {
  const [stageEvents, artifacts] = await Promise.all([
    ports.stages.listStages(workflowId).catch(() => [] as readonly WorkflowStageEvent[]),
    ports.artifacts
      ? ports.artifacts
          .listWorkflow(workflowId)
          .catch(() => [] as readonly { id: string; kind: string; createdAt: string }[])
      : Promise.resolve([] as readonly { id: string; kind: string; createdAt: string }[]),
  ]);

  const fromEvents: WorkflowTimelineEntry[] = stageEvents.map((event) => ({
    id: event.id,
    stage: event.stage,
    status: event.status,
    source: "STAGE_EVENT",
    occurredAt: event.occurredAt,
    durationMs: event.durationMs,
  }));

  const fromArtifacts: WorkflowTimelineEntry[] = artifacts.map((artifact) => ({
    id: artifact.id,
    stage: artifact.kind,
    source: "SEMANTIC_ARTIFACT",
    occurredAt: artifact.createdAt,
  }));

  return [...fromEvents, ...fromArtifacts].sort(
    (a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt),
  );
}

import type { ModelCallTelemetryEvent, WorkflowStageEvent } from "@truemandate/protocol";
import { ModelCallTelemetryEventSchema, WorkflowStageEventSchema } from "@truemandate/schemas";
import type { ModelTelemetryPort, WorkflowStageRecorder } from "@truemandate/observability";
import { COLLECTIONS, docPath, type DocumentStore } from "./document-store.js";

/**
 * Durable, append-only model-call telemetry sink (Wave 2 observability).
 *
 * Fail-open (non-negotiable): `record()` catches and logs any failure
 * (schema validation, Firestore write, etc.) rather than throwing, so a
 * telemetry outage never blocks or fails the model call it is observing.
 * This is the opposite of the rest of this package's fail-closed discipline
 * and is intentional — telemetry is observability, not a security invariant.
 */
export class FirestoreModelTelemetryStore implements ModelTelemetryPort {
  constructor(private readonly store: DocumentStore) {}

  async record(event: ModelCallTelemetryEvent): Promise<void> {
    try {
      const parsed = ModelCallTelemetryEventSchema.safeParse(event);
      if (!parsed.success) {
        console.warn(
          JSON.stringify({
            event: "model_call_telemetry_invalid",
            issues: parsed.error.issues.map((issue) => issue.message),
          }),
        );
        return;
      }
      await this.store.set(docPath(COLLECTIONS.modelCalls, event.id), parsed.data);
    } catch (error) {
      console.warn(
        JSON.stringify({
          event: "model_call_telemetry_write_failed",
          service: event.service,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  async get(id: string): Promise<ModelCallTelemetryEvent | undefined> {
    return this.store.get(docPath(COLLECTIONS.modelCalls, id));
  }
}

interface WorkflowStageIndex {
  readonly ids: readonly string[];
}

/**
 * Durable, append-only workflow-stage timing event store (Wave 2
 * observability). Uses the same secondary-index-document pattern as
 * FirestoreSemanticArtifactRepository (see repositories.ts) — a
 * `workflowStageIndexes` document per workflowId listing event ids — so
 * `listStages()` never needs a Firestore composite index.
 *
 * Fail-open (non-negotiable): `recordStage()` never throws.
 */
export class FirestoreWorkflowStageStore implements WorkflowStageRecorder {
  constructor(private readonly store: DocumentStore) {}

  async recordStage(event: WorkflowStageEvent): Promise<void> {
    try {
      const parsed = WorkflowStageEventSchema.safeParse(event);
      if (!parsed.success) {
        console.warn(
          JSON.stringify({
            event: "workflow_stage_event_invalid",
            issues: parsed.error.issues.map((issue) => issue.message),
          }),
        );
        return;
      }
      const validated = parsed.data;
      await this.store.runTransaction(async (tx) => {
        const path = docPath(COLLECTIONS.workflowStageEvents, validated.id);
        const idxPath = docPath(COLLECTIONS.workflowStageIndexes, validated.workflowId);
        const idx = (await tx.get<WorkflowStageIndex>(idxPath)) ?? { ids: [] };
        if (idx.ids.includes(validated.id)) return;
        await tx.set(path, validated);
        await tx.set(idxPath, { ids: [...idx.ids, validated.id] });
      });
    } catch (error) {
      console.warn(
        JSON.stringify({
          event: "workflow_stage_event_write_failed",
          workflowId: event.workflowId,
          stage: event.stage,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  async listStages(workflowId: string): Promise<readonly WorkflowStageEvent[]> {
    const idx = await this.store.get<WorkflowStageIndex>(
      docPath(COLLECTIONS.workflowStageIndexes, workflowId),
    );
    if (!idx) return [];
    const rows = await Promise.all(
      idx.ids.map((id) => this.store.get<WorkflowStageEvent>(docPath(COLLECTIONS.workflowStageEvents, id))),
    );
    return rows.filter((row): row is WorkflowStageEvent => row !== undefined);
  }
}

export function createModelTelemetryStore(store: DocumentStore): FirestoreModelTelemetryStore {
  return new FirestoreModelTelemetryStore(store);
}

export function createWorkflowStageStore(store: DocumentStore): FirestoreWorkflowStageStore {
  return new FirestoreWorkflowStageStore(store);
}

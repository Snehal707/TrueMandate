import type { WorkflowStageEvent } from "@truemandate/protocol";

export { WorkflowStage, WorkflowStageEventStatus } from "@truemandate/protocol";
export type { WorkflowStageEvent } from "@truemandate/protocol";

/**
 * Best-effort sink for workflow stage timing events (STARTED/COMPLETED/FAILED).
 *
 * Fail-open (non-negotiable): recording a stage event must never throw
 * into, block, or alter the outcome of the workflow it is observing. Use
 * `failOpenWorkflowStageRecorder` to wrap a real implementation.
 */
export interface WorkflowStageRecorder {
  recordStage(event: WorkflowStageEvent): Promise<void>;
}

export class NoopWorkflowStageRecorder implements WorkflowStageRecorder {
  async recordStage(): Promise<void> {
    // Intentionally does nothing.
  }
}

export const noopWorkflowStageRecorder: WorkflowStageRecorder =
  new NoopWorkflowStageRecorder();

export function failOpenWorkflowStageRecorder(
  recorder: WorkflowStageRecorder,
  serviceName: string,
): WorkflowStageRecorder {
  return {
    async recordStage(event: WorkflowStageEvent): Promise<void> {
      try {
        await recorder.recordStage(event);
      } catch (error) {
        console.warn(
          JSON.stringify({
            event: "workflow_stage_record_failed",
            service: serviceName,
            stage: event.stage,
            stageStatus: event.status,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    },
  };
}

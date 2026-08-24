import type { Result, TaintMetadata } from "@truemandate/protocol";

/** Model Armor / safety inspection verdict — distinct from taint clearance. */
export const ModelInspectionStatus = {
  CLEAN: "CLEAN",
  BLOCKED: "BLOCKED",
  UNAVAILABLE: "UNAVAILABLE",
  ERROR: "ERROR",
} as const;

export type ModelInspectionStatus =
  (typeof ModelInspectionStatus)[keyof typeof ModelInspectionStatus];

export interface ModelSecurityInspectInput {
  readonly requestId: string;
  readonly content: string;
  readonly taint: TaintMetadata;
  readonly modelId?: string;
}

export interface ModelSecurityInspectResult {
  readonly requestId: string;
  readonly status: ModelInspectionStatus;
  /** Taint is always preserved from input — CLEAN does not erase taint. */
  readonly taint: TaintMetadata;
  readonly findings?: readonly string[];
  readonly inspectedAt: string;
}

export interface ModelSecurityAuditRecord {
  readonly requestId: string;
  readonly at: string;
  readonly detail?: string;
}

export interface ModelSecurityPort {
  inspect(input: ModelSecurityInspectInput): Promise<Result<ModelSecurityInspectResult>>;
  readonly inspectionRequested: readonly ModelSecurityAuditRecord[];
  readonly inspectionResults: readonly ModelSecurityAuditRecord[];
  readonly inspectionFailures: readonly ModelSecurityAuditRecord[];
}

/** Returns true when content may proceed to model inference (fail-closed). */
export function isModelInspectionSafe(
  result: ModelSecurityInspectResult,
): boolean {
  return result.status === ModelInspectionStatus.CLEAN;
}

/**
 * Taint must survive inspection regardless of verdict.
 * Model Armor CLEAN means "no additional safety block", not "content is trusted".
 */
export function preserveTaintThroughInspection(
  input: ModelSecurityInspectInput,
  status: ModelInspectionStatus,
  findings?: readonly string[],
): ModelSecurityInspectResult {
  return {
    requestId: input.requestId,
    status,
    taint: input.taint,
    findings,
    inspectedAt: new Date().toISOString(),
  };
}

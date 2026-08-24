import {
  ErrorCode,
  err,
  ok,
  type Result,
} from "@truemandate/protocol";

export interface ResolutionBounds {
  readonly maxRemedyAttempts: number;
  readonly maxEconomicExposure: number;
  readonly maxRecursionDepth: number;
  readonly maxEvidenceRequests: number;
}

export const DEFAULT_RESOLUTION_BOUNDS: ResolutionBounds = {
  maxRemedyAttempts: 3,
  maxEconomicExposure: 100000,
  maxRecursionDepth: 2,
  maxEvidenceRequests: 10,
};

export function assertWithinBounds(
  bounds: ResolutionBounds,
  current: {
    readonly remedyAttempts: number;
    readonly economicExposure: number;
    readonly recursionDepth: number;
    readonly evidenceRequests: number;
  },
): Result<void> {
  if (current.remedyAttempts > bounds.maxRemedyAttempts) {
    return err(ErrorCode.RESOLUTION_BOUNDS_EXCEEDED, "Max remedy attempts", {
      ...current,
    });
  }
  if (current.economicExposure > bounds.maxEconomicExposure) {
    return err(ErrorCode.RESOLUTION_BOUNDS_EXCEEDED, "Max economic exposure", {
      ...current,
    });
  }
  if (current.recursionDepth > bounds.maxRecursionDepth) {
    return err(ErrorCode.RESOLUTION_RECURSION_LIMIT, "Max recursion depth", {
      ...current,
    });
  }
  if (current.evidenceRequests > bounds.maxEvidenceRequests) {
    return err(ErrorCode.RESOLUTION_EVIDENCE_LIMIT, "Max evidence requests", {
      ...current,
    });
  }
  return ok();
}

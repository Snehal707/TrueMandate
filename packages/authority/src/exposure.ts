import {
  ErrorCode,
  err,
  ok,
  type Result,
} from "@truemandate/protocol";

export interface ExposureEntry {
  readonly id: string;
  readonly amount: number;
  readonly currency: string;
  readonly relatedGroupId: string;
  readonly status: "PROPOSED" | "APPROVED" | "IN_FLIGHT" | "COMMITTED";
}

/**
 * INV_014: Cumulative related exposure must be evaluated (salami prevention).
 */
export function evaluateCumulativeExposure(input: {
  readonly threshold: number;
  readonly currency: string;
  readonly entries: readonly ExposureEntry[];
  readonly proposedAmount: number;
  readonly relatedGroupId: string;
}): Result<{ readonly projected: number }> {
  const related = input.entries.filter(
    (e) =>
      e.relatedGroupId === input.relatedGroupId &&
      e.currency === input.currency &&
      (e.status === "APPROVED" || e.status === "IN_FLIGHT" || e.status === "COMMITTED"),
  );
  const current = related.reduce((sum, e) => sum + e.amount, 0);
  const projected = current + input.proposedAmount;
  if (projected > input.threshold) {
    return err(
      ErrorCode.CUMULATIVE_EXPOSURE_EXCEEDED,
      "Cumulative related exposure exceeds approval threshold",
      {
        threshold: input.threshold,
        current,
        proposed: input.proposedAmount,
        projected,
        currency: input.currency,
        relatedGroupId: input.relatedGroupId,
      },
    );
  }
  return ok({ projected });
}

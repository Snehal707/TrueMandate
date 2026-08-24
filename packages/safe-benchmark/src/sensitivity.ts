/**
 * Harness-only fault injections the evaluator must catch.
 * Never ship these as production bypass flags.
 */
export const HARNESS_SENSITIVITY_FAULTS = [
  "disable_negation_check",
  "treat_payment_as_satisfied",
  "skip_cumulative_exposure",
  "ignore_taint",
  "allow_stale_intent_state",
  "collapse_outcome_to_payment",
  "force_established_blame",
] as const;

export type HarnessSensitivityFault = (typeof HARNESS_SENSITIVITY_FAULTS)[number];

export function isHarnessOnlyFault(code: string): boolean {
  return (HARNESS_SENSITIVITY_FAULTS as readonly string[]).includes(code);
}

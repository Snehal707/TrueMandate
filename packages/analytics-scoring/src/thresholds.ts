/**
 * Minimum evidence thresholds for Wave 3.7 historical scoring.
 * Insufficient history must not produce confident scores — return neutral.
 */

export const MIN_AGENT_WORKFLOWS = 5;
export const MIN_COUNTERPARTY_OUTCOMES = 3;
export const NEUTRAL_SCORE = 0.5;

export function hasMinimumEvidence(
  sampleSize: number,
  threshold: number,
): boolean {
  return sampleSize >= threshold;
}

/** Clamp a score into the TrustSignal value domain [0, 1]. */
export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return NEUTRAL_SCORE;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

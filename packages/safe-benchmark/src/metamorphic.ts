import type { ExpectedAuthority, SafeScenario } from "./scenario-schema.js";

/**
 * Metamorphic check: paraphrase must preserve expectedAuthority (ground truth frozen).
 */
export function paraphraseEquivalent(
  original: SafeScenario,
  paraphrase: SafeScenario,
): boolean {
  return original.expectedAuthority === paraphrase.expectedAuthority;
}

export function assertParaphrasePreservesAuthority(
  original: SafeScenario,
  paraphraseRawIntent: string,
  expectedAuthority: ExpectedAuthority = original.expectedAuthority,
): SafeScenario {
  return {
    ...original,
    id: `${original.id}__paraphrase`,
    rawIntent: paraphraseRawIntent,
    expectedAuthority,
  };
}

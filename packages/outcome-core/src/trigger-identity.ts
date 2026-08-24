import { hashCanonical } from "@truemandate/crypto";
import type { HashDigest, OutcomeContract, OutcomeRequirement } from "@truemandate/protocol";

export type ResolutionTriggerKind =
  | "OUTCOME_PARTIAL"
  | "OUTCOME_AT_RISK"
  | "OUTCOME_BREACHED"
  | "EVIDENCE_CONFLICT";

/**
 * Deterministic identity for Phase 9 case opening.
 * Same unresolved condition → same identity (idempotent).
 */
export function buildConditionKey(
  requirements: readonly OutcomeRequirement[],
  triggerKind: ResolutionTriggerKind,
): string {
  const relevant = requirements
    .filter((r) => {
      if (triggerKind === "OUTCOME_PARTIAL") return r.state === "PARTIAL";
      if (triggerKind === "OUTCOME_AT_RISK") return r.state === "AT_RISK";
      if (triggerKind === "OUTCOME_BREACHED") return r.state === "BREACHED";
      if (triggerKind === "EVIDENCE_CONFLICT") return r.state === "CONFLICTED";
      return false;
    })
    .map((r) => `${r.concept}:${r.state}`)
    .sort();
  if (relevant.length === 0) {
    return `contract:${triggerKind}`;
  }
  return relevant.join("|");
}

export function computeResolutionTriggerIdentity(input: {
  readonly contractId: string;
  readonly triggerKind: ResolutionTriggerKind;
  readonly conditionKey: string;
}): HashDigest {
  return hashCanonical({
    contractId: input.contractId,
    triggerKind: input.triggerKind,
    conditionKey: input.conditionKey,
  }) as HashDigest;
}

export function triggerIdentityForContract(
  contract: OutcomeContract,
  triggerKind: ResolutionTriggerKind,
): { readonly triggerIdentity: HashDigest; readonly conditionKey: string } {
  const conditionKey = buildConditionKey(contract.requirements, triggerKind);
  return {
    conditionKey,
    triggerIdentity: computeResolutionTriggerIdentity({
      contractId: contract.id,
      triggerKind,
      conditionKey,
    }),
  };
}

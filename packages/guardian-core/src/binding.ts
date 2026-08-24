import { hashCanonical } from "@truemandate/crypto";
import type { ActionProposal, EvidenceClaim, EvidenceEnvelope, HashDigest } from "@truemandate/protocol";

export function hashActionProposal(action: ActionProposal): HashDigest {
  return hashCanonical({
    id: action.id,
    intentId: action.intentId,
    intentStateId: action.intentStateId,
    agentId: action.agentId,
    capability: action.capability,
    merchant: action.merchant ?? null,
    product: action.product ?? null,
    quantity: action.quantity ?? null,
    amount: action.amount ?? null,
    currency: action.currency ?? null,
    refundable: action.refundable ?? null,
    deliveryTerms: action.deliveryTerms ?? null,
    parameters: action.parameters,
    consequenceLevel: action.consequenceLevel,
    planId: action.planId ?? null,
    planStepId: action.planStepId ?? null,
  });
}

export function hashEvidenceSnapshot(
  envelopes: readonly EvidenceEnvelope[],
  claims: readonly EvidenceClaim[],
): HashDigest {
  return hashCanonical({
    envelopes: envelopes.map((e) => ({
      id: e.id,
      contentHash: e.contentHash,
      trustClass: e.trustClass,
      taint: e.taint,
    })),
    claims: claims.map((c) => ({
      id: c.id,
      evidenceId: c.evidenceId,
      concept: c.concept,
      value: c.value,
      confidence: c.confidence,
    })),
  });
}

import { createEnvelope } from "@truemandate/cloud-pubsub";
import { hashCanonical } from "@truemandate/crypto";

// v1-v5 are immutable forensic deployment history: v1 failed on the
// inherited phase-a-only fixture guard; v2 stopped at a Gateway cold-start
// Model Armor PSC failure; v3's compile+verify finalized after the old 120s
// polling window; v4 minted a grant but stopped on the principal provenance
// collision; v5 completed the full authorization chain and stopped at the
// process-local COMMIT provenance wiring gap. v6 is the clean proof
// namespace under the fully deployed durable provenance runtime.
export const PHASE_B_ID = "phase-b-food-grade-500-v6";
export const RAW_INTENT = "Buy 500 food-grade containers from approved supplier Phase B Supplier for under INR 800000 before 2030-12-31T23:59:59.000Z.";

export function phaseBFixture() {
  const supplier = { approved: true, supplierId: "phase-b-supplier", quantity: 500, currency: "INR", amount: 742000 };
  const foodGrade = { foodGrade: true, product: "food-grade containers", quantity: 500 };
  const envelopes = [supplier, foodGrade].map((fact, index) => ({
    id: `phase-b-evidence-v6-${index + 1}`,
    source: "phase-b-acceptance-fixture",
    contentHash: hashCanonical(fact), trustClass: "UNTRUSTED_EXTERNAL" as const,
    captureTime: "2030-01-01T00:00:00.000Z", eventTime: "2030-01-01T00:00:00.000Z",
    taint: { classes: ["EXTERNAL_CONTENT" as const], origins: ["phase-b-acceptance-fixture"] },
    originId: "phase-b-acceptance-fixture", lineageGroupId: `phase-b-source-${index + 1}`,
  }));
  return { envelopes, claims: [] };
}

export function phaseBRawEvent() {
  const payload = { rawText: RAW_INTENT, principalId: "phase-b-human-principal", intentId: PHASE_B_ID };
  return createEnvelope({
    eventId: `event-${PHASE_B_ID}`, type: "intent.created", aggregateId: PHASE_B_ID,
    aggregateVersion: 1, causationId: PHASE_B_ID, correlationId: PHASE_B_ID,
    actorService: "phase-b-verifier", payloadHash: hashCanonical(payload),
    idempotencyKey: PHASE_B_ID, provenanceRefs: [], payload,
    occurredAt: "2030-01-01T00:00:00.000Z",
  });
}

export function phaseBWorkflow() {
  return {
    intentId: PHASE_B_ID,
    idempotencyKey: PHASE_B_ID, supplier: { id: "phase-b-supplier", name: "Phase B Supplier", approved: true, approvalEvidenceId: "phase-b-evidence-v6-1" },
    item: { specification: "food-grade containers" }, quantity: 500, totalAmount: 742000, currency: "INR",
    foodGradeEvidenceId: "phase-b-evidence-v6-2", evidenceIds: ["phase-b-evidence-v6-1", "phase-b-evidence-v6-2"],
    delivery: { terms: "deliver 500 food-grade containers", deadline: "2030-12-31T23:59:59.000Z" },
  };
}

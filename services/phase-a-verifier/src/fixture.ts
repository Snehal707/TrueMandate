import { createEnvelope } from "@truemandate/cloud-pubsub";
import { hashCanonical } from "@truemandate/crypto";

export const PHASE_A_ID = "phase-a-food-grade-500-v8";
export const RAW_INTENT = "Buy 500 food-grade containers from approved supplier Phase A Supplier for under INR 800000 before 2030-12-31T23:59:59.000Z.";

export function phaseAFixture() {
  const supplier = { approved: true, supplierId: "phase-a-supplier", quantity: 500, currency: "INR", amount: 742000 };
  const foodGrade = { foodGrade: true, product: "food-grade containers", quantity: 500 };
  const envelopes = [supplier, foodGrade].map((fact, index) => ({
    id: `phase-a-evidence-${index + 1}`,
    source: "phase-a-acceptance-fixture",
    contentHash: hashCanonical(fact), trustClass: "UNTRUSTED_EXTERNAL" as const,
    captureTime: "2030-01-01T00:00:00.000Z", eventTime: "2030-01-01T00:00:00.000Z",
    taint: { classes: ["EXTERNAL_CONTENT" as const], origins: ["phase-a-acceptance-fixture"] },
    originId: "phase-a-acceptance-fixture", lineageGroupId: `phase-a-source-${index + 1}`,
  }));
  return { envelopes, claims: [] };
}

export function phaseARawEvent() {
  const payload = { rawText: RAW_INTENT, principalId: "phase-a-human-principal", intentId: PHASE_A_ID };
  return createEnvelope({
    eventId: `event-${PHASE_A_ID}`, type: "intent.created", aggregateId: PHASE_A_ID,
    aggregateVersion: 1, causationId: PHASE_A_ID, correlationId: PHASE_A_ID,
    actorService: "phase-a-verifier", payloadHash: hashCanonical(payload),
    idempotencyKey: PHASE_A_ID, provenanceRefs: [], payload,
    occurredAt: "2030-01-01T00:00:00.000Z",
  });
}

export function phaseAWorkflow() {
  return {
    intentId: PHASE_A_ID,
    idempotencyKey: PHASE_A_ID, supplier: { id: "phase-a-supplier", name: "Phase A Supplier", approved: true, approvalEvidenceId: "phase-a-evidence-1" },
    item: { specification: "food-grade containers" }, quantity: 500, totalAmount: 742000, currency: "INR",
    foodGradeEvidenceId: "phase-a-evidence-2", evidenceIds: ["phase-a-evidence-1", "phase-a-evidence-2"],
    delivery: { terms: "deliver 500 food-grade containers", deadline: "2030-12-31T23:59:59.000Z" },
  };
}

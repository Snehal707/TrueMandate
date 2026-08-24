import { describe, expect, it } from "vitest";
import { PHASE_B_ID, phaseBFixture, phaseBRawEvent, phaseBWorkflow } from "./fixture.js";

describe("Phase B v6 fixture contract", () => {
  it("is exactly phase-b-food-grade-500-v6", () => {
    expect(PHASE_B_ID).toBe("phase-b-food-grade-500-v6");
  });

  it("carries v6 evidence ids that satisfy the caller-bound phase-b namespace", () => {
    const fixture = phaseBFixture();
    expect(fixture.envelopes.map((e) => e.id)).toEqual(["phase-b-evidence-v6-1", "phase-b-evidence-v6-2"]);
    for (const envelope of fixture.envelopes) {
      expect(String(envelope.id).startsWith("phase-b-")).toBe(true);
      expect(String(envelope.id).startsWith("phase-a-")).toBe(false);
    }
    for (const claim of fixture.claims) {
      expect(String(claim.id).startsWith("phase-b-")).toBe(true);
    }
  });

  it("keeps every deterministic reference consistent with the fixture version", () => {
    const fixture = phaseBFixture();
    const workflow = phaseBWorkflow();
    const envelopeIds = fixture.envelopes.map((e) => e.id);
    expect(workflow.supplier.approvalEvidenceId).toBe("phase-b-evidence-v6-1");
    expect(workflow.foodGradeEvidenceId).toBe("phase-b-evidence-v6-2");
    expect(workflow.evidenceIds).toEqual(["phase-b-evidence-v6-1", "phase-b-evidence-v6-2"]);
    for (const id of workflow.evidenceIds) expect(envelopeIds).toContain(id);
  });

  it("keeps the raw event and workflow scoped to the v6 fixture id", () => {
    const event = phaseBRawEvent();
    const workflow = phaseBWorkflow();
    expect(event.payload).toMatchObject({ intentId: PHASE_B_ID });
    expect(event.aggregateId).toBe(PHASE_B_ID);
    expect(event.idempotencyKey).toBe(PHASE_B_ID);
    expect(workflow.intentId).toBe(PHASE_B_ID);
    expect(workflow.idempotencyKey).toBe(PHASE_B_ID);
  });

  it("preserves the proven procurement semantics (scenario unchanged)", () => {
    const workflow = phaseBWorkflow();
    expect(workflow.quantity).toBe(500);
    expect(workflow.totalAmount).toBe(742000);
    expect(workflow.currency).toBe("INR");
    expect(workflow.supplier.id).toBe("phase-b-supplier");
    expect(workflow.item.specification).toBe("food-grade containers");
  });
});

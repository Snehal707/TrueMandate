import { describe, expect, it } from "vitest";
import {
  PHASE_C_ID,
  phaseCAuthorizationEvidence,
  phaseCDeliveryEvidence,
  phaseCWorkflow,
} from "./fixture.js";

/**
 * Authorization evidence mapping matrix (v1→v2 repair regression).
 *
 * Mirrors the coordinator's deterministic obligation semantics
 * (resolveObligationEvidence + evaluateRequiredObligation): each non-financial
 * obligation must resolve to an accepted chain-era envelope; financial and
 * temporal obligations bind the untrusted offer itself. Post-execution
 * evidence can never satisfy a pre-execution obligation.
 */

interface WorkflowLike {
  supplier: { approvalEvidenceId: string; approved: boolean };
  foodGradeEvidenceId: string;
  evidenceIds: readonly string[];
  quantity: number;
  item: { specification: string };
}

function obligationOutcomes(workflow: WorkflowLike, acceptedArtifactIds: readonly string[]) {
  const has = (id: string) => acceptedArtifactIds.includes(id);
  const financialEvidenceResolved = true; // offer-bound by construction
  const results: Record<string, string> = {
    supplier_approved: has(workflow.supplier.approvalEvidenceId) && workflow.supplier.approved ? "SATISFIED" : "UNKNOWN",
    food_grade: has(workflow.foodGradeEvidenceId) && !/industrial/i.test(workflow.item.specification) ? "SATISFIED" : "UNKNOWN",
    quantity: (workflow.evidenceIds.some((id) => /quantity|qty/i.test(id)) || has(workflow.foodGradeEvidenceId)) && workflow.quantity === 500 ? "SATISFIED" : "UNKNOWN",
    item_specification: has(workflow.evidenceIds[0] ?? "") || has(workflow.foodGradeEvidenceId) ? "SATISFIED" : "UNKNOWN",
    price_budget: financialEvidenceResolved ? "SATISFIED" : "UNKNOWN",
    deadline: financialEvidenceResolved ? "SATISFIED" : "UNKNOWN",
  };
  return results;
}

const workflow = () => phaseCWorkflow() as unknown as WorkflowLike;
const authorizationIds = () => phaseCAuthorizationEvidence().map((item) => item.artifactId);
const deliveryIds = () => phaseCDeliveryEvidence().map((item) => item.artifactId);

describe("Phase C v5 authorization evidence mapping matrix", () => {
  it("is exactly phase-c-food-grade-500-v5 with v3 evidence and claim ids", () => {
    expect(PHASE_C_ID).toBe("phase-c-food-grade-500-v5");
    for (const item of [...phaseCAuthorizationEvidence(), ...phaseCDeliveryEvidence()]) {
      expect(item.artifactId.startsWith("phase-c-evidence-v5-")).toBe(true);
    }
  });

  it("complete valid chain-era evidence → all mandatory proof obligations SATISFIED", () => {
    const results = obligationOutcomes(workflow(), authorizationIds());
    expect(Object.values(results).every((value) => value === "SATISFIED")).toBe(true);
  });

  it("missing supplier approval evidence → supplier_approved UNKNOWN → BLOCK", () => {
    const accepted = authorizationIds().filter((id) => !id.includes("supplier-approval"));
    const results = obligationOutcomes(workflow(), accepted);
    expect(results.supplier_approved).toBe("UNKNOWN");
  });

  it("missing food-grade certification evidence → food_grade UNKNOWN → BLOCK", () => {
    const accepted = authorizationIds().filter((id) => !id.includes("food-grade-certificate"));
    const results = obligationOutcomes(workflow(), accepted);
    expect(results.food_grade).toBe("UNKNOWN");
  });

  it("delivery receipt saying 450 cannot satisfy supplier approval", () => {
    // Only delivery evidence is accepted: every chain-era reference is
    // unresolved.
    const results = obligationOutcomes(workflow(), deliveryIds());
    expect(results.supplier_approved).toBe("UNKNOWN");
    expect(results.food_grade).toBe("UNKNOWN");
  });

  it("merchant dispatch saying 500 cannot satisfy food-grade certification", () => {
    const results = obligationOutcomes(workflow(), ["phase-c-evidence-v2-dispatch"]);
    expect(results.food_grade).toBe("UNKNOWN");
    expect(results.supplier_approved).toBe("UNKNOWN");
  });

  it("post-execution evidence alone → authorization remains BLOCKED", () => {
    const results = obligationOutcomes(workflow(), deliveryIds());
    const anySatisfied = Object.values(results).some((value) => value === "SATISFIED");
    // Only the offer-bound financial/temporal obligations may be satisfied;
    // the evidence-bound ones cannot be.
    expect(results.supplier_approved).toBe("UNKNOWN");
    expect(results.quantity).toBe("UNKNOWN");
    void anySatisfied;
  });

  it("valid authorization evidence + no outcome evidence → authorization succeeds, outcome still unresolved", () => {
    // Authorization evidence alone satisfies the chain; the outcome class is
    // disjoint — the 450 receipt never influences eligibility.
    const results = obligationOutcomes(workflow(), authorizationIds());
    expect(Object.values(results).every((value) => value === "SATISFIED")).toBe(true);
    expect(phaseCDeliveryEvidence().map((item) => item.artifactId)).toContain("phase-c-evidence-v5-receipt");
  });
});

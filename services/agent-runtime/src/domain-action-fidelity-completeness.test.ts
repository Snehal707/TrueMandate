import { describe, expect, it } from "vitest";
import {
  ConstraintKind,
  ConstraintMutability,
  ConstraintOperator,
  MeaningClass,
  SourceType,
  type ActionProposal,
  type Constraint,
  type IntentState,
} from "@truemandate/protocol";
import type { DomainPack, WorkflowRequestBase } from "./domain-pack.js";
import { ProcurementDomainPack } from "./procurement-domain-pack.js";
import { TravelDomainPack } from "./travel-domain-pack.js";
import { SaasItSpendDomainPack } from "./saas-it-spend-domain-pack.js";
import { InvoiceVendorPaymentDomainPack } from "./invoice-vendor-payment-domain-pack.js";
import { LogisticsFulfillmentDomainPack } from "./logistics-fulfillment-domain-pack.js";

/**
 * Build-time completeness gate: every canonical concept a domain pack marks
 * execution-critical must have at least one hand-written action-fidelity
 * check covering it. This is a DIFFERENT failure mode from the existing
 * silent-drop fix in action-fidelity.ts (which catches a compiled constraint
 * that resolves to no canonical concept at all) — this catches the reverse:
 * a canonical concept the pack itself declares execution-critical, with no
 * check anywhere in evaluateActionFidelity's hand-written list. That gap is
 * invisible at runtime whenever a scenario's compiled constraints don't
 * happen to exercise the missing concept — exactly how Travel's
 * completion_deadline and SaaS's subscription_deadline went unnoticed until
 * this audit (see travel-domain-pack.ts and saas-it-spend-domain-pack.ts).
 *
 * Two synthetic constraints per concept — one boolean, one string-valued —
 * because a concept with both an identity check (factType unset, matches by
 * canonicalConcept alone) and an approval check (factType: "approval",
 * matches only a constraint whose value/alias resolves to the ".approval"
 * factKey) needs a constraint of each shape to exercise both checks. Which
 * concepts actually have that split (provider/vendor/payee's approval
 * pairing) is deliberately NOT hardcoded here — probing both shapes for
 * every concept keeps this test correct if that pairing changes.
 */
function syntheticConstraint(id: string, concept: string, value: unknown): Constraint {
  return {
    id,
    concept,
    operator: ConstraintOperator.EQ,
    value,
    kind: ConstraintKind.HARD,
    importance: 1,
    confidence: 1,
    sourceType: SourceType.HUMAN,
    mutability: ConstraintMutability.IMMUTABLE,
    meaningClass: MeaningClass.EXPLICIT,
    grounding: { sourceText: concept, quoteExact: false },
  };
}

function assertActionFidelityCoversEveryExecutionCriticalConcept<T extends WorkflowRequestBase>(
  pack: DomainPack<T>,
) {
  const concepts = pack.planning.executionCriticalConceptRules.map((rule) => rule.canonicalConcept);
  const constraints: Constraint[] = concepts.flatMap((concept) => [
    syntheticConstraint(`${concept}-bool-probe`, concept, true),
    syntheticConstraint(`${concept}-str-probe`, concept, "synthetic-probe-value"),
  ]);
  const state = { constraints } as unknown as IntentState;
  const action = {
    capability: "synthetic-probe",
    merchant: "synthetic-probe",
    product: "synthetic-probe",
    quantity: 1,
    amount: 1,
    currency: "USD",
    parameters: {},
    consequenceLevel: "HIGH",
  } as unknown as ActionProposal;

  const evaluation = pack.evaluateActionFidelity({} as unknown as T, state, action);
  const covered = new Set(evaluation.rows.map((row) => row.canonicalConcept));
  const missing = concepts.filter((concept) => !covered.has(concept));
  expect(missing).toEqual([]);
}

describe("domain action-fidelity completeness: every execution-critical concept has at least one check", () => {
  it("Procurement", () => assertActionFidelityCoversEveryExecutionCriticalConcept(ProcurementDomainPack));
  it("Travel", () => assertActionFidelityCoversEveryExecutionCriticalConcept(TravelDomainPack));
  it("SaaS / IT Spend", () => assertActionFidelityCoversEveryExecutionCriticalConcept(SaasItSpendDomainPack));
  it("Invoice / Vendor Payment", () => assertActionFidelityCoversEveryExecutionCriticalConcept(InvoiceVendorPaymentDomainPack));
  it("Logistics / Fulfillment", () => assertActionFidelityCoversEveryExecutionCriticalConcept(LogisticsFulfillmentDomainPack));
});

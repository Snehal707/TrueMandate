import { describe, expect, it } from "vitest";
import {
  ConstraintKind,
  ConstraintOperator,
  TrustClass,
  type ActionProposal,
  type IntentState,
} from "@truemandate/protocol";
import { demoScenarioTemplate } from "@truemandate/demo-fixtures";
import { explicitConstraint, replaceConstraints, runtime } from "./generic-workflow.e2e.test.js";
import { actionField, evaluateActionChecks } from "./action-fidelity.js";
import { InvoiceVendorPaymentDomainPack } from "./invoice-vendor-payment-domain-pack.js";

/**
 * FORBID is a real, protocol-level ConstraintOperator (packages/protocol/src/
 * enums.ts, defined immediately adjacent to REQUIRE as its logical inverse),
 * confirmed live on Invoice's compiled duplicate_payment constraint
 * (`duplicate_payment FORBID true`). Neither pre-execution-readiness's
 * compareConstraint nor action-fidelity's constraintStatus had ever handled
 * it — both fell through to their generic switch's default case, UNKNOWN,
 * for the uninteresting reason "I don't recognize this operator."
 *
 * evaluateForbidSatisfaction (in @truemandate/semantic-readiness) implements
 * it correctly: naively inverting REQUIRE's own comparison (actual !==
 * expected => satisfied) would be unsafe, because REQUIRE's `===` between
 * two incomparable types is always false, which happens to land on
 * REQUIRE's SAFE outcome (MISMATCH) — but the same `!==` lands on FORBID's
 * UNSAFE outcome (SATISFIED) for the identical incomparable-types case.
 * FORBID therefore needs an explicit type-compatibility gate REQUIRE
 * doesn't, so genuinely incomparable values (e.g. a boolean forbidden value
 * against a string actual) fail closed to UNKNOWN rather than accidentally
 * satisfying the prohibition.
 *
 * This file proves the generic operator correct for both comparable and
 * incomparable cases. It deliberately does NOT attempt to make Invoice's
 * live control pass — that requires resolving what duplicate_payment
 * FORBID true actually means against a deduplication-key evidence
 * representation (a fixture-check-key-vs-boolean-forbidden-value gap, not
 * an operator gap), which is a separate, not-yet-authorized change. The
 * last describe block below is the permanent proof that gap remains open.
 */

function forbidActionFidelityRow(constraintValue: unknown, actualValue: unknown) {
  const state = {
    constraints: [
      {
        id: "c-forbid",
        concept: "duplicate_payment",
        operator: ConstraintOperator.FORBID,
        value: constraintValue,
        kind: ConstraintKind.HARD,
        importance: 1,
        confidence: 1,
      },
    ],
  } as unknown as IntentState;
  const action = {
    parameters: { probe: actualValue },
  } as unknown as ActionProposal;
  const evaluation = evaluateActionChecks(state, InvoiceVendorPaymentDomainPack.planning, [
    {
      canonicalConcept: "duplicate_payment",
      field: "parameters.probe",
      actualValue: actionField<unknown>(action, "probe"),
    },
  ]);
  return evaluation.rows.find((row) => row.constraintId === "c-forbid");
}

describe("FORBID operator: action fidelity", () => {
  it("boolean: FORBID true vs actual true -> MISMATCH (the forbidden value occurred)", () => {
    expect(forbidActionFidelityRow(true, true)?.status).toBe("MISMATCH");
  });

  it("boolean: FORBID true vs actual false -> MATCH (forbidden value absent)", () => {
    expect(forbidActionFidelityRow(true, false)?.status).toBe("MATCH");
  });

  it("string: FORBID \"AUTO\" vs actual \"AUTO\" -> MISMATCH", () => {
    expect(forbidActionFidelityRow("AUTO", "AUTO")?.status).toBe("MISMATCH");
  });

  it("string: FORBID \"AUTO\" vs actual \"MANUAL\" -> MATCH", () => {
    expect(forbidActionFidelityRow("AUTO", "MANUAL")?.status).toBe("MATCH");
  });

  it("number: FORBID 0 vs actual 0 -> MISMATCH", () => {
    expect(forbidActionFidelityRow(0, 0)?.status).toBe("MISMATCH");
  });

  it("number: FORBID 0 vs actual 5 -> MATCH", () => {
    expect(forbidActionFidelityRow(0, 5)?.status).toBe("MATCH");
  });

  it("INCOMPARABLE TYPES: FORBID true vs actual \"dup-1\" -> UNKNOWN, never MATCH", () => {
    const row = forbidActionFidelityRow(true, "dup-1");
    expect(row?.status).toBe("UNKNOWN");
    expect(row?.status).not.toBe("MATCH");
  });

  it("INCOMPARABLE TYPES: FORBID \"AUTO\" vs actual 42 -> UNKNOWN", () => {
    expect(forbidActionFidelityRow("AUTO", 42)?.status).toBe("UNKNOWN");
  });

  it("null actual -> UNKNOWN", () => {
    expect(forbidActionFidelityRow(true, null)?.status).toBe("UNKNOWN");
  });

  it("undefined actual -> UNKNOWN", () => {
    expect(forbidActionFidelityRow(true, undefined)?.status).toBe("UNKNOWN");
  });
});

function envelope(id: string) {
  return {
    id,
    source: `deterministic-demo-fixture:${id}`,
    contentHash: "e".repeat(64),
    captureTime: "2026-06-01T00:00:00.000Z",
    mimeType: "application/json",
    trustClass: TrustClass.ELEVATED_EXTERNAL,
    taint: { classes: ["EXTERNAL_CONTENT"], origins: ["verified-by:demo-fixture-writer"] },
  };
}

function claims(envelopeId: string, facts: readonly { readonly concept: string; readonly value: unknown }[]) {
  return facts.map((fact) => ({
    id: `${envelopeId}-${fact.concept}`,
    evidenceId: envelopeId,
    concept: fact.concept,
    value: fact.value,
    confidence: 1,
  }));
}

async function evaluateInvoiceDuplicatePaymentReadiness() {
  const template = demoScenarioTemplate("invoice_vendor_payment")!;
  const evidenceId = "forbid-readiness-offer";
  const rt = await runtime({
    rawText: template.rawText,
    omitProofSummary: true,
    compilerTransform: replaceConstraints(template.rawText, [
      explicitConstraint("c-duplicate-payment", "duplicate_payment", ConstraintOperator.FORBID, true, ConstraintKind.HARD, "one time"),
    ]),
    demoEvidence: [{ envelope: envelope(evidenceId), claims: claims(evidenceId, [{ concept: "duplicate_payment", value: "dup-1" }]) }],
  });
  const result = await rt.preExecutionReadiness!.evaluate({
    packId: "invoice_vendor_payment",
    intentId: "intent-e2e",
    intentStateId: rt.state.id,
    verifiedEvidenceIds: [evidenceId],
    verifiedClaimIds: [`${evidenceId}-duplicate_payment`],
  });
  expect(result.ok).toBe(true);
  return result.ok
    ? (result.value as { proofRows: readonly { constraintId?: string; status: string; reason: string }[]; superseded: boolean })
    : undefined;
}

describe("FORBID operator: readiness comparison uses the same shared semantics", () => {
  it("boolean vs boolean (synthetic, not the real Invoice gap): FORBID true / claim false -> SATISFIED", async () => {
    const template = demoScenarioTemplate("invoice_vendor_payment")!;
    const evidenceId = "forbid-readiness-boolean-offer";
    const rt = await runtime({
      rawText: template.rawText,
      omitProofSummary: true,
      compilerTransform: replaceConstraints(template.rawText, [
        explicitConstraint("c-duplicate-payment", "duplicate_payment", ConstraintOperator.FORBID, true, ConstraintKind.HARD, "one time"),
      ]),
      demoEvidence: [{ envelope: envelope(evidenceId), claims: claims(evidenceId, [{ concept: "duplicate_payment", value: false }]) }],
    });
    const result = await rt.preExecutionReadiness!.evaluate({
      packId: "invoice_vendor_payment",
      intentId: "intent-e2e",
      intentStateId: rt.state.id,
      verifiedEvidenceIds: [evidenceId],
      verifiedClaimIds: [`${evidenceId}-duplicate_payment`],
    });
    expect(result.ok).toBe(true);
    const row = result.ok
      ? (result.value as { proofRows: readonly { constraintId?: string; status: string }[] }).proofRows.find((r) => r.constraintId === "c-duplicate-payment")
      : undefined;
    expect(row?.status).toBe("SATISFIED");
  });
});

describe("Invoice duplicate_payment: the real fixture's string dedup key against the real FORBID-shaped constraint (permanent proof the semantic gap is separate from, and outlives, the operator fix)", () => {
  it("real fixture: duplicate_payment FORBID true vs the real duplicate_payment=\"dup-1\" claim is UNKNOWN at readiness, not SATISFIED", async () => {
    const value = await evaluateInvoiceDuplicatePaymentReadiness();
    const row = value?.proofRows.find((r) => r.constraintId === "c-duplicate-payment");
    expect(row?.status).toBe("UNKNOWN");
    expect(row?.status).not.toBe("SATISFIED");
    expect(value?.superseded).toBe(false);
  });

  it("real fixture: same case at action fidelity is UNKNOWN, not MATCH -- preservesIntent stays false", () => {
    const row = forbidActionFidelityRow(true, "dup-1");
    expect(row?.status).toBe("UNKNOWN");
    expect(row?.status).not.toBe("MATCH");
  });
});

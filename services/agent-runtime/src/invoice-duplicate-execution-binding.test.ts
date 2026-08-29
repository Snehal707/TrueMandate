import { describe, expect, it } from "vitest";
import {
  AuthorityDecision,
  ConstraintKind,
  ConstraintOperator,
  TrustClass,
  type ActionProposal,
  type IntentState,
} from "@truemandate/protocol";
import { demoScenarioTemplate } from "@truemandate/demo-fixtures";
import { explicitConstraint, replaceConstraints, runtime, temporalConstraint } from "./generic-workflow.e2e.test.js";
import {
  evaluateInvoiceDuplicatePaymentBinding,
  invoiceDuplicateExecutionKey,
} from "./invoice-vendor-payment-domain-pack.js";

/**
 * Structural repair for Invoice's duplicate-payment governance gap (see
 * forbid-operator.test.ts's permanent proof that duplicate_payment FORBID
 * true vs the real duplicateCheckKey="dup-1" claim is UNKNOWN, not a bug --
 * different incomparable semantic types, correctly failing closed).
 *
 * That fix left the REAL gap open: duplicateCheckKey (business dedup
 * identity) and the gateway's execution idempotencyKey were proven
 * completely independent -- nothing structurally connected "duplicate_payment
 * FORBID true" to the system's actual one-time-execution mechanism.
 *
 * This file proves the structural repair: invoiceDuplicateExecutionKey
 * derives a single canonical execution identity from payee + invoice +
 * duplicateCheckKey (repair strategy A), the engine binds Invoice's REAL
 * gateway/outcome/ledger execution key to it (via DomainPack.
 * resolveExecutionIdempotencyKey), and action-fidelity independently
 * re-derives and cross-checks it rather than trusting a carried value.
 *
 * What this file deliberately does NOT prove: that Invoice's real fixture
 * reaches AUTHORIZED/commit end-to-end. Pre-execution readiness has no
 * DETERMINISTIC_RULE evaluator anywhere in the codebase (traced exhaustively
 * -- deriveRequiredProofObligations explicitly excludes DETERMINISTIC_RULE
 * constraints from ever producing a proof row) and no data path from a
 * workflow's execution-binding identity back to readiness (which evaluates
 * once per IntentState, decoupled from any specific workflow attempt). That
 * is a separate, reported, not-yet-authorized architectural gap -- this file
 * proves precisely how far the CURRENT fix gets and where it honestly stops.
 */

function strictTemporalDeadline(id: string, concept: string, resolvedValue: string, originalExpression: string) {
  return { ...temporalConstraint(id, concept, resolvedValue, originalExpression), operator: ConstraintOperator.LT };
}

describe("invoiceDuplicateExecutionKey: canonical execution-binding identity (Phase 2)", () => {
  const base = { payeeId: "approved-payee", invoiceId: "INV-2026-001", duplicateCheckKey: "dup-1" };

  it("is deterministic: identical inputs produce the identical key", () => {
    expect(invoiceDuplicateExecutionKey(base)).toBe(invoiceDuplicateExecutionKey({ ...base }));
  });

  it("is stable across repeated calls", () => {
    const keys = Array.from({ length: 5 }, () => invoiceDuplicateExecutionKey(base));
    expect(new Set(keys).size).toBe(1);
  });

  it("differs when payeeId changes", () => {
    expect(invoiceDuplicateExecutionKey({ ...base, payeeId: "shadow-payee" })).not.toBe(
      invoiceDuplicateExecutionKey(base),
    );
  });

  it("differs when invoiceId changes", () => {
    expect(invoiceDuplicateExecutionKey({ ...base, invoiceId: "INV-2026-002" })).not.toBe(
      invoiceDuplicateExecutionKey(base),
    );
  });

  it("differs when duplicateCheckKey changes", () => {
    expect(invoiceDuplicateExecutionKey({ ...base, duplicateCheckKey: "dup-2" })).not.toBe(
      invoiceDuplicateExecutionKey(base),
    );
  });
});

function invoiceState(): IntentState {
  return {
    constraints: [
      {
        id: "c-duplicate-payment",
        concept: "duplicate_payment",
        operator: ConstraintOperator.FORBID,
        value: true,
        kind: ConstraintKind.HARD,
        importance: 1,
        confidence: 1,
      },
    ],
  } as unknown as IntentState;
}

function invoiceAction(
  overrides: {
    readonly merchant?: string;
    readonly product?: string;
    readonly duplicateCheckKey?: string | undefined;
    readonly executionIdempotencyBinding?: string | undefined;
  } = {},
): ActionProposal {
  const merchant = overrides.merchant ?? "approved-payee";
  const product = overrides.product ?? "INV-2026-001";
  const duplicateCheckKey = "duplicateCheckKey" in overrides ? overrides.duplicateCheckKey : "dup-1";
  const executionIdempotencyBinding =
    "executionIdempotencyBinding" in overrides
      ? overrides.executionIdempotencyBinding
      : invoiceDuplicateExecutionKey({
          payeeId: merchant,
          invoiceId: product,
          duplicateCheckKey: duplicateCheckKey ?? "dup-1",
        });
  return {
    merchant,
    product,
    parameters: { duplicateCheckKey, executionIdempotencyBinding },
  } as unknown as ActionProposal;
}

function duplicatePaymentRow(action: ActionProposal) {
  return evaluateInvoiceDuplicatePaymentBinding(invoiceState(), action);
}

describe("Invoice duplicate_payment action-fidelity: deterministic execution-binding check (Phases 9-10)", () => {
  it("control: consistent payee/invoice/duplicateCheckKey/binding -> MATCH", () => {
    const row = duplicatePaymentRow(invoiceAction());
    expect(row?.status).toBe("MATCH");
    expect(row?.reason).toMatch(/canonical one-time Invoice execution identity/);
  });

  it("mutation A: duplicateCheckKey changes, carried binding stays stale -> MISMATCH", () => {
    const stale = invoiceAction();
    const mutated = invoiceAction({
      duplicateCheckKey: "dup-2",
      executionIdempotencyBinding: stale.parameters.executionIdempotencyBinding as string,
    });
    expect(duplicatePaymentRow(mutated)?.status).toBe("MISMATCH");
  });

  it("mutation B: carried binding is tampered directly, duplicateCheckKey unchanged -> MISMATCH", () => {
    const row = duplicatePaymentRow(invoiceAction({ executionIdempotencyBinding: "invoice-dup:tampered-value" }));
    expect(row?.status).toBe("MISMATCH");
  });

  it("mutation C: invoice identity changes, carried binding stays stale -> MISMATCH (stale binding cannot execute)", () => {
    const stale = invoiceAction();
    const mutated = invoiceAction({
      product: "INV-2026-002",
      executionIdempotencyBinding: stale.parameters.executionIdempotencyBinding as string,
    });
    expect(duplicatePaymentRow(mutated)?.status).toBe("MISMATCH");
  });

  it("mutation D: payee changes, carried binding stays stale -> MISMATCH (stale binding cannot execute)", () => {
    const stale = invoiceAction();
    const mutated = invoiceAction({
      merchant: "shadow-payee",
      executionIdempotencyBinding: stale.parameters.executionIdempotencyBinding as string,
    });
    expect(duplicatePaymentRow(mutated)?.status).toBe("MISMATCH");
  });

  it("missing carried binding -> UNKNOWN, never MATCH", () => {
    const row = duplicatePaymentRow(invoiceAction({ executionIdempotencyBinding: undefined }));
    expect(row?.status).toBe("UNKNOWN");
    expect(row?.status).not.toBe("MATCH");
  });

  it("missing duplicateCheckKey -> UNKNOWN, never MATCH", () => {
    const row = duplicatePaymentRow(invoiceAction({ duplicateCheckKey: undefined }));
    expect(row?.status).toBe("UNKNOWN");
    expect(row?.status).not.toBe("MATCH");
  });

  it("no duplicate_payment constraint on the state -> no row produced (not a false MATCH)", () => {
    const emptyState = { constraints: [] } as unknown as IntentState;
    expect(evaluateInvoiceDuplicatePaymentBinding(emptyState, invoiceAction())).toBeUndefined();
  });
});

function envelope(id: string) {
  return {
    id,
    source: `deterministic-demo-fixture:${id}`,
    contentHash: "f".repeat(64),
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

// The exact live-observed compiled shape from the real deployed compiler
// (see the Phase 15 FORBID report): payee REQUIRE "approved", invoice_identity
// EQ "INV-2026-001", duplicate_payment FORBID true, amount LT 25000, due_date
// LT a full-ISO deadline.
const REAL_INVOICE_CONSTRAINTS = [
  explicitConstraint("c-payee", "payee", ConstraintOperator.REQUIRE, "approved", ConstraintKind.HARD, "approved vendor"),
  explicitConstraint("c-invoice-identity", "invoice_identity", ConstraintOperator.EQ, "INV-2026-001", ConstraintKind.HARD, "INV-2026-001"),
  explicitConstraint("c-duplicate-payment", "duplicate_payment", ConstraintOperator.FORBID, true, ConstraintKind.HARD, "one time"),
  explicitConstraint("c-amount", "amount", ConstraintOperator.LT, 25000, ConstraintKind.FINANCIAL, "under USD 25000"),
  strictTemporalDeadline("c-due-date", "due_date", "2026-11-30T00:00:00.000Z", "before November 30, 2026"),
];

async function invoiceRuntime() {
  const template = demoScenarioTemplate("invoice_vendor_payment")!;
  const evidenceId = "invoice-binding-offer";
  return runtime({
    rawText: template.rawText,
    omitProofSummary: true,
    capabilities: { pay_invoice: AuthorityDecision.ALLOW },
    compilerTransform: replaceConstraints(template.rawText, REAL_INVOICE_CONSTRAINTS),
    demoEvidence: [{ envelope: envelope(evidenceId), claims: claims(evidenceId, template.evidenceClaims) }],
  });
}

function invoiceWorkflowBody(input: {
  readonly expectedIntentStateId: string;
  readonly idempotencyKey: string;
  readonly payeeId?: string;
  readonly invoiceId?: string;
  readonly duplicateCheckKey?: string;
}) {
  const payeeId = input.payeeId ?? "approved-payee";
  const invoiceId = input.invoiceId ?? "INV-2026-001";
  const duplicateCheckKey = input.duplicateCheckKey ?? "dup-1";
  return {
    intent: { kind: "REFERENCE" as const, intentId: "intent-e2e", expectedIntentStateId: input.expectedIntentStateId },
    action: {
      capability: "pay_invoice",
      merchant: payeeId,
      product: invoiceId,
      quantity: 1,
      amount: 24000,
      currency: "USD",
      deliveryTerms: "settle invoice before 2026-11-30",
      consequenceLevel: "HIGH" as const,
      parameters: { invoiceId, remittanceReference: "remit-1" },
    },
    domain: {
      packId: "invoice_vendor_payment",
      payload: {
        payee: { id: payeeId, name: payeeId, approved: true, approvalEvidenceId: "invoice-binding-offer" },
        invoice: { invoiceId, dueDate: "2026-11-29T23:59:59.000Z", duplicateCheckKey, remittanceReference: "remit-1" },
        evidenceIds: ["invoice-binding-offer"],
      },
    },
    idempotencyKey: input.idempotencyKey,
  };
}

describe("Invoice execution-idempotency binding through the real engine (Phases 3, 11, 12 -- real fixture, real FORBID-shaped constraint)", () => {
  it("two independent submission attempts for the SAME economic invoice converge on the SAME execution-binding key", async () => {
    const rt = await invoiceRuntime();
    const first = await rt.dispatcher.submitWorkflow(
      invoiceWorkflowBody({ expectedIntentStateId: rt.state.id, idempotencyKey: "attempt-1-fresh-run" }),
    );
    const second = await rt.dispatcher.submitWorkflow(
      invoiceWorkflowBody({ expectedIntentStateId: rt.state.id, idempotencyKey: "attempt-2-a-totally-different-fresh-run" }),
    );
    if (!first.ok) throw new Error(`attempt 1: ${first.code}: ${first.message}`);
    if (!second.ok) throw new Error(`attempt 2: ${second.code}: ${second.message}`);
    const firstValue = first.value as { workflowId: string; artifacts?: { idempotencyKey?: string } };
    const secondValue = second.value as { workflowId: string; artifacts?: { idempotencyKey?: string } };

    // Different raw per-submission idempotencyKey -> different workflow
    // records/provenance (workflowId is deliberately unaffected by this fix).
    expect(firstValue.workflowId).not.toBe(secondValue.workflowId);
    // But the ENGINE-RESOLVED execution-binding key converges, because it is
    // derived purely from payee + invoice + duplicateCheckKey, never from the
    // raw per-submission value. This is the actual property Phase 11 cares
    // about: two SEPARATE attempts at the SAME economic payment.
    expect(firstValue.artifacts?.idempotencyKey).toBeDefined();
    expect(firstValue.artifacts?.idempotencyKey).toBe(secondValue.artifacts?.idempotencyKey);
    expect(firstValue.artifacts?.idempotencyKey).toBe(
      invoiceDuplicateExecutionKey({ payeeId: "approved-payee", invoiceId: "INV-2026-001", duplicateCheckKey: "dup-1" }),
    );
  });

  it("a genuinely different invoice for the same payee derives a DIFFERENT execution-binding key", async () => {
    const rt = await invoiceRuntime();
    const firstInvoice = await rt.dispatcher.submitWorkflow(
      invoiceWorkflowBody({ expectedIntentStateId: rt.state.id, idempotencyKey: "inv-001-attempt" }),
    );
    const secondInvoice = await rt.dispatcher.submitWorkflow(
      invoiceWorkflowBody({
        expectedIntentStateId: rt.state.id,
        idempotencyKey: "inv-002-attempt",
        invoiceId: "INV-2026-002",
        duplicateCheckKey: "dup-2",
      }),
    );
    if (!firstInvoice.ok) throw new Error(`INV-2026-001: ${firstInvoice.code}: ${firstInvoice.message}`);
    if (!secondInvoice.ok) throw new Error(`INV-2026-002: ${secondInvoice.code}: ${secondInvoice.message}`);
    const firstValue = firstInvoice.value as { artifacts?: { idempotencyKey?: string } };
    const secondValue = secondInvoice.value as { artifacts?: { idempotencyKey?: string } };
    expect(firstValue.artifacts?.idempotencyKey).toBeDefined();
    expect(secondValue.artifacts?.idempotencyKey).toBeDefined();
    expect(firstValue.artifacts?.idempotencyKey).not.toBe(secondValue.artifacts?.idempotencyKey);
  });

  it("real fixture, real FORBID-shaped constraint: action-fidelity duplicate_payment is now MATCH; the workflow still BLOCKS, honestly, because readiness never promotes past PLANNABLE -- a separate, reported gap, not this fix", async () => {
    const rt = await invoiceRuntime();
    const submitted = await rt.dispatcher.submitWorkflow(
      invoiceWorkflowBody({ expectedIntentStateId: rt.state.id, idempotencyKey: "invoice-full-control" }),
    );
    if (!submitted.ok) throw new Error(`${submitted.code}: ${submitted.message}`);
    const value = submitted.value as { workflowId: string; state: string };
    expect(value.state).toBe("BLOCKED");

    const artifacts = await rt.owner.listWorkflowArtifacts(value.workflowId);
    if (!artifacts.ok) throw new Error("could not read workflow artifacts");
    const rows = artifacts.value as { kind: string; payload: Record<string, unknown> }[];

    const actionRow = rows.find((row) => row.kind === "ACTION");
    const fidelity = actionRow?.payload.deterministicActionFidelity as
      | { rows: { canonicalConcept: string; status: string }[]; preservesIntent: boolean }
      | undefined;
    const duplicateRow = fidelity?.rows.find((row) => row.canonicalConcept === "duplicate_payment");
    // The fix under test: action-fidelity's duplicate_payment row is now a
    // real, deterministic MATCH -- not the pre-fix UNKNOWN from a nonsensical
    // FORBID-true-vs-string comparison.
    expect(duplicateRow?.status).toBe("MATCH");
    expect(fidelity?.preservesIntent).toBe(true);

    // What is STILL missing, honestly, and WHY it now surfaces one stage
    // EARLIER than action-fidelity: readiness never promotes past PLANNABLE,
    // because supersedeWithVerifiedEvidence's supersessionEligible check
    // requires EVERY proof row SATISFIED, and duplicate_payment's stays
    // UNKNOWN (see below). verifyPlan's own deterministic findings then
    // reject the plan outright for its privileged (ECONOMIC-commitment) step
    // with INAPPROPRIATE_COMMITMENT ("Privileged planning requires ACTIONABLE
    // or EXECUTABLE readiness") -- BEFORE proof coverage is even checked.
    // This is the SAME root cause (the readiness gap reported in Phase 7),
    // manifesting earlier in the pipeline than originally anticipated -- not
    // a new or different defect, and not a regression from this fix.
    const planVerification = rows.find((row) => row.kind === "PLAN_VERIFICATION")?.payload;
    const verificationResult = planVerification?.verification as
      | { status?: string; findings?: { code?: string; message?: string }[] }
      | undefined;
    expect(verificationResult?.status).toBe("REJECTED");
    expect(verificationResult?.findings?.some((f) => f.code === "INAPPROPRIATE_COMMITMENT")).toBe(true);

    const guardian = rows.find((row) => row.kind === "GUARDIAN")?.payload as
      | { verdict?: { decision?: string; criticalFailure?: boolean } }
      | undefined;
    expect(guardian?.verdict?.decision).not.toBe("BLOCK");
    expect(guardian?.verdict?.criticalFailure).not.toBe(true);

    // Because supersession never became eligible (below), NO proof summary
    // was ever durably bound to this IntentState. resolveEvidenceBackedState
    // only reads the boolean `superseded` field and discards the rest, so
    // every DURABLE proof artifact collapses uniformly to UNKNOWN /
    // "authoritative-proof-handoff-absent" -- for ALL five constraints, not
    // just duplicate_payment. That collapse is itself a consequence of the
    // one blocked constraint, not five independent failures -- confirmed
    // granularly just below.
    const proofs = rows.filter((row) => row.kind === "PROOF").map((row) => row.payload);
    expect(proofs.length).toBeGreaterThan(0);
    for (const proof of proofs) {
      expect(proof.status).toBe("UNKNOWN");
      expect(proof.method).toBe("authoritative-proof-handoff-absent");
    }

    // Root confirmation, at the granularity the durable handoff above
    // collapses away: call pre-execution readiness directly (same evidence
    // this workflow submitted) to see each constraint's OWN proof row.
    // Pre-execution readiness has no DETERMINISTIC_RULE evaluator anywhere in
    // the codebase and no data path to a workflow's execution-binding
    // identity (traced in the Phase 7 report) -- so duplicate_payment's row
    // is still produced via the evidence-claim path, comparing FORBID true
    // against the real duplicate_payment="dup-1" claim, which stays UNKNOWN
    // (see forbid-operator.test.ts's permanent proof). The other four
    // concepts -- payee, invoice_identity, amount, due_date -- prove this is
    // NOT a general readiness failure: they are individually SATISFIED. It is
    // specifically duplicate_payment holding supersessionEligible (and so the
    // whole proof summary, and so ACTIONABLE readiness, and so plan
    // verification, and so the workflow) closed.
    const evidenceId = "invoice-binding-offer";
    const claimIds = demoScenarioTemplate("invoice_vendor_payment")!.evidenceClaims.map(
      (c) => `${evidenceId}-${c.concept}`,
    );
    const readiness = await rt.preExecutionReadiness!.evaluate({
      packId: "invoice_vendor_payment",
      intentId: "intent-e2e",
      intentStateId: rt.state.id,
      verifiedEvidenceIds: [evidenceId],
      verifiedClaimIds: claimIds,
    });
    if (!readiness.ok) throw new Error(`readiness: ${readiness.code}: ${readiness.message}`);
    const readinessValue = readiness.value as {
      superseded: boolean;
      proofRows: readonly { concept?: string; status: string }[];
    };
    expect(readinessValue.superseded).toBe(false);
    const duplicateReadinessRow = readinessValue.proofRows.find((row) => row.concept === "duplicate_payment");
    expect(duplicateReadinessRow?.status).toBe("UNKNOWN");
    const otherReadinessRows = readinessValue.proofRows.filter((row) => row.concept !== "duplicate_payment");
    expect(otherReadinessRows.length).toBeGreaterThan(0);
    for (const row of otherReadinessRows) {
      expect(row.status).toBe("SATISFIED");
    }
  });
});

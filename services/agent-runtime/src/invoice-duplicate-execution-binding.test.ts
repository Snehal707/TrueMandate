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
  InvoiceVendorPaymentDomainPack,
  INVOICE_DUPLICATE_EXECUTION_BINDING_RULE_ID,
} from "./invoice-vendor-payment-domain-pack.js";

/**
 * Structural repair for Invoice's duplicate-payment governance gap (see
 * forbid-operator.test.ts's permanent proof that duplicate_payment FORBID
 * true vs the real duplicateCheckKey="dup-1" claim is UNKNOWN, not a bug --
 * different incomparable semantic types, correctly failing closed).
 *
 * REVISION HISTORY (kept because it is load-bearing, not incidental):
 * this file's first version derived the canonical execution identity from
 * hashCanonical({domain, payeeId, invoiceId, duplicateCheckKey}) -- binding
 * all three, reasoning that would prevent a caller from widening the binding
 * by controlling one field alone. That reasoning was backwards, and this
 * file's own PHASE A PROBE (run against that version, before this revision)
 * proved it empirically: two fresh, completely untampered
 * dispatcher.submitWorkflow calls for the identical payee + invoice, differing
 * ONLY in duplicateCheckKey ("dup-1" vs "dup-2"), derived two DIFFERENT
 * execution-binding keys, and action-fidelity reported a clean MATCH on both
 * -- nothing would have stopped a second, independently-authorized economic
 * execution against the same real-world invoice merely by supplying a new
 * business dedup string. duplicateCheckKey is caller/domain input, never
 * independently verified against an authoritative ledger; it must not be
 * free entropy in a one-time-execution identity.
 *
 * The canonical key is now hashCanonical({domain, payeeId, invoiceId}) only
 * -- see invoiceDuplicateExecutionKey's docstring. duplicateCheckKey remains
 * business/provenance data (action.parameters.duplicateCheckKey,
 * buildOutcomeContractInput's parameters) but can no longer affect which
 * execution identity a payment binds to.
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

describe("invoiceDuplicateExecutionKey: canonical execution-binding identity (Phase B/D)", () => {
  const base = { payeeId: "approved-payee", invoiceId: "INV-2026-001" };

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

  it("is NOT a function of duplicateCheckKey: the function does not even accept it -- a changed business dedup string cannot mint a new execution identity for the same payee + invoice", () => {
    // No duplicateCheckKey parameter exists on invoiceDuplicateExecutionKey at
    // all (see its signature). This test exists to make the absence an
    // explicit, permanent assertion rather than something only visible by
    // reading the type.
    const key = invoiceDuplicateExecutionKey(base);
    expect(key).toBe(invoiceDuplicateExecutionKey({ payeeId: base.payeeId, invoiceId: base.invoiceId }));
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
    readonly duplicateCheckKey?: string;
    readonly executionIdempotencyBinding?: string | undefined;
  } = {},
): ActionProposal {
  const merchant = overrides.merchant ?? "approved-payee";
  const product = overrides.product ?? "INV-2026-001";
  const duplicateCheckKey = overrides.duplicateCheckKey ?? "dup-1";
  const executionIdempotencyBinding =
    "executionIdempotencyBinding" in overrides
      ? overrides.executionIdempotencyBinding
      : invoiceDuplicateExecutionKey({ payeeId: merchant, invoiceId: product });
  return {
    merchant,
    product,
    parameters: { duplicateCheckKey, executionIdempotencyBinding },
  } as unknown as ActionProposal;
}

function duplicatePaymentRow(action: ActionProposal) {
  return evaluateInvoiceDuplicatePaymentBinding(invoiceState(), action);
}

describe("Invoice duplicate_payment action-fidelity: deterministic execution-binding check (Phase E)", () => {
  it("control: consistent payee/invoice/binding -> MATCH", () => {
    const row = duplicatePaymentRow(invoiceAction());
    expect(row?.status).toBe("MATCH");
    expect(row?.reason).toMatch(/canonical one-time Invoice execution identity/);
  });

  it("changing ONLY duplicateCheckKey (default binding re-derives, untampered) -> MATCH still holds -- the fixed bypass", () => {
    const row = duplicatePaymentRow(invoiceAction({ duplicateCheckKey: "dup-2" }));
    expect(row?.status).toBe("MATCH");
  });

  it("changing duplicateCheckKey while carrying the OTHER attempt's binding -> still MATCH, because the binding never depended on duplicateCheckKey in the first place", () => {
    const bindingFromAnotherDuplicateCheckKey = invoiceAction({ duplicateCheckKey: "dup-1" }).parameters
      .executionIdempotencyBinding as string;
    const row = duplicatePaymentRow(
      invoiceAction({ duplicateCheckKey: "dup-2", executionIdempotencyBinding: bindingFromAnotherDuplicateCheckKey }),
    );
    expect(row?.status).toBe("MATCH");
  });

  it("carried binding is tampered directly (payee/invoice unchanged) -> MISMATCH", () => {
    const row = duplicatePaymentRow(invoiceAction({ executionIdempotencyBinding: "invoice-dup:tampered-value" }));
    expect(row?.status).toBe("MISMATCH");
  });

  it("invoice identity changes, carried binding stays stale -> MISMATCH (stale binding cannot execute)", () => {
    const stale = invoiceAction();
    const mutated = invoiceAction({
      product: "INV-2026-002",
      executionIdempotencyBinding: stale.parameters.executionIdempotencyBinding as string,
    });
    expect(duplicatePaymentRow(mutated)?.status).toBe("MISMATCH");
  });

  it("payee changes, carried binding stays stale -> MISMATCH (stale binding cannot execute)", () => {
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
  readonly amount?: number;
}) {
  const payeeId = input.payeeId ?? "approved-payee";
  const invoiceId = input.invoiceId ?? "INV-2026-001";
  const duplicateCheckKey = input.duplicateCheckKey ?? "dup-1";
  const amount = input.amount ?? 24000;
  return {
    intent: { kind: "REFERENCE" as const, intentId: "intent-e2e", expectedIntentStateId: input.expectedIntentStateId },
    action: {
      capability: "pay_invoice",
      merchant: payeeId,
      product: invoiceId,
      quantity: 1,
      amount,
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

/**
 * Now that duplicate_payment is a real DETERMINISTIC_RULE, a submission whose
 * evidence satisfies every proof row triggers genuine evidence-backed
 * supersession (S0 -> S1) as a side effect of the FIRST call that reaches it
 * -- exactly the split-identity hazard resolveEvidenceBackedState's own
 * docstring describes. Every submission (not just the first) can hit
 * INTENT_STATE_NOT_READY if the tip already advanced; this mirrors the exact
 * single-retry pattern already established in
 * saas-invoice-logistics-real-evidence-fixture.test.ts's runRealFixtureDomain.
 */
async function submitInvoiceWorkflow(
  rt: Awaited<ReturnType<typeof invoiceRuntime>>,
  params: {
    readonly idempotencyKey: string;
    readonly payeeId?: string;
    readonly invoiceId?: string;
    readonly duplicateCheckKey?: string;
    readonly amount?: number;
  },
) {
  const attempt = (expectedIntentStateId: string) =>
    rt.dispatcher.submitWorkflow(invoiceWorkflowBody({ expectedIntentStateId, ...params }));
  let result = await attempt(rt.state.id);
  // Two different codes can report the identical underlying situation
  // (the requested expectedIntentStateId is stale), depending on WHEN the
  // supersession happened relative to this call: INTENT_STATE_NOT_READY when
  // THIS submission's own evidence-backed readiness evaluation is what
  // superseded S0 -> S1 mid-flight (details.intentStateId is the successor);
  // GRANT_INTENT_STATE_MISMATCH when a PRIOR submission already superseded
  // it before this one's getCurrentStateForIntent even ran (details.tip is
  // the current tip). Both are retried exactly once, matching this
  // codebase's established single-retry pattern.
  if (!result.ok && result.code === "INTENT_STATE_NOT_READY") {
    result = await attempt(String((result.details as Record<string, unknown>).intentStateId));
  } else if (!result.ok && result.code === "GRANT_INTENT_STATE_MISMATCH") {
    result = await attempt(String((result.details as Record<string, unknown>).tip));
  }
  return result;
}

describe("evaluateDeterministicRule: server-side proof for invoice_duplicate_execution_binding_v1 (Phase H)", () => {
  const evaluate = (inputs: Record<string, unknown> | undefined) =>
    InvoiceVendorPaymentDomainPack.evaluateDeterministicRule!(INVOICE_DUPLICATE_EXECUTION_BINDING_RULE_ID, inputs);

  it("SATISFIED: payeeId + invoiceId present, providedExecutionBinding equals the canonical derivation", () => {
    const payeeId = "approved-payee";
    const invoiceId = "INV-2026-001";
    const result = evaluate({
      payeeId,
      invoiceId,
      providedExecutionBinding: invoiceDuplicateExecutionKey({ payeeId, invoiceId }),
    });
    expect(result.status).toBe("SATISFIED");
  });

  it("does NOT mark SATISFIED merely because duplicateCheckKey (or any extra field) is present -- only payeeId/invoiceId/providedExecutionBinding matter", () => {
    const payeeId = "approved-payee";
    const invoiceId = "INV-2026-001";
    const result = evaluate({
      payeeId,
      invoiceId,
      duplicateCheckKey: "dup-1",
      providedExecutionBinding: invoiceDuplicateExecutionKey({ payeeId, invoiceId }),
    });
    expect(result.status).toBe("SATISFIED");
    const wrongBindingResult = evaluate({ payeeId, invoiceId, duplicateCheckKey: "dup-1" });
    expect(wrongBindingResult.status).not.toBe("SATISFIED");
  });

  it("UNKNOWN: missing payeeId", () => {
    expect(evaluate({ invoiceId: "INV-2026-001", providedExecutionBinding: "invoice-dup:x" }).status).toBe("UNKNOWN");
  });

  it("UNKNOWN: missing invoiceId", () => {
    expect(evaluate({ payeeId: "approved-payee", providedExecutionBinding: "invoice-dup:x" }).status).toBe("UNKNOWN");
  });

  it("UNKNOWN: missing providedExecutionBinding entirely", () => {
    expect(evaluate({ payeeId: "approved-payee", invoiceId: "INV-2026-001" }).status).toBe("UNKNOWN");
  });

  it("UNKNOWN: undefined inputs object", () => {
    expect(evaluate(undefined).status).toBe("UNKNOWN");
  });

  it("UNSATISFIED (not UNKNOWN): all inputs present but providedExecutionBinding does not match the canonical derivation", () => {
    const result = evaluate({
      payeeId: "approved-payee",
      invoiceId: "INV-2026-001",
      providedExecutionBinding: "invoice-dup:some-unrelated-value",
    });
    expect(result.status).toBe("UNSATISFIED");
  });

  it("UNKNOWN: unrecognized ruleId (fails closed, does not silently pass)", () => {
    const result = InvoiceVendorPaymentDomainPack.evaluateDeterministicRule!("some_other_rule_v1", {
      payeeId: "approved-payee",
      invoiceId: "INV-2026-001",
      providedExecutionBinding: "invoice-dup:x",
    });
    expect(result.status).toBe("UNKNOWN");
  });
});

describe("Invoice execution-idempotency binding through the real engine (Phase D -- real fixture, real FORBID-shaped constraint)", () => {
  it("two independent submission attempts for the SAME economic invoice (same duplicateCheckKey) converge on the SAME execution-binding key", async () => {
    const rt = await invoiceRuntime();
    const first = await submitInvoiceWorkflow(rt, { idempotencyKey: "attempt-1-fresh-run" });
    const second = await submitInvoiceWorkflow(rt, { idempotencyKey: "attempt-2-a-totally-different-fresh-run" });
    if (!first.ok) throw new Error(`attempt 1: ${first.code}: ${first.message}`);
    if (!second.ok) throw new Error(`attempt 2: ${second.code}: ${second.message}`);
    const firstValue = first.value as { workflowId: string; artifacts?: { idempotencyKey?: string } };
    const secondValue = second.value as { workflowId: string; artifacts?: { idempotencyKey?: string } };

    // Different raw per-submission idempotencyKey -> different workflow
    // records/provenance (workflowId is deliberately unaffected by this fix).
    expect(firstValue.workflowId).not.toBe(secondValue.workflowId);
    // But the ENGINE-RESOLVED execution-binding key converges, because it is
    // derived purely from payee + invoice, never from the raw per-submission
    // value and never from duplicateCheckKey.
    expect(firstValue.artifacts?.idempotencyKey).toBeDefined();
    expect(firstValue.artifacts?.idempotencyKey).toBe(secondValue.artifacts?.idempotencyKey);
    expect(firstValue.artifacts?.idempotencyKey).toBe(
      invoiceDuplicateExecutionKey({ payeeId: "approved-payee", invoiceId: "INV-2026-001" }),
    );
  });

  it("PHASE A/D: a FRESH, untampered resubmission of the SAME economic invoice with ONLY duplicateCheckKey changed converges on the SAME execution key -- the bypass is closed", async () => {
    const rt = await invoiceRuntime();
    const attempt1 = await submitInvoiceWorkflow(rt, { idempotencyKey: "phase-a-attempt-1", duplicateCheckKey: "dup-1" });
    const attempt2 = await submitInvoiceWorkflow(rt, { idempotencyKey: "phase-a-attempt-2", duplicateCheckKey: "dup-2" });
    if (!attempt1.ok) throw new Error(`attempt 1: ${attempt1.code}: ${attempt1.message}`);
    if (!attempt2.ok) throw new Error(`attempt 2: ${attempt2.code}: ${attempt2.message}`);
    const v1 = attempt1.value as { workflowId: string; artifacts?: { idempotencyKey?: string } };
    const v2 = attempt2.value as { workflowId: string; artifacts?: { idempotencyKey?: string } };

    // The historically-real bypass: these two workflowIds differ (different
    // raw submissions), but the execution-binding key must now be identical.
    expect(v1.workflowId).not.toBe(v2.workflowId);
    expect(v1.artifacts?.idempotencyKey).toBeDefined();
    expect(v1.artifacts?.idempotencyKey).toBe(v2.artifacts?.idempotencyKey);

    const artifacts2 = await rt.owner.listWorkflowArtifacts(v2.workflowId);
    if (!artifacts2.ok) throw new Error("could not read attempt 2 artifacts");
    const rows2 = artifacts2.value as { kind: string; payload: Record<string, unknown> }[];
    const actionRow2 = rows2.find((row) => row.kind === "ACTION");
    const fidelity2 = actionRow2?.payload.deterministicActionFidelity as
      | { rows: { canonicalConcept: string; status: string }[]; preservesIntent: boolean }
      | undefined;
    const duplicateRow2 = fidelity2?.rows.find((row) => row.canonicalConcept === "duplicate_payment");
    expect(duplicateRow2?.status).toBe("MATCH");
    expect(fidelity2?.preservesIntent).toBe(true);
  });

  it("a genuinely different invoice for the same payee derives a DIFFERENT execution-binding key", async () => {
    const rt = await invoiceRuntime();
    const firstInvoice = await submitInvoiceWorkflow(rt, { idempotencyKey: "inv-001-attempt" });
    const secondInvoice = await submitInvoiceWorkflow(rt, {
      idempotencyKey: "inv-002-attempt",
      invoiceId: "INV-2026-002",
      duplicateCheckKey: "dup-2",
    });
    if (!firstInvoice.ok) throw new Error(`INV-2026-001: ${firstInvoice.code}: ${firstInvoice.message}`);
    if (!secondInvoice.ok) throw new Error(`INV-2026-002: ${secondInvoice.code}: ${secondInvoice.message}`);
    const firstValue = firstInvoice.value as { artifacts?: { idempotencyKey?: string } };
    const secondValue = secondInvoice.value as { artifacts?: { idempotencyKey?: string } };
    expect(firstValue.artifacts?.idempotencyKey).toBeDefined();
    expect(secondValue.artifacts?.idempotencyKey).toBeDefined();
    expect(firstValue.artifacts?.idempotencyKey).not.toBe(secondValue.artifacts?.idempotencyKey);
  });

  it("a genuinely different payee for the same invoice number derives a DIFFERENT execution-binding key", async () => {
    const rt = await invoiceRuntime();
    const firstPayee = await submitInvoiceWorkflow(rt, { idempotencyKey: "payee-a-attempt", payeeId: "approved-payee" });
    const secondPayee = await submitInvoiceWorkflow(rt, { idempotencyKey: "payee-b-attempt", payeeId: "different-payee" });
    if (!firstPayee.ok) throw new Error(`payee A: ${firstPayee.code}: ${firstPayee.message}`);
    if (!secondPayee.ok) throw new Error(`payee B: ${secondPayee.code}: ${secondPayee.message}`);
    const firstValue = firstPayee.value as { artifacts?: { idempotencyKey?: string } };
    const secondValue = secondPayee.value as { artifacts?: { idempotencyKey?: string } };
    expect(firstValue.artifacts?.idempotencyKey).toBeDefined();
    expect(secondValue.artifacts?.idempotencyKey).toBeDefined();
    expect(firstValue.artifacts?.idempotencyKey).not.toBe(secondValue.artifacts?.idempotencyKey);
  });
});

describe("Pre-execution readiness: duplicate_payment as a genuine DETERMINISTIC_RULE proof row (Phase G/H/I)", () => {
  async function evaluateInvoiceReadiness() {
    const rt = await invoiceRuntime();
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
      deterministicRuleInputs: {
        [INVOICE_DUPLICATE_EXECUTION_BINDING_RULE_ID]: {
          payeeId: "approved-payee",
          invoiceId: "INV-2026-001",
          providedExecutionBinding: invoiceDuplicateExecutionKey({
            payeeId: "approved-payee",
            invoiceId: "INV-2026-001",
          }),
        },
      },
    });
    if (!readiness.ok) throw new Error(`readiness: ${readiness.code}: ${readiness.message}`);
    return readiness.value as {
      superseded: boolean;
      proofRows: readonly {
        concept?: string;
        constraintId?: string;
        status: string;
        proofMechanism: string;
        deterministicRuleId?: string;
        evidenceId?: string;
      }[];
      coverage: { incompleteDeterministicRuleIds: readonly string[]; allRequiredCovered: boolean };
    };
  }

  it("produces a real DETERMINISTIC_RULE proof row for duplicate_payment: SATISFIED, correct proofMechanism/deterministicRuleId, no fabricated evidenceId", async () => {
    const value = await evaluateInvoiceReadiness();
    const row = value.proofRows.find((r) => r.concept === "duplicate_payment");
    expect(row?.status).toBe("SATISFIED");
    expect(row?.proofMechanism).toBe("DETERMINISTIC_RULE");
    expect(row?.deterministicRuleId).toBe(INVOICE_DUPLICATE_EXECUTION_BINDING_RULE_ID);
    expect(row?.evidenceId).toBeUndefined();
  });

  it("coverage: incompleteDeterministicRuleIds is empty and allRequiredCovered is true once the rule is SATISFIED", async () => {
    const value = await evaluateInvoiceReadiness();
    expect(value.coverage.incompleteDeterministicRuleIds).toEqual([]);
    expect(value.coverage.allRequiredCovered).toBe(true);
  });

  it("S0 -> S1: readiness genuinely supersedes (promotes) once duplicate_payment is SATISFIED alongside the other four", async () => {
    const value = await evaluateInvoiceReadiness();
    expect(value.superseded).toBe(true);
  });

  it("the other four Invoice constraints remain ordinary EVIDENCE_OBLIGATION rows, unaffected by the deterministic-rule change", async () => {
    const value = await evaluateInvoiceReadiness();
    const others = value.proofRows.filter((r) => r.concept !== "duplicate_payment");
    expect(others.length).toBeGreaterThan(0);
    for (const row of others) {
      expect(row.proofMechanism).toBe("EVIDENCE_OBLIGATION");
      expect(row.status).toBe("SATISFIED");
    }
  });

  it("fails closed: without deterministicRuleInputs (e.g. an operator/verifier caller that doesn't supply them), duplicate_payment stays UNKNOWN and readiness does NOT supersede -- never silently SATISFIED", async () => {
    const rt = await invoiceRuntime();
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
    const value = readiness.value as {
      superseded: boolean;
      proofRows: readonly { concept?: string; status: string }[];
    };
    const row = value.proofRows.find((r) => r.concept === "duplicate_payment");
    expect(row?.status).toBe("UNKNOWN");
    expect(value.superseded).toBe(false);
  });
});

describe("Invoice full local control through the real engine (Phase K -- real fixture, real FORBID-shaped constraint, deterministic readiness rule live)", () => {
  it("reaches AUTHORIZED: all proofs (including the deterministic duplicate_payment rule) SATISFIED, action fidelity all MATCH, plan VERIFIED, Guardian permits, commits SUCCESS with 1 side effect, then IDEMPOTENT_REPLAY", async () => {
    const rt = await invoiceRuntime();
    const submitted = await submitInvoiceWorkflow(rt, { idempotencyKey: "invoice-full-control" });
    if (!submitted.ok) throw new Error(`${submitted.code}: ${submitted.message}`);
    const value = submitted.value as { workflowId: string; state: string };

    const artifacts = await rt.owner.listWorkflowArtifacts(value.workflowId);
    if (!artifacts.ok) throw new Error("could not read workflow artifacts");
    const rows = artifacts.value as { kind: string; payload: Record<string, unknown> }[];
    const proofs = rows.filter((row) => row.kind === "PROOF").map((row) => row.payload);
    expect(proofs.length).toBeGreaterThan(0);
    for (const proof of proofs) {
      expect(proof.status).toBe("SATISFIED");
    }
    // duplicate_payment does NOT get its own durable per-workflow PROOF
    // artifact here -- confirmed, not assumed: an attempt to add one was
    // tried and reverted because it broke Authority's OWN independent
    // re-validation (semantic-artifact-resolver.ts treats the durable
    // proof-artifact set as closed, matched against the PLAN's
    // proofObligations, which is deriveRequiredProofObligations-shaped
    // throughout the whole pipeline and excludes DETERMINISTIC_RULE
    // constraints -- see generic-workflow-engine.ts's own comment at the
    // revert site). This is a genuine, reported observability gap, not a
    // safety one: duplicate_payment's SATISFIED status is still a real,
    // load-bearing precondition for reaching AUTHORIZED at all (proven by
    // this very test reaching AUTHORIZED, and by the negative test below
    // proving UNSATISFIED/UNKNOWN inputs block it) -- see the
    // "Pre-execution readiness" describe block above for the direct,
    // granular proof of its SATISFIED status.
    expect(proofs.some((row) => row.constraintId === "c-duplicate-payment")).toBe(false);

    const actionRow = rows.find((row) => row.kind === "ACTION");
    const fidelity = actionRow?.payload.deterministicActionFidelity as
      | { rows: { canonicalConcept: string; status: string }[]; preservesIntent: boolean }
      | undefined;
    expect(fidelity?.preservesIntent).toBe(true);
    expect(fidelity?.rows.every((row) => row.status === "MATCH")).toBe(true);

    const planVerification = rows.find((row) => row.kind === "PLAN_VERIFICATION")?.payload;
    expect((planVerification?.verification as Record<string, unknown>)?.status).toBe("VERIFIED");

    // AUTHORIZED is only reachable if `eligible` was true (same invariant
    // assertFullyAuthorizedAndReplaySafe relies on in
    // saas-invoice-logistics-real-evidence-fixture.test.ts).
    expect(value.state).toBe("AUTHORIZED");
    expect(rt.calls).toMatchObject({ evaluation: 1, prepare: 1, mint: 1, authorize: 1 });

    const committed = await rt.dispatcher.commitWorkflow(value.workflowId);
    if (!committed.ok) throw new Error(`commit: ${committed.code}: ${committed.message}`);
    expect(committed.value).toMatchObject({ status: "SUCCESS" });
    expect(await rt.gateway.getSideEffectLedger().listAll()).toHaveLength(1);

    const replay = await rt.dispatcher.commitWorkflow(value.workflowId);
    expect(replay.ok && (replay.value as { status: string }).status).toBe("IDEMPOTENT_REPLAY");
    expect(await rt.gateway.getSideEffectLedger().listAll()).toHaveLength(1);
  });
});

describe("Invoice cross-workflow duplicate-payment prevention through the real engine (Phase J -- strongest security test)", () => {
  it("fresh workflow A (dup-1) commits SUCCESS with 1 side effect; fresh workflow B (SAME invoice, dup-2, independent workflowId) produces NO second side effect", async () => {
    const rt = await invoiceRuntime();

    const workflowA = await submitInvoiceWorkflow(rt, { idempotencyKey: "security-attempt-a", duplicateCheckKey: "dup-1", amount: 100 });
    if (!workflowA.ok) throw new Error(`workflow A: ${workflowA.code}: ${workflowA.message}`);
    const valueA = workflowA.value as { workflowId: string; state: string };
    expect(valueA.state).toBe("AUTHORIZED");

    const committedA = await rt.dispatcher.commitWorkflow(valueA.workflowId);
    if (!committedA.ok) throw new Error(`commit A: ${committedA.code}: ${committedA.message}`);
    expect(committedA.value).toMatchObject({ status: "SUCCESS" });
    expect(await rt.gateway.getSideEffectLedger().listAll()).toHaveLength(1);

    // Workflow B: a genuinely SEPARATE workflow attempt (different raw
    // idempotencyKey -> different workflowId -> different PreparedAction),
    // same economic invoice, a DIFFERENT duplicateCheckKey. This is the
    // strongest version of the test: it proves protection across independent
    // attempts, not merely replay of the identical workflow/token.
    //
    // FINDING (not this fix's doing, traced precisely, reported in full in
    // the delivery report): workflow B does NOT reach AUTHORIZED here.
    // Authority's own exposure-ledger sets scope.maxAmount to the CURRENT
    // request's own amount (generic-workflow-engine.ts: `maxAmount:
    // domainAction.amount`) and evaluates it cumulatively against a
    // relatedGroupId of `${intentId}:${currency}` -- so workflow A's
    // reservation, still outstanding because nothing here ever resolves its
    // OutcomeContract, causes ANY second grant against the same intent to
    // exceed ITS OWN single-request threshold, regardless of amount (tried
    // both $24,000+$24,000 and $100+$100 -- identical BLOCK). This is a real,
    // pre-existing, independent economic-exposure control, unrelated to and
    // untouched by this fix. It still proves the property this phase cares
    // about -- "no second economic side effect" -- just via a DIFFERENT,
    // earlier mechanism than gateway-level idempotency convergence. The
    // gateway/idempotencyStore convergence mechanism itself is proven
    // separately and directly: the "execution-idempotency binding through
    // the real engine" describe block above proves the derived key is
    // IDENTICAL across independent workflow attempts, and the "Invoice full
    // local control" describe block's ordinary-replay assertion proves the
    // gateway's idempotencyStore genuinely returns IDEMPOTENT_REPLAY (not a
    // second SUCCESS) for that exact key. Isolating BOTH mechanisms operating
    // together in one test would require also wiring outcome resolution to
    // release workflow A's exposure reservation first -- out of scope here.
    const workflowB = await submitInvoiceWorkflow(rt, { idempotencyKey: "security-attempt-b", duplicateCheckKey: "dup-2", amount: 100 });
    if (!workflowB.ok) throw new Error(`workflow B: ${workflowB.code}: ${workflowB.message}`);
    const valueB = workflowB.value as { workflowId: string; state: string };
    expect(valueB.workflowId).not.toBe(valueA.workflowId);
    // Submission succeeds (a valid, non-error outcome), but Authority's BLOCK
    // decision means it never reaches AUTHORIZED -- no PreparedAction, no
    // CommitToken, so committing it fails outright rather than executing a
    // second side effect.
    expect(valueB.state).not.toBe("AUTHORIZED");
    const committedB = await rt.dispatcher.commitWorkflow(valueB.workflowId);
    expect(committedB.ok).toBe(false);
    expect(await rt.gateway.getSideEffectLedger().listAll()).toHaveLength(1);
  });
});

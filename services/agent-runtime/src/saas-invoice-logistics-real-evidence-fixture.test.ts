import { describe, expect, it } from "vitest";
import { AuthorityDecision, ConstraintKind, ConstraintOperator, TrustClass } from "@truemandate/protocol";
import { demoScenarioTemplate } from "@truemandate/demo-fixtures";
import { explicitConstraint, replaceConstraints, runtime, temporalConstraint } from "./generic-workflow.e2e.test.js";

/**
 * temporalConstraint() hardcodes ConstraintOperator.LTE, but it also
 * attaches the temporalResolution metadata that finalizeVerifiedCompilation
 * requires (kind===TEMPORAL && sourceType===HUMAN && meaningClass===EXPLICIT
 * && temporalResolution present) to derive IntentState.temporalAuthority —
 * without it, Authority's materializationEligible gate reports
 * MISSING_TEMPORAL_AUTHORITY regardless of how cleanly every proof and
 * action-fidelity check passed. Reusing its shape with the operator
 * overridden to LT keeps that resolution while still exercising the
 * genuinely-strict boundary comparison this file's deadline fixes depend on.
 */
function strictTemporalDeadline(id: string, concept: string, resolvedValue: string, originalExpression: string) {
  return { ...temporalConstraint(id, concept, resolvedValue, originalExpression), operator: ConstraintOperator.LT };
}

/**
 * SaaS, Invoice, and Logistics carried through the real evidence-backed
 * lifecycle using the REAL, shipped @truemandate/demo-fixtures data (the
 * same package the deployed orchestrator and public-bff independently
 * reconstruct their evidence from) — not a hand-rolled analog. Mirrors
 * travel-real-evidence-fixture.test.ts's proof that the shipped fixture,
 * not just a structurally-similar stand-in, produces a genuine
 * evidence-backed AUTHORIZED result.
 *
 * Each domain's compiled constraint list below includes ONLY canonical
 * concepts with a literal value actually present in that scenario's
 * rawText — the same standard a closed-vocabulary compiler is held to.
 * Concepts the ontology defines but this rawText never literally states
 * (SaaS "plan", Invoice payee identity / duplicate_payment, Logistics
 * provider identity / budget) are deliberately omitted rather than
 * guessed at; see the Phase 2 audit report for why each is uninstantiable
 * from this rawText, not a bug.
 *
 * Deadline constraints use LT with a date-only bound (mirroring the
 * live-observed Travel/Procurement compiler pattern) rather than the
 * LTE temporalConstraint() helper, so this test genuinely exercises the
 * same equality-at-boundary hazard the Travel root cause proved real —
 * passing here proves the fixed deadline values clear a strict bound,
 * not merely a tolerant one.
 */

function envelope(id: string) {
  return {
    id,
    source: `deterministic-demo-fixture:${id}`,
    contentHash: "c".repeat(64),
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

const EVIDENCE_ID = "real-fixture-offer";

async function runRealFixtureDomain(
  scenarioId: "saas_it_spend" | "invoice_vendor_payment" | "logistics_fulfillment",
  capability: string,
  compiledConstraints: ReturnType<typeof explicitConstraint>[],
) {
  const template = demoScenarioTemplate(scenarioId)!;
  const controlAction = template.variants.control!;
  const rt = await runtime({
    rawText: template.rawText,
    omitProofSummary: true,
    capabilities: { [capability]: AuthorityDecision.ALLOW },
    compilerTransform: replaceConstraints(template.rawText, compiledConstraints),
    demoEvidence: [{ envelope: envelope(EVIDENCE_ID), claims: claims(EVIDENCE_ID, template.evidenceClaims) }],
  });

  const body = (expectedIntentStateId: string) => ({
    intent: { kind: "REFERENCE" as const, intentId: "intent-e2e", expectedIntentStateId },
    action: controlAction,
    domain: { packId: scenarioId, payload: template.domainPayload([EVIDENCE_ID], controlAction) },
    idempotencyKey: `real-fixture-${scenarioId}`,
  });

  let result = await rt.dispatcher.submitWorkflow(body(rt.state.id));
  if (!result.ok && result.code === "INTENT_STATE_NOT_READY") {
    result = await rt.dispatcher.submitWorkflow(
      body(String((result.details as Record<string, unknown>).intentStateId)),
    );
  }
  return { rt, result };
}

async function assertFullyAuthorizedAndReplaySafe(
  scenarioId: "saas_it_spend" | "invoice_vendor_payment" | "logistics_fulfillment",
  capability: string,
  compiledConstraints: ReturnType<typeof explicitConstraint>[],
) {
  const { rt, result } = await runRealFixtureDomain(scenarioId, capability, compiledConstraints);
  if (!result.ok) throw new Error(`${scenarioId}: ${result.code}: ${result.message}`);

  const value = result.value as { state: string; workflowId: string };
  const artifacts = await rt.owner.listWorkflowArtifacts(value.workflowId);
  const rows = artifacts.ok ? (artifacts.value as { kind: string; payload: Record<string, unknown> }[]) : [];
  const proofs = rows.filter((row) => row.kind === "PROOF").map((row) => row.payload);
  const planVerification = rows.find((row) => row.kind === "PLAN_VERIFICATION")?.payload;

  expect(proofs.length).toBeGreaterThan(0);
  for (const proof of proofs) {
    expect(proof.status).toBe("SATISFIED");
  }
  expect((planVerification?.verification as Record<string, unknown>)?.status).toBe("VERIFIED");
  // AUTHORIZED is only reachable if `eligible` was true, which itself
  // requires actionFidelity.preservesIntent === true (generic-workflow-engine.ts) —
  // reaching this state already proves every action-fidelity row MATCHed,
  // without needing a separate artifact lookup (evaluateActionFidelity's
  // result is used transiently in-memory, not persisted as its own kind).
  expect(value.state).toBe("AUTHORIZED");
  expect(rt.calls).toMatchObject({ evaluation: 1, prepare: 1, mint: 1, authorize: 1 });

  const committed = await rt.dispatcher.commitWorkflow(value.workflowId);
  if (!committed.ok) throw new Error(`${scenarioId} commit: ${committed.code}: ${committed.message}`);
  expect(committed.value).toMatchObject({ status: "SUCCESS" });
  expect(await rt.gateway.getSideEffectLedger().listAll()).toHaveLength(1);

  const replay = await rt.dispatcher.commitWorkflow(value.workflowId);
  expect(replay.ok && (replay.value as { status: string }).status).toBe("IDEMPOTENT_REPLAY");
  expect(await rt.gateway.getSideEffectLedger().listAll()).toHaveLength(1);

  return value;
}

describe("SaaS, Invoice, Logistics: real demo-fixtures evidence through the full evidence-backed lifecycle", () => {
  it("SaaS reaches AUTHORIZED on the real fixture's evidence, including the fixed subscription_deadline", async () => {
    // vendor REQUIRE "approved" and term EQ "12 months" are the exact shapes
    // the live deployed compiler emits for this scenario (confirmed via a
    // real cloud control run), not the bare `true`/`12` this test used
    // before that run exposed the term representation gap — see
    // saas-term-normalization.test.ts for the isolated proof.
    const value = await assertFullyAuthorizedAndReplaySafe("saas_it_spend", "manage_saas_subscription", [
      explicitConstraint("c-vendor", "vendor", ConstraintOperator.REQUIRE, "approved", ConstraintKind.HARD, "approved SaaS plan"),
      explicitConstraint("c-seat-count", "seat_count", ConstraintOperator.EQ, 10, ConstraintKind.HARD, "10 seats"),
      explicitConstraint("c-term", "term", ConstraintOperator.EQ, "12 months", ConstraintKind.HARD, "12 month term"),
      explicitConstraint("c-renewal", "renewal", ConstraintOperator.EQ, "MANUAL", ConstraintKind.HARD, "manual renewal"),
      explicitConstraint("c-budget", "budget", ConstraintOperator.LT, 12000, ConstraintKind.FINANCIAL, "under USD 12000"),
      strictTemporalDeadline("c-subscription-deadline", "subscription_deadline", "2026-12-31T00:00:00.000Z", "before December 31, 2026"),
    ]);
    expect(value.state).toBe("AUTHORIZED");
  });

  it("Invoice reaches AUTHORIZED on the real fixture's evidence, including the corrected due_date", async () => {
    const value = await assertFullyAuthorizedAndReplaySafe("invoice_vendor_payment", "pay_invoice", [
      explicitConstraint("c-payee", "payee", ConstraintOperator.EQ, true, ConstraintKind.HARD, "approved vendor"),
      explicitConstraint("c-invoice-identity", "invoice_identity", ConstraintOperator.EQ, "INV-2026-001", ConstraintKind.HARD, "INV-2026-001"),
      explicitConstraint("c-amount", "amount", ConstraintOperator.LT, 25000, ConstraintKind.FINANCIAL, "under USD 25000"),
      strictTemporalDeadline("c-due-date", "due_date", "2026-11-30T00:00:00.000Z", "before November 30, 2026"),
    ]);
    expect(value.state).toBe("AUTHORIZED");
  });

  it("Logistics reaches AUTHORIZED on the real fixture's evidence, including the corrected shipment_deadline", async () => {
    const value = await assertFullyAuthorizedAndReplaySafe("logistics_fulfillment", "arrange_fulfillment", [
      explicitConstraint("c-provider", "provider", ConstraintOperator.EQ, true, ConstraintKind.HARD, "approved carrier"),
      explicitConstraint("c-destination", "destination", ConstraintOperator.EQ, "Mumbai Warehouse", ConstraintKind.HARD, "Mumbai Warehouse"),
      explicitConstraint("c-service-level", "service_level", ConstraintOperator.EQ, "EXPRESS", ConstraintKind.HARD, "EXPRESS"),
      explicitConstraint("c-fulfillment-count", "fulfillment_count", ConstraintOperator.EQ, 12, ConstraintKind.HARD, "12"),
      strictTemporalDeadline("c-shipment-deadline", "shipment_deadline", "2026-10-01T00:00:00.000Z", "before October 1, 2026"),
    ]);
    expect(value.state).toBe("AUTHORIZED");
  });
});

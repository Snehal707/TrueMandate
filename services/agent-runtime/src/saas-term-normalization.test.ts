import { describe, expect, it } from "vitest";
import { ConstraintKind, ConstraintOperator, TrustClass, type ActionProposal, type IntentState } from "@truemandate/protocol";
import { demoScenarioTemplate } from "@truemandate/demo-fixtures";
import { explicitConstraint, replaceConstraints, runtime } from "./generic-workflow.e2e.test.js";
import { actionField, evaluateActionChecks } from "./action-fidelity.js";
import { SaasItSpendDomainPack } from "./saas-it-spend-domain-pack.js";

/**
 * The live deployed compiler emits the SaaS term constraint as
 * `term EQ "12 months"` (a duration string with the unit embedded), not the
 * bare number `12` every local test and the term_months evidence claim
 * assumed. That is a genuine representation-normalization gap for the
 * canonical `term` concept, not a fixture-content defect: term_months=12
 * and "12 months" are the SAME semantic fact (the field name itself commits
 * to months), so reshaping the evidence to imitate Gemini's current text
 * formatting would just trade one brittle assumption for another.
 *
 * isTermFactConcept/normalizeTermMonths/compareTermMonths in
 * @truemandate/semantic-readiness are the single, narrowly-scoped fix,
 * shared by both call sites that need it: pre-execution-readiness's
 * compareConstraint and action-fidelity's constraintStatus. Nothing here
 * touches generic EQ, Guardian, Authority, the compiler's canonical
 * vocabulary, or any other domain's concepts.
 */

function envelope(id: string) {
  return {
    id,
    source: `deterministic-demo-fixture:${id}`,
    contentHash: "d".repeat(64),
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

const EVIDENCE_ID = "term-normalization-offer";

async function evaluateSaasTermReadiness(termConstraintValue: unknown) {
  const template = demoScenarioTemplate("saas_it_spend")!;
  const rt = await runtime({
    rawText: template.rawText,
    omitProofSummary: true,
    compilerTransform: replaceConstraints(template.rawText, [
      explicitConstraint("c-term", "term", ConstraintOperator.EQ, termConstraintValue, ConstraintKind.HARD, "12 month term"),
    ]),
    demoEvidence: [{ envelope: envelope(EVIDENCE_ID), claims: claims(EVIDENCE_ID, [{ concept: "term_months", value: 12 }]) }],
  });
  const result = await rt.preExecutionReadiness!.evaluate({
    packId: "saas_it_spend",
    intentId: "intent-e2e",
    intentStateId: rt.state.id,
    verifiedEvidenceIds: [EVIDENCE_ID],
    verifiedClaimIds: [`${EVIDENCE_ID}-term_months`],
  });
  expect(result.ok).toBe(true);
  return result.ok
    ? (result.value as { proofRows: readonly { constraintId?: string; status: string }[]; superseded: boolean })
    : undefined;
}

function termActionFidelityRow(constraintValue: unknown, actualTermMonths: unknown) {
  const state = {
    constraints: [
      {
        id: "c-term",
        concept: "term",
        operator: ConstraintOperator.EQ,
        value: constraintValue,
        kind: ConstraintKind.HARD,
        importance: 1,
        confidence: 1,
      },
    ],
  } as unknown as IntentState;
  const action = {
    parameters: { termMonths: actualTermMonths },
  } as unknown as ActionProposal;
  const evaluation = evaluateActionChecks(state, SaasItSpendDomainPack.planning, [
    {
      canonicalConcept: "term",
      field: "parameters.termMonths",
      actualValue: actionField<unknown>(action, "termMonths"),
    },
  ]);
  return evaluation.rows.find((row) => row.constraintId === "c-term");
}

describe("SaaS term: real live-compiler value shape against the real term_months evidence", () => {
  it("real fixture's term_months=12 evidence SATISFIES the real compiler's term EQ \"12 months\" constraint", async () => {
    const value = await evaluateSaasTermReadiness("12 months");
    const termRow = value?.proofRows.find((row) => row.constraintId === "c-term");
    expect(termRow?.status).toBe("SATISFIED");
  });

  it("the bare-number form term EQ 12 still works unchanged (pre-existing shape, not a regression)", async () => {
    const value = await evaluateSaasTermReadiness(12);
    const termRow = value?.proofRows.find((row) => row.constraintId === "c-term");
    expect(termRow?.status).toBe("SATISFIED");
  });
});

describe("SaaS term action fidelity: normalized duration comparison", () => {
  it("POSITIVE: constraint \"12 months\" vs action 12 -> MATCH", () => {
    const row = termActionFidelityRow("12 months", 12);
    expect(row?.status).toBe("MATCH");
  });

  it("POSITIVE: constraint 12 vs action 12 -> MATCH (unchanged bare-number shape)", () => {
    const row = termActionFidelityRow(12, 12);
    expect(row?.status).toBe("MATCH");
  });

  it("POSITIVE: constraint \"12 month\" (singular) vs action 12 -> MATCH", () => {
    const row = termActionFidelityRow("12 month", 12);
    expect(row?.status).toBe("MATCH");
  });

  it("NEGATIVE: constraint \"12 months\" vs action 6 -> MISMATCH", () => {
    const row = termActionFidelityRow("12 months", 6);
    expect(row?.status).toBe("MISMATCH");
  });

  it("NEGATIVE: constraint \"12 months\" vs action 13 -> MISMATCH", () => {
    const row = termActionFidelityRow("12 months", 13);
    expect(row?.status).toBe("MISMATCH");
  });

  it("NEGATIVE: constraint \"12 months\" vs action \"6 months\" -> MISMATCH, not silently equal", () => {
    const row = termActionFidelityRow("12 months", "6 months");
    expect(row?.status).toBe("MISMATCH");
  });

  it("FAIL-CLOSED: an ambiguous/unparseable duration is never guessed into equality", () => {
    const row = termActionFidelityRow("12 months", "one year");
    expect(row?.status).toBe("UNKNOWN");
    expect(row?.status).not.toBe("MATCH");
  });

  it("FAIL-CLOSED: a different unit (weeks) is never coerced into a month comparison", () => {
    const row = termActionFidelityRow("12 weeks", 12);
    expect(row?.status).toBe("UNKNOWN");
  });
});

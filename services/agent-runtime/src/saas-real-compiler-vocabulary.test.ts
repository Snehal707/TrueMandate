import { describe, expect, it } from "vitest";
import { ConstraintKind, ConstraintOperator, TrustClass } from "@truemandate/protocol";
import { demoScenarioTemplate, evidenceClaimId, evidenceEnvelopeId } from "@truemandate/demo-fixtures";
import { explicitConstraint, replaceConstraints, runtime, temporalConstraint } from "./generic-workflow.e2e.test.js";

const SCENARIO_ID = "saas_it_spend";
const RUN_ID = "real-compiler-vocabulary-regression";
const TEMPLATE = demoScenarioTemplate(SCENARIO_ID)!;
const ENVELOPE_ID = evidenceEnvelopeId(SCENARIO_ID, RUN_ID);

function liveCompilerConstraints() {
  return [
    explicitConstraint("c-plan", "plan", ConstraintOperator.EQ, "Business Plan", ConstraintKind.HARD, "Business Plan"),
    explicitConstraint("c-seat-count", "seat_count", ConstraintOperator.EQ, 10, ConstraintKind.HARD, "10 seats"),
    explicitConstraint("c-vendor", "vendor", ConstraintOperator.REQUIRE, "approved", ConstraintKind.ORGANIZATIONAL_POLICY, "approved vendor"),
    explicitConstraint("c-renewal", "renewal", ConstraintOperator.EQ, "manual", ConstraintKind.HARD, "manual renewal"),
    explicitConstraint("c-term", "term", ConstraintOperator.EQ, "12 month", ConstraintKind.HARD, "12 month term"),
    explicitConstraint("c-budget", "budget", ConstraintOperator.LT, 12000, ConstraintKind.FINANCIAL, "under USD 12000"),
    {
      ...temporalConstraint(
        "c-subscription-deadline",
        "subscription_deadline",
        "2026-12-31T00:00:00.000Z",
        "before December 31, 2026",
      ),
      operator: ConstraintOperator.LT,
      value: "2026-12-31",
    },
  ];
}

function demoEvidenceFromTemplate() {
  return [
    {
      envelope: {
        id: ENVELOPE_ID,
        source: TEMPLATE.evidenceSource,
        contentHash: "d".repeat(64),
        captureTime: TEMPLATE.evidenceCaptureTime,
        mimeType: "application/json",
        trustClass: TrustClass.ELEVATED_EXTERNAL,
        taint: { classes: ["EXTERNAL_CONTENT"], origins: ["verified-by:demo-fixture-writer"] },
      },
      claims: TEMPLATE.evidenceClaims.map((claim) => ({
        id: evidenceClaimId(SCENARIO_ID, RUN_ID, claim.concept),
        evidenceId: ENVELOPE_ID,
        concept: claim.concept,
        value: claim.value,
        confidence: 1,
      })),
    },
  ];
}

async function evaluateRealVocabulary() {
  const evidence = demoEvidenceFromTemplate();
  const rt = await runtime({
    rawText: TEMPLATE.rawText,
    omitProofSummary: true,
    compilerTransform: replaceConstraints(TEMPLATE.rawText, liveCompilerConstraints()),
    demoEvidence: evidence,
    verificationReadiness: "ACTIONABLE",
  });
  const result = await rt.preExecutionReadiness!.evaluate({
    packId: "saas_it_spend",
    intentId: "intent-e2e",
    intentStateId: rt.state.id,
    verifiedEvidenceIds: evidence.map((row) => row.envelope.id),
    verifiedClaimIds: evidence.flatMap((row) => row.claims.map((claim) => claim.id)),
  });
  return { rt, result };
}

describe("SaaS: real Gemini-compiler vocabulary against the demo-fixtures evidence", () => {
  it("all trusted SaaS proof rows resolve SATISFIED and supersede S0 into a proof-backed S1", async () => {
    const { rt, result } = await evaluateRealVocabulary();
    expect(result.ok).toBe(true);
    const value = result.ok
      ? (result.value as {
          proofRows: readonly { constraintId?: string; status: string; expected?: unknown }[];
          coverage: { allRequiredCovered: boolean };
          superseded: boolean;
          successor?: { state: { id: string }; semanticArtifactId: string };
        })
      : undefined;

    const byConstraint = Object.fromEntries((value?.proofRows ?? []).map((row) => [row.constraintId, row.status]));
    expect(byConstraint).toEqual({
      "c-plan": "SATISFIED",
      "c-seat-count": "SATISFIED",
      "c-vendor": "SATISFIED",
      "c-renewal": "SATISFIED",
      "c-term": "SATISFIED",
      "c-budget": "SATISFIED",
      "c-subscription-deadline": "SATISFIED",
    });
    const planClaim = TEMPLATE.evidenceClaims.find((claim) => claim.concept === "plan_name");
    expect(planClaim?.value).toBe("Business Plan");
    expect(value?.coverage.allRequiredCovered).toBe(true);
    expect(value?.superseded).toBe(true);
    expect(value?.successor?.state.id).toBeTruthy();
    expect(value?.successor?.state.id).not.toBe(rt.state.id);

    const artifact = await rt.owner.getSemanticArtifact(value!.successor!.semanticArtifactId);
    expect(artifact.ok).toBe(true);
    const payload = artifact.ok ? (artifact.value as { payload: Record<string, unknown> }).payload : undefined;
    const proofSummary = payload?.proofSummary as
      | { verifiedEvidenceRefs?: readonly { id: string }[]; proofRows?: readonly unknown[] }
      | undefined;
    expect(proofSummary).toBeDefined();
    expect(proofSummary?.proofRows).toHaveLength(7);
    expect(proofSummary?.verifiedEvidenceRefs?.map((ref) => ref.id)).toContain(ENVELOPE_ID);
  });
});

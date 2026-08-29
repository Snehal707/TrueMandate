import { describe, expect, it } from "vitest";
import { ConstraintKind, ConstraintOperator, TrustClass } from "@truemandate/protocol";
import { demoScenarioTemplate, evidenceClaimId, evidenceEnvelopeId } from "@truemandate/demo-fixtures";
import { explicitConstraint, replaceConstraints, runtime } from "./generic-workflow.e2e.test.js";

const SCENARIO_ID = "travel";
const TEMPLATE = demoScenarioTemplate(SCENARIO_ID)!;

function liveCompiledConstraints() {
  return [
    explicitConstraint("c-stay-count", "stay_count", ConstraintOperator.EQ, 2, ConstraintKind.HARD, "2"),
    explicitConstraint("c-refundability", "refundability", ConstraintOperator.REQUIRE, true, ConstraintKind.HARD, "refundable"),
    explicitConstraint("c-property", "property", ConstraintOperator.EQ, "Seaside Lodge", ConstraintKind.HARD, "Seaside Lodge"),
    explicitConstraint("c-provider", "provider", ConstraintOperator.EQ, "Meridian Travel Partners", ConstraintKind.HARD, "Meridian Travel Partners"),
    explicitConstraint("c-budget", "budget", ConstraintOperator.LT, 5000, ConstraintKind.FINANCIAL, "under USD 5000"),
    explicitConstraint("c-completion-deadline", "completion_deadline", ConstraintOperator.LT, "2026-12-31", ConstraintKind.TEMPORAL, "before December 31, 2026"),
    explicitConstraint("c-stay-start", "stay_start", ConstraintOperator.EQ, "2026-12-20", ConstraintKind.TEMPORAL, "December 20"),
    explicitConstraint("c-stay-end", "stay_end", ConstraintOperator.EQ, "2026-12-22", ConstraintKind.TEMPORAL, "December 22"),
  ];
}

function evidenceRows(runId: string, claims: readonly { readonly concept: string; readonly value: unknown }[]) {
  const envelopeId = evidenceEnvelopeId(SCENARIO_ID, runId);
  return [
    {
      envelope: {
        id: envelopeId,
        source: TEMPLATE.evidenceSource,
        contentHash: "e".repeat(64),
        captureTime: TEMPLATE.evidenceCaptureTime,
        mimeType: "application/json",
        trustClass: TrustClass.ELEVATED_EXTERNAL,
        taint: { classes: ["EXTERNAL_CONTENT"], origins: ["verified-by:demo-fixture-writer"] },
      },
      claims: claims.map((claim) => ({
        id: evidenceClaimId(SCENARIO_ID, runId, claim.concept),
        evidenceId: envelopeId,
        concept: claim.concept,
        value: claim.value,
        confidence: 1,
      })),
    },
  ];
}

async function evaluateTravelReadiness(
  runId: string,
  claims: readonly { readonly concept: string; readonly value: unknown }[],
) {
  const evidence = evidenceRows(runId, claims);
  const rt = await runtime({
    rawText: TEMPLATE.rawText,
    omitProofSummary: true,
    compilerTransform: replaceConstraints(TEMPLATE.rawText, liveCompiledConstraints()),
    demoEvidence: evidence,
    verificationReadiness: "PLANNABLE",
  });
  const result = await rt.preExecutionReadiness!.evaluate({
    packId: "travel",
    intentId: "intent-e2e",
    intentStateId: rt.state.id,
    verifiedEvidenceIds: evidence.map((row) => row.envelope.id),
    verifiedClaimIds: evidence.flatMap((row) => row.claims.map((claim) => claim.id)),
  });
  return { rt, result };
}

describe("Travel readiness — historical regression for the diagnosed evidence-fixture bug", () => {
  it("2026-08-29 pre-fix evidence shape reproduces superseded:false, provider UNKNOWN, completion_deadline UNSATISFIED", async () => {
    // Hardcoded to the EXACT evidence shape @truemandate/demo-fixtures'
    // Travel template carried before the fix below — not read from the live
    // template, which is now fixed. Kept permanently as proof of the
    // diagnosed root cause (EVIDENCE SEMANTIC MISMATCH on provider identity,
    // EVIDENCE VALUE MISMATCH on completion_deadline), not a specification
    // of desired behavior — nothing should ever make this reproduce again.
    const preFixClaims = [
      { concept: "approved_provider", value: true },
      { concept: "hotel_name", value: "Seaside Lodge" },
      { concept: "refundable", value: true },
      { concept: "traveler_count", value: 2 },
      { concept: "travel_budget", value: 3200 },
      { concept: "check_in_date", value: "2026-12-20T00:00:00.000Z" },
      { concept: "check_out_date", value: "2026-12-22T00:00:00.000Z" },
      { concept: "booking_deadline", value: "2026-12-31T00:00:00.000Z" },
    ];
    const { rt, result } = await evaluateTravelReadiness("historical-pre-fix", preFixClaims);
    expect(result.ok).toBe(true);
    const value = result.ok
      ? (result.value as {
          intentStateId: string;
          superseded: boolean;
          proofRows: readonly { constraintId?: string; status: string; reason: string }[];
          coverage: { allRequiredCovered: boolean };
        })
      : undefined;

    expect(value?.superseded).toBe(false);
    expect(value?.coverage.allRequiredCovered).toBe(true);
    expect(value?.intentStateId).toBe(rt.state.id);

    const byConstraint = Object.fromEntries(
      (value?.proofRows ?? []).map((row) => [row.constraintId, row.status]),
    );
    expect(byConstraint).toEqual({
      "c-stay-count": "SATISFIED",
      "c-refundability": "SATISFIED",
      "c-property": "SATISFIED",
      "c-provider": "UNKNOWN",
      "c-budget": "SATISFIED",
      "c-completion-deadline": "UNSATISFIED",
      "c-stay-start": "SATISFIED",
      "c-stay-end": "SATISFIED",
    });
    const providerRow = value?.proofRows.find((row) => row.constraintId === "c-provider");
    expect(providerRow?.reason).toBe("No verified evidence matched the authoritative constraint");
  });
});

describe("Travel: real demo-fixtures evidence against the live canonical constraint set", () => {
  it("all 8 canonical constraints resolve SATISFIED and the evidence-backed handoff supersedes the compiled state", async () => {
    const { rt, result } = await evaluateTravelReadiness("real-evidence-fixture-regression", TEMPLATE.evidenceClaims);
    expect(result.ok).toBe(true);
    const value = result.ok
      ? (result.value as {
          proofRows: readonly { constraintId?: string; status: string }[];
          coverage: { allRequiredCovered: boolean };
          superseded: boolean;
          successor?: { state: { id: string }; semanticArtifactId: string };
        })
      : undefined;

    const byConstraint = Object.fromEntries(
      (value?.proofRows ?? []).map((row) => [row.constraintId, row.status]),
    );
    expect(byConstraint).toEqual({
      "c-stay-count": "SATISFIED",
      "c-refundability": "SATISFIED",
      "c-property": "SATISFIED",
      "c-provider": "SATISFIED",
      "c-budget": "SATISFIED",
      "c-completion-deadline": "SATISFIED",
      "c-stay-start": "SATISFIED",
      "c-stay-end": "SATISFIED",
    });

    expect(value?.coverage.allRequiredCovered).toBe(true);
    const allSatisfied = (value?.proofRows.length ?? 0) > 0 && value!.proofRows.every((row) => row.status === "SATISFIED");
    expect(allSatisfied).toBe(true);
    expect(value?.superseded).toBe(true);

    // Evidence-backed successor IntentState (S1), distinct from the
    // compiled S0.
    expect(value?.successor?.state.id).toBeTruthy();
    expect(value?.successor?.state.id).not.toBe(rt.state.id);

    const artifact = await rt.owner.getSemanticArtifact(value!.successor!.semanticArtifactId);
    expect(artifact.ok).toBe(true);
    const payload = artifact.ok ? (artifact.value as { payload: Record<string, unknown> }).payload : undefined;
    const proofSummary = payload?.proofSummary as
      | { verifiedEvidenceRefs?: readonly { id: string }[]; proofRows?: readonly unknown[] }
      | undefined;
    expect(proofSummary).toBeDefined();
    expect(proofSummary?.proofRows).toHaveLength(8);
  });
});

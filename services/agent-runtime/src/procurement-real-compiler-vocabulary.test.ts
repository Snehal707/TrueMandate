import { describe, expect, it } from "vitest";
import { ConstraintKind, ConstraintOperator, TrustClass } from "@truemandate/protocol";
import { demoScenarioTemplate, evidenceClaimId, evidenceEnvelopeId } from "@truemandate/demo-fixtures";
import { explicitConstraint, replaceConstraints, runtime, temporalConstraint } from "./generic-workflow.e2e.test.js";

/**
 * Closes the compiler-fidelity caveat documented in
 * services/phase-c-verifier/src/demo-orchestrator.ts: every other Procurement
 * test in this suite (evidence-backed-canary.test.ts,
 * demo-orchestrator-pipeline.test.ts) proves the readiness matching path
 * against the DETERMINISTIC test compiler's constraint vocabulary
 * (cleanCompilerOutput / this file's own default handler) — concept/operator/
 * value pairs authored against the test compiler, not against a live run of
 * the real deployed Gemini compiler.
 *
 * This test instead hardcodes the real compiler's actual output for
 * @truemandate/demo-fixtures' Procurement rawText, read directly from the
 * live compiled IntentState during the 2026-08-29 forensic investigation:
 * c1 quantity EQ 500, c2 item_specification REQUIRE "food-grade containers",
 * c3 supplier_status REQUIRE "approved", c4 budget_limit LT 800000,
 * c5 deadline LT "2026-12-31". Only concept/operator/value are the literal
 * live values; kind/sourceType/mutability/meaningClass follow this
 * repository's own deterministic-compiler classification of the same
 * underlying concepts (cleanCompilerOutput), corroborated by the
 * already-established live observation that this workflow produced exactly
 * five required (non-preference) proof rows.
 *
 * It evaluates PreExecutionReadinessService.evaluate() directly rather than
 * going through coordinator.run()/dispatcher.submitWorkflow(): when
 * supersession isn't eligible, resolveEvidenceBackedState only reads the
 * boolean `superseded` field and discards the rest, so the durable PROOF
 * artifacts collapse to a uniform authoritative-proof-handoff-absent/UNKNOWN
 * for every constraint. The differentiated per-constraint result this test
 * asserts is only observable from evaluate()'s own return value.
 */

const SCENARIO_ID = "procurement";
const RUN_ID = "real-compiler-vocabulary-regression";
const TEMPLATE = demoScenarioTemplate(SCENARIO_ID)!;
const ENVELOPE_ID = evidenceEnvelopeId(SCENARIO_ID, RUN_ID);

function realCompilerConstraints() {
  return [
    explicitConstraint("c1", "quantity", ConstraintOperator.EQ, 500, ConstraintKind.HARD, "500"),
    explicitConstraint(
      "c2",
      "item_specification",
      ConstraintOperator.REQUIRE,
      "food-grade containers",
      ConstraintKind.HARD,
      "food-grade containers",
    ),
    explicitConstraint(
      "c3",
      "supplier_status",
      ConstraintOperator.REQUIRE,
      "approved",
      ConstraintKind.HARD,
      "approved supplier",
    ),
    explicitConstraint("c4", "budget_limit", ConstraintOperator.LT, 800000, ConstraintKind.FINANCIAL, "under INR 800000"),
    // temporalResolution.resolvedValue must be a full offset datetime (it
    // becomes IntentState.temporalAuthority.executionNotAfter, validated by
    // z.string().datetime({offset:true})) — separate from the constraint's
    // own `value`, which stays the literal live compiler value "2026-12-31"
    // that compareConstraint's LT actually compares against.
    {
      ...temporalConstraint("c5", "deadline", "2026-12-31T00:00:00.000Z", "before December 31, 2026"),
      operator: ConstraintOperator.LT,
      value: "2026-12-31",
    },
  ];
}

/** The demo-fixtures Procurement claims, wired through the real evidence port exactly as the live A-Prime provisioning route derives ids. */
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
    compilerTransform: replaceConstraints(TEMPLATE.rawText, realCompilerConstraints()),
    demoEvidence: evidence,
    verificationReadiness: "ACTIONABLE",
  });
  const result = await rt.preExecutionReadiness!.evaluate({
    packId: "procurement",
    intentId: "intent-e2e",
    intentStateId: rt.state.id,
    verifiedEvidenceIds: evidence.map((row) => row.envelope.id),
    verifiedClaimIds: evidence.flatMap((row) => row.claims.map((claim) => claim.id)),
  });
  return { rt, result };
}

describe("Procurement: real Gemini-compiler vocabulary against the demo-fixtures evidence", () => {
  it("all five constraints resolve SATISFIED and the evidence-backed handoff supersedes the compiled state", async () => {
    const { rt, result } = await evaluateRealVocabulary();
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
      c1: "SATISFIED",
      c2: "SATISFIED",
      c3: "SATISFIED",
      c4: "SATISFIED",
      c5: "SATISFIED",
    });

    expect(value?.coverage.allRequiredCovered).toBe(true);
    const allSatisfied = (value?.proofRows.length ?? 0) > 0 && value!.proofRows.every((row) => row.status === "SATISFIED");
    expect(allSatisfied).toBe(true);

    // supersessionEligible: only reachable when every gate in
    // PreExecutionReadinessService.evaluate() passed — superseded is the
    // externally observable proxy for that internal boolean.
    expect(value?.superseded).toBe(true);

    // Evidence-backed successor IntentState, distinct from the compiled S0.
    expect(value?.successor?.state.id).toBeTruthy();
    expect(value?.successor?.state.id).not.toBe(rt.state.id);

    // proofSummary exists on the successor's semantic artifact and
    // references the verified evidence — never the harness's synthetic
    // omitProofSummary shortcut (unused here; this test calls evaluate()
    // directly).
    const artifact = await rt.owner.getSemanticArtifact(value!.successor!.semanticArtifactId);
    expect(artifact.ok).toBe(true);
    const payload = artifact.ok ? (artifact.value as { payload: Record<string, unknown> }).payload : undefined;
    const proofSummary = payload?.proofSummary as
      | { verifiedEvidenceRefs?: readonly { id: string }[]; proofRows?: readonly unknown[] }
      | undefined;
    expect(proofSummary).toBeDefined();
    expect(proofSummary?.proofRows).toHaveLength(5);
    expect(proofSummary?.verifiedEvidenceRefs?.map((ref) => ref.id)).toContain(ENVELOPE_ID);
  });
});

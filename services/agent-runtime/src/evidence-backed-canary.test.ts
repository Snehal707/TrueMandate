import { describe, expect, it } from "vitest";
import { TrustClass } from "@truemandate/protocol";
import { request, runtime } from "./generic-workflow.e2e.test.js";

/**
 * The canary: one legitimate, sufficiently evidenced procurement request carried
 * through the real generic lifecycle.
 *
 * Procurement is the clearest contract — five execution-critical concepts
 * (supplier, material, quantity, budget, delivery_deadline), all EVIDENCE_OBLIGATION,
 * no deterministic-rule mechanisms to model.
 *
 * The harness's `semanticPayload.proofSummary = summary` shortcut is suppressed
 * here (`omitProofSummary`). Supplying `demoEvidence` wires the REAL
 * PreExecutionReadinessService, so a proof summary can only exist if the genuine
 * evidence-backed readiness operation produced one. Every assertion below reads
 * durable artifacts, never a workspace projection.
 */

const EXPIRY = "2026-12-31T17:00:00.000Z";

/**
 * Deterministic demo evidence, already ELEVATED_EXTERNAL because a trusted
 * acceptance-fixture writer attested it out of band. The requester references
 * these ids; it never created or verified them.
 */
const PROCUREMENT_EVIDENCE = [
  {
    envelope: {
      id: "demo-procurement-offer",
      source: "deterministic-demo-fixture:procurement",
      contentHash: "a".repeat(64),
      captureTime: "2026-06-01T00:00:00.000Z",
      mimeType: "application/json",
      trustClass: TrustClass.ELEVATED_EXTERNAL,
      taint: { classes: ["EXTERNAL_CONTENT"], origins: ["verified-by:demo-fixture-writer"] },
    },
    claims: [
      { id: "demo-procurement-quantity", evidenceId: "demo-procurement-offer", concept: "quantity", value: 500, confidence: 1 },
      { id: "demo-procurement-material", evidenceId: "demo-procurement-offer", concept: "food_grade", value: true, confidence: 1 },
      { id: "demo-procurement-budget", evidenceId: "demo-procurement-offer", concept: "budget", value: 742000, confidence: 1 },
      { id: "demo-procurement-supplier", evidenceId: "demo-procurement-offer", concept: "approved_supplier", value: true, confidence: 1 },
      { id: "demo-procurement-deadline", evidenceId: "demo-procurement-offer", concept: "execution_deadline", value: EXPIRY, confidence: 1 },
    ],
  },
];

async function canary() {
  const rt = await runtime({ omitProofSummary: true, demoEvidence: PROCUREMENT_EVIDENCE, verificationReadiness: "PLANNABLE" });
  const submitted = { ...request(), expectedIntentStateId: rt.state.id, evidenceIds: ["demo-procurement-offer"] };
  const result = await rt.coordinator.run(submitted);
  return { rt, result, s0: rt.state.id };
}

describe("canary: a legitimate evidenced request through the real lifecycle", () => {
  it("reaches Authority and governed mock execution, with the proof summary produced by the real readiness path", async () => {
    const { rt, result, s0 } = await canary();

    // The submission may be re-driven once: evidence-backed readiness supersedes
    // S0, and the caller named S0 explicitly, so the protocol asks it to rebind.
    let final = result;
    if (!final.ok && final.code === "INTENT_STATE_NOT_READY") {
      const successorId = String((final.details as Record<string, unknown>).intentStateId);
      expect(successorId).not.toBe(s0);
      final = await rt.coordinator.run({
        ...request(),
        expectedIntentStateId: successorId,
        evidenceIds: ["demo-procurement-offer"],
      });
    }

    expect(final.ok).toBe(true);
    const value = final.ok ? (final.value as { workflowId: string; state: string }) : undefined;
    // eslint-disable-next-line no-console
    console.log("CANARY workflow state:", value?.state, "workflowId:", value?.workflowId);

    const artifacts = await rt.owner.listWorkflowArtifacts(value!.workflowId);
    const rows = artifacts.ok ? (artifacts.value as { id: string; kind: string; payload: Record<string, unknown> }[]) : [];
    const byKind = (kind: string) => rows.filter((row) => row.kind === kind);

    const boundStateId = String((byKind("WORKFLOW")[0]?.payload.intentStateId) ?? "");
    // eslint-disable-next-line no-console
    console.log("CANARY bound state:", boundStateId, "| S0 was:", s0);

    // Proof rows must come from the real handoff, not the absent-summary path.
    const proofs = byKind("PROOF").map((row) => ({ status: row.payload.status, method: row.payload.method, constraintId: row.payload.constraintId }));
    // eslint-disable-next-line no-console
    console.log("CANARY proofs:", JSON.stringify(proofs));

    const planVerification = byKind("PLAN_VERIFICATION")[0]?.payload as Record<string, unknown> | undefined;
    const guardian = byKind("GUARDIAN")[0]?.payload as Record<string, unknown> | undefined;
    // eslint-disable-next-line no-console
    console.log(
      "CANARY planVerification:",
      JSON.stringify((planVerification?.verification as Record<string, unknown>)?.status),
      "| guardian:",
      JSON.stringify((guardian?.verdict as Record<string, unknown>)?.decision),
    );
    // ── the whole point: a legitimate evidenced request reaches Authority ──
    expect(value?.state).toBe("AUTHORIZED");
    expect(boundStateId).not.toBe(s0);
    expect(boundStateId).toContain("-semantic-");

    // Every proof satisfied, and produced by the real handoff — not the
    // absent-summary path and not a harness-seeded summary.
    expect(proofs).toHaveLength(5);
    for (const proof of proofs) {
      expect(proof.status).toBe("SATISFIED");
      expect(proof.method).toBe("authoritative-proof-handoff");
    }

    expect((planVerification?.verification as Record<string, unknown>)?.status).toBe("VERIFIED");
    expect((guardian?.verdict as Record<string, unknown>)?.decision).toBe("ALLOW");
    expect(rt.calls).toMatchObject({ evaluation: 1, prepare: 1, mint: 1, authorize: 1 });

    // ── cryptographic binding, read from the durable token store ──
    const authorization = (final.ok ? final.value : {}) as {
      authorization?: { commitToken?: { id: string }; grant?: { id: string; preparedActionId: string } };
    };
    const tokenId = authorization.authorization?.commitToken?.id;
    expect(tokenId).toBeTruthy();
    const stored = await rt.gateway.getCommitTokenStore().get(tokenId!);
    expect(stored.ok).toBe(true);
    const token = stored.ok ? (stored.value as Record<string, unknown>) : undefined;
    expect(token).toBeTruthy();
    expect(token?.consumed).toBe(false);
    // The token is bound to the SUPERSEDED state that Authority actually authorized,
    // never to the pre-evidence state the caller first named.
    const boundHash = String((byKind("WORKFLOW")[0]?.payload.intentStateHash) ?? "");
    expect(String(token?.intentStateHash)).toBe(boundHash);
    expect(String(token?.preparedActionId))
      .toBe(authorization.authorization?.grant?.preparedActionId);
    expect(String(token?.nonce ?? "")).not.toHaveLength(0);

    // ── governed mock execution, exactly once ──
    const committed = await rt.dispatcher.commitWorkflow(value!.workflowId);
    if (!committed.ok) throw new Error(`commit failed: ${committed.code}: ${committed.message}`);
    expect(committed.value).toMatchObject({ status: "SUCCESS" });
    expect(await rt.gateway.getSideEffectLedger().listAll()).toHaveLength(1);

    const replay = await rt.dispatcher.commitWorkflow(value!.workflowId);
    if (!replay.ok) throw new Error(`replay failed: ${replay.code}: ${replay.message}`);
    expect(replay.value).toMatchObject({ status: "IDEMPOTENT_REPLAY" });
    // Replay must not produce a second economic effect.
    expect(await rt.gateway.getSideEffectLedger().listAll()).toHaveLength(1);
  });
});

/**
 * The supersession gate only fires from SEARCHABLE or PLANNABLE
 * (`pre-execution-readiness.ts:515`). Supersession is also the only producer of a
 * proof summary. So an intent already promoted to ACTIONABLE by the lexical
 * purchase heuristic can never acquire one, and can never satisfy completeProofs
 * — no matter how much verified evidence it references.
 *
 * This is not a hypothetical: procurement is the one Live Proof preset whose
 * compiled concepts match that heuristic, and it is the one preset observed
 * stopping at proofs rather than plan verification.
 */
describe("readiness already ACTIONABLE cannot acquire a proof summary", () => {
  it("stays blocked with identical evidence, because supersession never runs", async () => {
    const rt = await runtime({ omitProofSummary: true, demoEvidence: PROCUREMENT_EVIDENCE });
    const result = await rt.coordinator.run({
      ...request(),
      expectedIntentStateId: rt.state.id,
      evidenceIds: ["demo-procurement-offer"],
    });

    expect(result.ok).toBe(true);
    const value = result.ok ? (result.value as { workflowId: string; state: string }) : undefined;
    expect(value?.state).toBe("BLOCKED");

    const artifacts = await rt.owner.listWorkflowArtifacts(value!.workflowId);
    const rows = artifacts.ok ? (artifacts.value as { kind: string; payload: Record<string, unknown> }[]) : [];
    // No supersession: the workflow is still bound to the state the caller named.
    expect(String(rows.find((row) => row.kind === "WORKFLOW")?.payload.intentStateId)).toBe(rt.state.id);
    for (const proof of rows.filter((row) => row.kind === "PROOF")) {
      expect(proof.payload.method).toBe("authoritative-proof-handoff-absent");
    }
  });
});

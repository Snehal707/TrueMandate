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
 * ACTIONABLE is eligible for evidence-backed proof attachment, never for
 * promotion. Supersession is the only producer of a proof summary, so without
 * this a state the lexical heuristic promoted early could never acquire one and
 * could never satisfy completeProofs — however much verified evidence it carried.
 * Procurement is the one Live Proof preset that heuristic fires for, and the one
 * preset observed stopping at proofs rather than plan verification.
 *
 * Every fail-closed condition is unchanged: the tier this path writes is the tier
 * it read, and evidence that is absent, untrusted, incomplete or unsatisfying
 * still yields no summary.
 */

/** Runs a procurement submission at the preset's natural readiness. */
async function runAtNaturalReadiness(
  demoEvidence: typeof PROCUREMENT_EVIDENCE | undefined,
  evidenceIds: readonly string[],
) {
  const rt = await runtime({ omitProofSummary: true, ...(demoEvidence ? { demoEvidence } : {}) });
  let result = await rt.coordinator.run({ ...request(), expectedIntentStateId: rt.state.id, evidenceIds });
  if (!result.ok && result.code === "INTENT_STATE_NOT_READY") {
    const successorId = String((result.details as Record<string, unknown>).intentStateId);
    result = await rt.coordinator.run({ ...request(), expectedIntentStateId: successorId, evidenceIds });
  }
  const value = result.ok ? (result.value as { workflowId: string; state: string }) : undefined;
  const artifacts = value ? await rt.owner.listWorkflowArtifacts(value.workflowId) : undefined;
  const rows = artifacts?.ok ? (artifacts.value as { kind: string; payload: Record<string, unknown> }[]) : [];
  const boundStateId = String(rows.find((row) => row.kind === "WORKFLOW")?.payload.intentStateId ?? "");
  const readAt = boundStateId ? await rt.owner.getSemanticArtifact(`semantic-verification-${boundStateId}`) : undefined;
  const verification = readAt?.ok
    ? ((readAt.value as { payload: Record<string, unknown> }).payload.verification as Record<string, unknown>)
    : undefined;
  return { rt, result, value, rows, boundStateId, readiness: verification?.readiness, s0: rt.state.id };
}

const proofsOf = (rows: { kind: string; payload: Record<string, unknown> }[]) =>
  rows.filter((row) => row.kind === "PROOF").map((row) => row.payload);

describe("ACTIONABLE gains proof attachment without gaining privilege", () => {
  it("1. natural ACTIONABLE + valid trusted evidence: real summary, 5/5 satisfied, tier unchanged", async () => {
    const run = await runAtNaturalReadiness(PROCUREMENT_EVIDENCE, ["demo-procurement-offer"]);

    // The tier this path wrote is the tier it read. No promotion happened.
    expect(run.readiness).toBe("ACTIONABLE");
    // The evidence handoff ran: a successor exists and the workflow bound to it.
    expect(run.boundStateId).toContain("-semantic-");
    expect(run.boundStateId).not.toBe(run.s0);

    const proofs = proofsOf(run.rows);
    expect(proofs).toHaveLength(5);
    for (const proof of proofs) {
      expect(proof.status).toBe("SATISFIED");
      expect(proof.method).toBe("authoritative-proof-handoff");
    }
    // Plan verification can proceed on the evidence-backed state.
    const planVerification = run.rows.find((row) => row.kind === "PLAN_VERIFICATION")?.payload;
    expect((planVerification?.verification as Record<string, unknown>)?.status).toBe("VERIFIED");
  });

  it("2. ACTIONABLE + no evidence: no summary, fail closed", async () => {
    const run = await runAtNaturalReadiness(PROCUREMENT_EVIDENCE, []);
    expect(run.value?.state).toBe("BLOCKED");
    expect(run.boundStateId).toBe(run.s0);
    for (const proof of proofsOf(run.rows)) {
      expect(proof.method).toBe("authoritative-proof-handoff-absent");
      expect(proof.status).toBe("UNKNOWN");
    }
  });

  it("3. ACTIONABLE + untrusted evidence: cannot satisfy proofs", async () => {
    const untrusted = [{
      ...PROCUREMENT_EVIDENCE[0]!,
      envelope: { ...PROCUREMENT_EVIDENCE[0]!.envelope, trustClass: TrustClass.UNTRUSTED_EXTERNAL },
    }];
    const run = await runAtNaturalReadiness(untrusted, ["demo-procurement-offer"]);
    expect(run.value?.state).toBe("BLOCKED");
    expect(run.boundStateId).toBe(run.s0);
    for (const proof of proofsOf(run.rows)) {
      expect(proof.status).not.toBe("SATISFIED");
    }
  });

  it("4. ACTIONABLE + incomplete trusted evidence: missing obligations stay unsatisfied", async () => {
    const partial = [{
      envelope: PROCUREMENT_EVIDENCE[0]!.envelope,
      claims: PROCUREMENT_EVIDENCE[0]!.claims.slice(0, 3),
    }];
    const run = await runAtNaturalReadiness(partial, ["demo-procurement-offer"]);
    expect(run.value?.state).toBe("BLOCKED");
    // coverage.allRequiredCovered is false, so nothing is superseded at all.
    expect(run.boundStateId).toBe(run.s0);
    for (const proof of proofsOf(run.rows)) {
      expect(proof.status).not.toBe("SATISFIED");
    }
  });

  it("5. ACTIONABLE + evidence that contradicts the constraints: fail closed", async () => {
    const wrong = [{
      envelope: PROCUREMENT_EVIDENCE[0]!.envelope,
      claims: PROCUREMENT_EVIDENCE[0]!.claims.map((claim) =>
        claim.concept === "quantity" ? { ...claim, value: 450 } : claim,
      ),
    }];
    const run = await runAtNaturalReadiness(wrong, ["demo-procurement-offer"]);
    expect(run.value?.state).toBe("BLOCKED");
    expect(run.boundStateId).toBe(run.s0);
  });

  it("6. re-running the handoff is idempotent and mints no second successor", async () => {
    const rt = await runtime({ omitProofSummary: true, demoEvidence: PROCUREMENT_EVIDENCE });
    const ids = ["demo-procurement-offer"];
    const first = await rt.coordinator.run({ ...request(), expectedIntentStateId: rt.state.id, evidenceIds: ids });
    expect(first.ok).toBe(false);
    const successorId = String(((first as { details: Record<string, unknown> }).details).intentStateId);

    const second = await rt.coordinator.run({ ...request(), expectedIntentStateId: successorId, evidenceIds: ids });
    expect(second.ok).toBe(true);
    const third = await rt.coordinator.run({ ...request(), expectedIntentStateId: successorId, evidenceIds: ids });
    expect(third.ok).toBe(true);

    // Same workflow, and the tip never advanced past the one successor.
    const secondId = second.ok ? (second.value as { workflowId: string }).workflowId : "b";
    const thirdId = third.ok ? (third.value as { workflowId: string }).workflowId : "c";
    expect(thirdId).toBe(secondId);
    const tip = await rt.owner.getTip("intent-e2e");
    expect(String((tip as { value?: { id?: string } }).value?.id ?? tip)).toBe(successorId);
  });
});

describe("existing tier behaviour is untouched", () => {
  it("8. PLANNABLE still promotes to ACTIONABLE through the same path", async () => {
    const rt = await runtime({
      omitProofSummary: true,
      demoEvidence: PROCUREMENT_EVIDENCE,
      verificationReadiness: "PLANNABLE",
    });
    let result = await rt.coordinator.run({
      ...request(), expectedIntentStateId: rt.state.id, evidenceIds: ["demo-procurement-offer"],
    });
    if (!result.ok && result.code === "INTENT_STATE_NOT_READY") {
      result = await rt.coordinator.run({
        ...request(),
        expectedIntentStateId: String((result.details as Record<string, unknown>).intentStateId),
        evidenceIds: ["demo-procurement-offer"],
      });
    }
    expect(result.ok).toBe(true);
    const workflowId = result.ok ? (result.value as { workflowId: string }).workflowId : "";
    const artifacts = await rt.owner.listWorkflowArtifacts(workflowId);
    const rows = artifacts.ok ? (artifacts.value as { kind: string; payload: Record<string, unknown> }[]) : [];
    const boundStateId = String(rows.find((row) => row.kind === "WORKFLOW")?.payload.intentStateId ?? "");
    const read = await rt.owner.getSemanticArtifact(`semantic-verification-${boundStateId}`);
    const verification = read.ok
      ? ((read.value as { payload: Record<string, unknown> }).payload.verification as Record<string, unknown>)
      : undefined;
    // Promotion semantics for PLANNABLE are unchanged.
    expect(verification?.readiness).toBe("ACTIONABLE");
  });
});

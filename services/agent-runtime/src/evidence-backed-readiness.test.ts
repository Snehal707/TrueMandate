import { describe, expect, it } from "vitest";
import { ok, err, ErrorCode, TrustClass, type Result } from "@truemandate/protocol";
import { request, runtime } from "./generic-workflow.e2e.test.js";

/**
 * The evidence-backed readiness handoff, as the generic lifecycle now calls it.
 *
 * These tests run with `omitProofSummary`, which removes the harness's synthesized
 * proof summary. Without it the harness reproduces the deployed behaviour exactly:
 * no proof summary exists, so no workflow can become eligible for Authority. That
 * is the baseline every case here is measured against.
 */

type ReadinessCall = {
  readonly packId: string;
  readonly intentId: string;
  readonly intentStateId: string;
  readonly expectedIntentStateHash?: string;
  readonly verifiedEvidenceIds: readonly string[];
  readonly verifiedClaimIds: readonly string[];
};

/** Records what the lifecycle hands to the readiness operation. */
function recordingReadiness(superseded = false) {
  const calls: ReadinessCall[] = [];
  return {
    calls,
    evaluate: async (raw: unknown): Promise<Result<unknown>> => {
      calls.push(raw as ReadinessCall);
      return ok({ superseded });
    },
  };
}

function envelopes(trustClass: string) {
  return {
    getEnvelope: async (id: string) => ok({ id, contentHash: "e".repeat(64), trustClass }),
    getClaim: async () => err(ErrorCode.VALIDATION_FAILED, "not used"),
    listClaimsForEnvelope: async (id: string) =>
      ok({ envelopeId: id, claims: [{ id: `claim-${id}`, evidenceId: id, concept: "quantity", value: 500, confidence: 1 }] }),
  };
}

describe("without a proof summary the lifecycle stays fail-closed", () => {
  it("blocks, and says the summary is absent rather than malformed", async () => {
    const rt = await runtime({ omitProofSummary: true });
    const result = await rt.coordinator.run({ ...request(), expectedIntentStateId: rt.state.id });

    expect(result.ok).toBe(true);
    const value = result.ok ? (result.value as { state: string }) : undefined;
    expect(value?.state).toBe("BLOCKED");

    const proofs = (await rt.owner.listWorkflowArtifacts((result.ok ? (result.value as { workflowId: string }).workflowId : "")));
    const rows = proofs.ok ? proofs.value.filter((row) => (row as { kind: string }).kind === "PROOF") : [];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const payload = (row as { payload: Record<string, unknown> }).payload;
      expect(payload.method).toBe("authoritative-proof-handoff-absent");
      expect(payload.status).toBe("UNKNOWN");
    }
  });
});

describe("the engine consumes evidence trust, it never confers it", () => {
  it("does not invoke readiness when no evidence is referenced", async () => {
    const readiness = recordingReadiness();
    const rt = await runtime({ omitProofSummary: true, preExecutionReadiness: readiness });
    await rt.coordinator.run({ ...request(), expectedIntentStateId: rt.state.id, evidenceIds: [] });
    expect(readiness.calls).toHaveLength(0);
  });

  it("drops UNTRUSTED_EXTERNAL evidence, so a submitter cannot promote its own readiness", async () => {
    const readiness = recordingReadiness();
    const rt = await runtime({
      omitProofSummary: true,
      preExecutionReadiness: readiness,
      evidence: envelopes(TrustClass.UNTRUSTED_EXTERNAL) as never,
    });
    const result = await rt.coordinator.run({ ...request(), expectedIntentStateId: rt.state.id });

    // Every referenced envelope is untrusted, so the handoff is never reached.
    expect(readiness.calls).toHaveLength(0);
    expect(result.ok && (result.value as { state: string }).state).toBe("BLOCKED");
  });

  it("hands already-elevated evidence and its claims to the readiness operation", async () => {
    const readiness = recordingReadiness();
    const rt = await runtime({
      omitProofSummary: true,
      preExecutionReadiness: readiness,
      evidence: envelopes(TrustClass.ELEVATED_EXTERNAL) as never,
    });
    await rt.coordinator.run({ ...request(), expectedIntentStateId: rt.state.id });

    expect(readiness.calls).toHaveLength(1);
    const call = readiness.calls[0]!;
    expect(call.packId).toBe("procurement");
    expect(call.intentId).toBe("intent-e2e");
    // Bound to the state the caller's submission resolved to, with its hash.
    expect(call.intentStateId).toBeTruthy();
    expect(call.expectedIntentStateHash).toBeTruthy();
    expect(call.verifiedEvidenceIds).toContain("food-evidence");
    expect(call.verifiedClaimIds).toContain("claim-food-evidence");
  });
});

describe("state binding is decided before workflow identity", () => {
  it("keeps the caller's state when readiness does not supersede", async () => {
    const readiness = recordingReadiness(false);
    const rt = await runtime({
      omitProofSummary: true,
      preExecutionReadiness: readiness,
      evidence: envelopes(TrustClass.ELEVATED_EXTERNAL) as never,
    });
    const result = await rt.coordinator.run({ ...request(), expectedIntentStateId: rt.state.id });
    expect(result.ok).toBe(true);

    const boundStateId = readiness.calls[0]!.intentStateId;
    const workflowId = result.ok ? (result.value as { workflowId: string }).workflowId : "";
    const artifacts = await rt.owner.listWorkflowArtifacts(workflowId);
    const rows = artifacts.ok ? artifacts.value : [];
    // Every artifact binds the one state the workflow was derived from. A split
    // between workflow-bound-S0 and planning-bound-S1 would show up here first.
    for (const row of rows) {
      const payload = (row as { payload: Record<string, unknown> }).payload;
      if (typeof payload.intentStateId === "string") {
        expect(payload.intentStateId).toBe(boundStateId);
      }
    }
  });

  it("is idempotent: a repeated submission reuses the workflow rather than superseding again", async () => {
    const readiness = recordingReadiness(false);
    const rt = await runtime({
      omitProofSummary: true,
      preExecutionReadiness: readiness,
      evidence: envelopes(TrustClass.ELEVATED_EXTERNAL) as never,
    });
    const first = await rt.coordinator.run({ ...request(), expectedIntentStateId: rt.state.id });
    const second = await rt.coordinator.run({ ...request(), expectedIntentStateId: rt.state.id });

    expect(first.ok && second.ok).toBe(true);
    const firstId = first.ok ? (first.value as { workflowId: string }).workflowId : "a";
    const secondId = second.ok ? (second.value as { workflowId: string }).workflowId : "b";
    expect(secondId).toBe(firstId);
  });
});

describe("the lifecycle is unchanged when the handoff is not wired", () => {
  it("behaves exactly as before when no readiness operation is supplied", async () => {
    const withoutPort = await runtime({ omitProofSummary: true });
    const withPortNoEvidence = await runtime({
      omitProofSummary: true,
      preExecutionReadiness: recordingReadiness(),
    });
    const a = await withoutPort.coordinator.run({ ...request(), expectedIntentStateId: withoutPort.state.id, evidenceIds: [] });
    const b = await withPortNoEvidence.coordinator.run({ ...request(), expectedIntentStateId: withPortNoEvidence.state.id, evidenceIds: [] });

    expect(a.ok).toBe(b.ok);
    expect(a.ok && (a.value as { state: string }).state).toBe(
      b.ok ? (b.value as { state: string }).state : undefined,
    );
  });
});

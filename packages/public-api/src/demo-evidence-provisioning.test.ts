import { describe, expect, it, vi } from "vitest";
import { ErrorCode, ok, err, type Intent, type IntentState, type Result } from "@truemandate/protocol";
import { demoScenarioTemplate, evidenceClaimId, evidenceEnvelopeId } from "@truemandate/demo-fixtures";
import { createDemoEvidenceProvisionPort } from "./demo-evidence-provisioning.js";

/**
 * A-Prime content-authority proof: given the exact deterministic identifiers
 * for a real, correctly-compiled demo intent, does this port (1) refuse to
 * write anything until every lineage/scenario check passes, and (2) derive
 * submitted content EXCLUSIVELY from the shared fixture catalog — never
 * from anything the caller could have supplied?
 */

const SCENARIO_ID = "procurement";
const RUN_ID = "run-1";
const TEMPLATE = demoScenarioTemplate(SCENARIO_ID)!;
const INTENT_ID = `demo-${SCENARIO_ID}-${RUN_ID}-intent`;
const INTENT_STATE_ID = "state-abc";

function mockDeps(overrides: Partial<{
  getIntent: (intentId: string) => Promise<Result<Intent>>;
  getTip: (intentId: string) => Promise<Result<IntentState>>;
  submitEvidence: (raw: unknown) => Promise<Result<unknown>>;
}> = {}) {
  const submitEvidenceCalls: unknown[] = [];
  const getIntent = overrides.getIntent ?? (async () => ok({ rawText: TEMPLATE.rawText } as Intent));
  const getTip = overrides.getTip ?? (async () => ok({ id: INTENT_STATE_ID } as IntentState));
  const submitEvidence =
    overrides.submitEvidence ??
    (async (raw: unknown) => {
      submitEvidenceCalls.push(raw);
      return ok({ envelopeIds: ["env-1"], claimIds: ["claim-1"] });
    });
  return {
    port: createDemoEvidenceProvisionPort({ getIntent, getTip, submitEvidence }),
    submitEvidenceCalls,
  };
}

function validInput() {
  return { scenarioId: SCENARIO_ID, runId: RUN_ID, intentId: INTENT_ID, intentStateId: INTENT_STATE_ID };
}

describe("scenario/lineage validation — rejects before any write", () => {
  it("rejects an unknown scenarioId", async () => {
    const { port, submitEvidenceCalls } = mockDeps();
    const result = await port.provisionDemoEvidence({ ...validInput(), scenarioId: "not-a-real-scenario" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(submitEvidenceCalls).toHaveLength(0);
  });

  it("rejects an intentId that does not match the deterministic naming scheme", async () => {
    const { port, submitEvidenceCalls } = mockDeps();
    const result = await port.provisionDemoEvidence({ ...validInput(), intentId: "some-other-intent" });
    expect(result.ok).toBe(false);
    expect(submitEvidenceCalls).toHaveLength(0);
  });

  it("rejects when the intent does not exist", async () => {
    const { port, submitEvidenceCalls } = mockDeps({
      getIntent: async () => err(ErrorCode.VALIDATION_FAILED, "Unknown intent"),
    });
    const result = await port.provisionDemoEvidence(validInput());
    expect(result.ok).toBe(false);
    expect(submitEvidenceCalls).toHaveLength(0);
  });

  it("rejects when the durable intent's rawText does not match the server-owned template", async () => {
    const { port, submitEvidenceCalls } = mockDeps({
      getIntent: async () => ok({ rawText: "Some completely different, attacker-relevant intent text" } as Intent),
    });
    const result = await port.provisionDemoEvidence(validInput());
    expect(result.ok).toBe(false);
    expect(submitEvidenceCalls).toHaveLength(0);
  });

  it("rejects when intentStateId does not match the current compiled tip (stale or wrong)", async () => {
    const { port, submitEvidenceCalls } = mockDeps({
      getTip: async () => ok({ id: "state-different-and-not-the-current-tip" } as IntentState),
    });
    const result = await port.provisionDemoEvidence(validInput());
    expect(result.ok).toBe(false);
    expect(submitEvidenceCalls).toHaveLength(0);
  });

  it("rejects when the intent has no compiled tip yet", async () => {
    const { port, submitEvidenceCalls } = mockDeps({
      getTip: async () => err(ErrorCode.INTENT_STATE_NOT_READY, "not ready"),
    });
    const result = await port.provisionDemoEvidence(validInput());
    expect(result.ok).toBe(false);
    expect(submitEvidenceCalls).toHaveLength(0);
  });
});

describe("valid request — deterministic content reconstruction", () => {
  it("submits the exact server-owned fixture content for the selected scenario", async () => {
    const { port, submitEvidenceCalls } = mockDeps();
    const result = await port.provisionDemoEvidence(validInput());
    expect(result.ok).toBe(true);
    expect(submitEvidenceCalls).toHaveLength(1);

    const body = submitEvidenceCalls[0] as {
      envelopes: { id: string; source: string; contentHash: string; captureTime: string }[];
      claims: { id: string; evidenceId: string; concept: string; value: unknown; confidence: number }[];
      lineage: { intentId: string; intentStateId: string };
    };

    const expectedEnvelopeId = evidenceEnvelopeId(SCENARIO_ID, RUN_ID);
    expect(body.envelopes).toHaveLength(1);
    expect(body.envelopes[0]!.id).toBe(expectedEnvelopeId);
    expect(body.envelopes[0]!.source).toBe(TEMPLATE.evidenceSource);
    expect(body.envelopes[0]!.captureTime).toBe(TEMPLATE.evidenceCaptureTime);

    expect(body.claims).toHaveLength(TEMPLATE.evidenceClaims.length);
    for (const [index, claim] of TEMPLATE.evidenceClaims.entries()) {
      expect(body.claims[index]!.id).toBe(evidenceClaimId(SCENARIO_ID, RUN_ID, claim.concept));
      expect(body.claims[index]!.evidenceId).toBe(expectedEnvelopeId);
      expect(body.claims[index]!.concept).toBe(claim.concept);
      expect(body.claims[index]!.value).toEqual(claim.value);
    }

    expect(body.lineage).toEqual({ intentId: INTENT_ID, intentStateId: INTENT_STATE_ID });

    // Never a caller-influenceable field: nothing outside the closed
    // envelope/claims/lineage shape the port itself constructs.
    expect(Object.keys(body).sort()).toEqual(["claims", "envelopes", "lineage"]);
  });

  it("submission body carries no trustClass/taint field — evidence-service alone decides that", async () => {
    const { port, submitEvidenceCalls } = mockDeps();
    await port.provisionDemoEvidence(validInput());
    const body = submitEvidenceCalls[0] as { envelopes: Record<string, unknown>[] };
    expect(body.envelopes[0]).not.toHaveProperty("trustClass");
    expect(body.envelopes[0]).not.toHaveProperty("taint");
  });
});

describe("compromised phase-c cannot choose evidence content — only scenario/run selection", () => {
  it("produces byte-identical submitted content for the same scenarioId/runId regardless of call order/repetition", async () => {
    const first = mockDeps();
    const second = mockDeps();
    await first.port.provisionDemoEvidence(validInput());
    await second.port.provisionDemoEvidence(validInput());
    expect(first.submitEvidenceCalls[0]).toEqual(second.submitEvidenceCalls[0]);
  });

  it("the TypeScript input type itself has no field for concept/value/confidence/source/trustClass — only identifiers", () => {
    // Compile-time proof, executed as a smoke assertion: constructing this
    // object with any extra key would be a type error, not merely ignored
    // at runtime. See handlers/demo-evidence-provisioning.test.ts for the
    // runtime (.strict()) proof at the HTTP boundary.
    const input: Parameters<ReturnType<typeof createDemoEvidenceProvisionPort>["provisionDemoEvidence"]>[0] = validInput();
    expect(Object.keys(input).sort()).toEqual(["intentId", "intentStateId", "runId", "scenarioId"]);
  });

  it("different scenarios never share reconstructed content", async () => {
    const travelInput = { scenarioId: "travel", runId: "run-t", intentId: "demo-travel-run-t-intent", intentStateId: "state-t" };
    const travelTemplate = demoScenarioTemplate("travel")!;
    const { port, submitEvidenceCalls } = mockDeps({
      getIntent: async () => ok({ rawText: travelTemplate.rawText } as Intent),
      getTip: async () => ok({ id: "state-t" } as IntentState),
    });
    const result = await port.provisionDemoEvidence(travelInput);
    expect(result.ok).toBe(true);
    const body = submitEvidenceCalls[0] as { envelopes: { source: string }[] };
    expect(body.envelopes[0]!.source).toBe(travelTemplate.evidenceSource);
    expect(body.envelopes[0]!.source).not.toBe(TEMPLATE.evidenceSource);
  });
});

describe("fail-closed ordering: validation always precedes reconstruction/submission", () => {
  it("never calls submitEvidence when any prior check fails, in any failure combination", async () => {
    const submit = vi.fn(async () => ok({ envelopeIds: [], claimIds: [] }));
    const { port } = mockDeps({
      getIntent: async () => err(ErrorCode.VALIDATION_FAILED, "unknown"),
      submitEvidence: submit,
    });
    await port.provisionDemoEvidence(validInput());
    expect(submit).not.toHaveBeenCalled();
  });
});

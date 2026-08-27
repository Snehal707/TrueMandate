import { describe, expect, it } from "vitest";
import { TrustClass } from "@truemandate/protocol";
import { request, runtime } from "./generic-workflow.e2e.test.js";

/**
 * Attack Lab causality: the same evidenced base request, run twice.
 *
 * The control must genuinely progress — otherwise "TrueMandate blocked the
 * attack" is unfalsifiable, because a control that cannot reach Authority is
 * blocked for a reason unrelated to the attack. Only once the control succeeds
 * does the mutation's divergence mean anything.
 *
 * The divergence stage is read from durable artifacts, never assumed to be
 * Guardian.
 */

const EXPIRY = "2026-12-31T17:00:00.000Z";
const EVIDENCE_ID = "attack-control-offer";

/** Attests the CONTROL facts: 500 units, food grade, approved supplier, in budget. */
const CONTROL_EVIDENCE = [
  {
    envelope: {
      id: EVIDENCE_ID,
      source: "deterministic-demo-fixture:attack-control",
      contentHash: "c".repeat(64),
      captureTime: "2026-06-01T00:00:00.000Z",
      mimeType: "application/json",
      trustClass: TrustClass.ELEVATED_EXTERNAL,
      taint: { classes: ["EXTERNAL_CONTENT"], origins: ["verified-by:demo-fixture-writer"] },
    },
    claims: [
      { id: `${EVIDENCE_ID}-quantity`, evidenceId: EVIDENCE_ID, concept: "quantity", value: 500, confidence: 1 },
      { id: `${EVIDENCE_ID}-material`, evidenceId: EVIDENCE_ID, concept: "food_grade", value: true, confidence: 1 },
      { id: `${EVIDENCE_ID}-budget`, evidenceId: EVIDENCE_ID, concept: "budget", value: 742000, confidence: 1 },
      { id: `${EVIDENCE_ID}-supplier`, evidenceId: EVIDENCE_ID, concept: "approved_supplier", value: true, confidence: 1 },
      { id: `${EVIDENCE_ID}-deadline`, evidenceId: EVIDENCE_ID, concept: "execution_deadline", value: EXPIRY, confidence: 1 },
    ],
  },
];

type Row = { kind: string; payload: Record<string, unknown> };

async function submit(overrides: Record<string, unknown>) {
  const rt = await runtime({ omitProofSummary: true, demoEvidence: CONTROL_EVIDENCE });
  const base = { ...request(), evidenceIds: [EVIDENCE_ID], ...overrides };
  let result = await rt.coordinator.run({ ...base, expectedIntentStateId: rt.state.id });
  if (!result.ok && result.code === "INTENT_STATE_NOT_READY") {
    result = await rt.coordinator.run({
      ...base,
      expectedIntentStateId: String((result.details as Record<string, unknown>).intentStateId),
    });
  }
  const value = result.ok ? (result.value as { state: string; workflowId: string; authorization?: { commitToken?: { id: string } } }) : undefined;
  const artifacts = value ? await rt.owner.listWorkflowArtifacts(value.workflowId) : undefined;
  const rows: Row[] = artifacts?.ok ? (artifacts.value as Row[]) : [];
  return { rt, result, value, rows };
}

/** The first stage whose durable artifact shows the run stopped there. */
function firstDivergence(rows: Row[], value: { state: string } | undefined): string {
  const proofs = rows.filter((row) => row.kind === "PROOF").map((row) => row.payload);
  if (proofs.length === 0) return "no proofs evaluated";
  if (proofs.some((proof) => proof.status !== "SATISFIED")) return "proof obligations";
  const planVerification = rows.find((row) => row.kind === "PLAN_VERIFICATION")?.payload;
  if ((planVerification?.verification as Record<string, unknown>)?.status !== "VERIFIED") return "plan verification";
  const fidelity = rows.find((row) => row.kind === "ACTION")?.payload
    .deterministicActionFidelity as { preservesIntent?: boolean } | undefined;
  if (fidelity && fidelity.preservesIntent === false) return "action fidelity";
  const guardian = rows.find((row) => row.kind === "GUARDIAN")?.payload;
  const decision = (guardian?.verdict as Record<string, unknown>)?.decision;
  if (decision === "BLOCK") return "Guardian";
  if (value?.state !== "AUTHORIZED") return "authority eligibility";
  return "none — reached Authority";
}

describe("attack causality: an evidenced control versus the same request mutated", () => {
  it("control reaches Authority, and the quantity mutation diverges at action fidelity", async () => {
    const control = await submit({});
    const attack = await submit({ quantity: 450 });

    const controlStage = firstDivergence(control.rows, control.value);
    const attackStage = firstDivergence(attack.rows, attack.value);
    // eslint-disable-next-line no-console
    console.log(`ATTACK control=${control.value?.state} (${controlStage}) | attack=${attack.value?.state} (${attackStage})`);

    // The control must genuinely succeed, or the comparison proves nothing.
    expect(control.value?.state).toBe("AUTHORIZED");
    expect(controlStage).toBe("none — reached Authority");

    // The mutation must not obtain privilege.
    expect(attack.value?.state).toBe("BLOCKED");
    expect(attackStage).not.toBe("none — reached Authority");

    // The divergence is caused by the mutation, not by missing proofs: the
    // evidence still applies to the INTENT, so proofs still pass. What fails is
    // that the proposed action no longer matches what the human asked for.
    const attackProofs = attack.rows.filter((row) => row.kind === "PROOF").map((row) => row.payload);
    for (const proof of attackProofs) expect(proof.status).toBe("SATISFIED");
    expect(attackStage).toBe("action fidelity");

    // Guardian is not the divergence point, and is not blamed for it.
    const attackGuardian = attack.rows.find((row) => row.kind === "GUARDIAN")?.payload;
    expect((attackGuardian?.verdict as Record<string, unknown>)?.decision).not.toBe("BLOCK");
  });

  it("the mutated request never reaches Authority, execution, or a CommitToken", async () => {
    const attack = await submit({ quantity: 450 });
    expect(attack.rt.calls).toMatchObject({ evaluation: 0, prepare: 0, mint: 0, authorize: 0, commit: 0, paymentAdapter: 0 });
    expect(attack.value?.authorization).toBeUndefined();
    // No economic effect of any kind.
    expect(await attack.rt.gateway.getSideEffectLedger().listAll()).toHaveLength(0);
  });

  it("a mutated request cannot ride the control's authorization: it never shares a workflow", async () => {
    const control = await submit({});
    const attack = await submit({ quantity: 450 });
    // workflowId is derived from the bound state hash AND the request content, so
    // the mutation cannot land on the control's workflow and inherit its grant.
    expect(attack.value?.workflowId).not.toBe(control.value?.workflowId);
  });
});

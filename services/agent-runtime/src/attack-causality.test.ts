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

  /**
   * Which layer the mutation actually lives at. If the human's recorded mandate
   * had changed to 450 this would be a different scenario entirely — the action
   * would faithfully represent a (different) intent, and action fidelity would
   * have nothing to catch.
   */
  it("the human mandate stays 500; only the proposed action is mutated", async () => {
    const control = await submit({});
    const attack = await submit({ quantity: 450 });

    const quantityConstraint = (rows: Row[], rt: { state: { constraints: readonly { id: string; concept: string; value: unknown }[] } }) => {
      void rows;
      return rt.state.constraints.find((constraint) => constraint.concept === "quantity")?.value;
    };
    const actionQuantity = (rows: Row[]) =>
      ((rows.find((row) => row.kind === "ACTION")?.payload.action) as { quantity?: unknown } | undefined)?.quantity;

    const humanControl = quantityConstraint(control.rows, control.rt as never);
    const humanAttack = quantityConstraint(attack.rows, attack.rt as never);
    const evidenceQuantity = CONTROL_EVIDENCE[0]!.claims.find((claim) => claim.concept === "quantity")!.value;

    // eslint-disable-next-line no-console
    console.log(`LAYERS human(control)=${humanControl} human(attack)=${humanAttack} evidence=${evidenceQuantity} action(control)=${actionQuantity(control.rows)} action(attack)=${actionQuantity(attack.rows)}`);

    // The recorded human mandate is 500 on BOTH runs — the attack did not rewrite it.
    expect(humanControl).toBe(500);
    expect(humanAttack).toBe(500);
    // Evidence attests the mandate, not the action.
    expect(evidenceQuantity).toBe(500);
    // The divergence is entirely at the proposed-action layer.
    expect(actionQuantity(control.rows)).toBe(500);
    expect(actionQuantity(attack.rows)).toBe(450);
  });
});

/**
 * Token isolation. The control's CommitToken authorizes one exact PreparedAction.
 * Presenting it alongside a mutated action must be rejected by the existing
 * binding/integrity machinery — no new policy is introduced here.
 */
describe("a control's CommitToken cannot authorize a mutated action", () => {
  it("rejects the tampered pairing, executes nothing, and leaves the ledger untouched", async () => {
    const control = await submit({});
    expect(control.value?.state).toBe("AUTHORIZED");

    const authorization = (control.result.ok ? control.result.value : {}) as {
      authorization?: { commitToken?: { id: string }; grant?: { id: string; preparedActionId: string } };
    };
    const tokenId = authorization.authorization!.commitToken!.id;
    const grantId = authorization.authorization!.grant!.id;
    const preparedActionId = authorization.authorization!.grant!.preparedActionId;

    const storedToken = await control.rt.gateway.getCommitTokenStore().get(tokenId);
    const storedPrepared = await control.rt.gateway.getPreparedActionStore().get(preparedActionId);
    expect(storedToken.ok && storedPrepared.ok).toBe(true);
    const commitToken = (storedToken as { value: Record<string, unknown> }).value;
    const prepared = (storedPrepared as { value: Record<string, unknown> }).value;

    const ledgerBefore = (await control.rt.gateway.getSideEffectLedger().listAll()).length;

    // Same token, action mutated after authorization.
    const tampered = {
      ...prepared,
      action: { ...(prepared.action as Record<string, unknown>), quantity: 450 },
    };
    const attempted = await control.rt.gateway.commit({
      preparedAction: tampered as never,
      grantId,
      commitToken: commitToken as never,
      agentId: "attacker",
      actionNodeId: `action-${preparedActionId}`,
      authorityNodeId: `authority-${grantId}`,
    });

    // eslint-disable-next-line no-console
    console.log(`TOKEN-ISOLATION rejected=${!attempted.ok} code=${attempted.ok ? "(accepted)" : attempted.code}`);

    expect(attempted.ok).toBe(false);
    expect(await control.rt.gateway.getSideEffectLedger().listAll()).toHaveLength(ledgerBefore);
  });
});

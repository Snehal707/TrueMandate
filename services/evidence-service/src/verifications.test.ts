import { describe, expect, it } from "vitest";
import type { EvidenceClaim, EvidenceEnvelope, Intent, IntentState, OutcomeContract } from "@truemandate/protocol";
import { verifyEvidenceSubmission } from "./verifications.js";

const intent: Intent = {
  id: "intent-1" as Intent["id"],
  principalId: "principal-1" as Intent["principalId"],
  rawText: "book travel",
  createdAt: "2026-08-22T10:00:00.000Z",
  contentHash: "a".repeat(64) as Intent["contentHash"],
};

const state: IntentState = {
  id: "state-1" as IntentState["id"],
  intentId: intent.id,
  rawIntentHash: intent.contentHash,
  version: 1,
  constraints: [],
  assumptions: [],
  createdAt: "2026-08-22T10:01:00.000Z",
  createdBy: intent.principalId as IntentState["createdBy"],
  stateHash: "b".repeat(64) as IntentState["stateHash"],
};

const envelope: EvidenceEnvelope = {
  id: "ev-1" as EvidenceEnvelope["id"],
  source: "merchant-portal",
  contentHash: "c".repeat(64) as EvidenceEnvelope["contentHash"],
  trustClass: "UNTRUSTED_EXTERNAL",
  captureTime: "2026-08-22T10:02:00.000Z",
  taint: { classes: ["EXTERNAL_CONTENT"], origins: ["merchant-portal"] },
};

const claim: EvidenceClaim = {
  id: "claim-1" as EvidenceClaim["id"],
  evidenceId: envelope.id,
  concept: "stay_date",
  value: "2026-12-20T00:00:00.000Z",
  confidence: 1,
  derivedBy: "public-evidence-submission",
  taint: { classes: ["EXTERNAL_CONTENT"], origins: [envelope.id] },
};

const outcome: OutcomeContract = {
  id: "outcome-1" as OutcomeContract["id"],
  intentId: intent.id,
  intentStateId: state.id,
  requirements: [],
  state: "CREATED",
  paymentStatus: "PENDING",
  createdAt: "2026-08-22T10:02:00.000Z",
  updatedAt: "2026-08-22T10:02:00.000Z",
};

describe("verifyEvidenceSubmission", () => {
  it("creates derivative elevated evidence rows while preserving the original submission", async () => {
    const result = await verifyEvidenceSubmission(
      {
        verificationId: "verify-1",
        envelopeId: envelope.id,
        claimIds: [claim.id],
        lineage: { intentId: intent.id, intentStateId: state.id },
      },
      "phase-c@test.iam.gserviceaccount.com",
      {
        getIntent: async () => ({ ok: true, value: intent }),
        getIntentState: async () => ({ ok: true, value: state }),
        listWorkflowArtifacts: async () => ({ ok: true, value: [] }),
        getOutcomeContract: async () => ({ ok: true, value: outcome }),
        getEnvelope: async () => envelope,
        getClaim: async () => claim,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.envelope).toMatchObject({
      id: "ev-1-verified-verify-1",
      trustClass: "ELEVATED_EXTERNAL",
    });
    expect(result.value.claims[0]).toMatchObject({
      id: "claim-1-verified-verify-1",
      evidenceId: "ev-1-verified-verify-1",
      derivedBy: "verified-evidence:verify-1",
    });
    expect(envelope.trustClass).toBe("UNTRUSTED_EXTERNAL");
  });

  it("fails closed when attempting to verify already elevated evidence", async () => {
    const result = await verifyEvidenceSubmission(
      {
        verificationId: "verify-1",
        envelopeId: envelope.id,
      },
      "phase-c@test.iam.gserviceaccount.com",
      {
        getIntent: async () => ({ ok: true, value: intent }),
        getIntentState: async () => ({ ok: true, value: state }),
        listWorkflowArtifacts: async () => ({ ok: true, value: [] }),
        getOutcomeContract: async () => ({ ok: true, value: outcome }),
        getEnvelope: async () => ({ ...envelope, trustClass: "ELEVATED_EXTERNAL" as const }),
        getClaim: async () => claim,
      },
    );

    expect(result.ok).toBe(false);
  });
});

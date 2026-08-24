import { proofObligationId } from "@truemandate/crypto";
import { describe, expect, it } from "vitest";
import type { Intent, IntentState, OutcomeContract } from "@truemandate/protocol";
import {
  normalizeEvidenceSubmission,
  validateEvidenceSubmissionLineage,
  type EvidenceSubmissionLineageDeps,
} from "./submissions.js";

const intent: Intent = {
  id: "intent-1" as Intent["id"],
  principalId: "principal-1" as Intent["principalId"],
  rawText: "buy goods",
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

const obligation = {
  verificationStep: "verify_receipt",
  requiredEvidence: "warehouse_receipt",
  enforcingService: "outcome-resolution",
  constraintId: "constraint-1",
};
const obligationId = proofObligationId(obligation);

const workflowRows = [
  {
    id: "plan-wf-1",
    intentId: intent.id,
    workflowId: "wf-1",
    kind: "PLAN",
    payload: { proofObligations: [obligation] },
  },
  {
    id: "action-wf-1",
    intentId: intent.id,
    workflowId: "wf-1",
    kind: "ACTION",
    payload: { requiredProofObligationIds: [obligationId] },
  },
  {
    id: "workflow-wf-1",
    intentId: intent.id,
    workflowId: "wf-1",
    kind: "WORKFLOW",
    payload: { intentStateId: state.id, packId: "procurement" },
  },
];

const outcome: OutcomeContract = {
  id: "outcome-1" as OutcomeContract["id"],
  intentId: intent.id,
  intentStateId: state.id,
  requirements: [],
  state: "CREATED",
  paymentStatus: "PENDING",
  createdAt: "2026-08-22T10:02:00.000Z",
  updatedAt: "2026-08-22T10:02:00.000Z",
  preExecutionBinding: {
    workflowId: "wf-1",
    workflowHash: "c".repeat(64),
    actionId: "action-wf-1",
    actionHash: "d".repeat(64),
    evaluationId: "eval-1",
    evaluationHash: "e".repeat(64),
    evaluatedIntentStateId: state.id,
    evaluatedIntentStateHash: state.stateHash,
    evaluatedIntentStateVersion: state.version,
  },
};

function deps(overrides: Partial<EvidenceSubmissionLineageDeps> = {}): EvidenceSubmissionLineageDeps {
  return {
    getIntent: async () => ({ ok: true, value: intent }),
    getIntentState: async () => ({ ok: true, value: state }),
    listWorkflowArtifacts: async () => ({ ok: true, value: workflowRows }),
    getOutcomeContract: async () => ({ ok: true, value: outcome }),
    ...overrides,
  };
}

describe("evidence submission lineage validation", () => {
  it("accepts matching workflow, intent, intent state, outcome, and proof obligations", async () => {
    const result = await validateEvidenceSubmissionLineage(
      {
        envelopes: [{
          id: "ev-1",
          source: "merchant-portal",
          contentHash: "hash-1",
          captureTime: "2026-08-22T10:03:00.000Z",
        }],
        claims: [],
        lineage: {
          workflowId: "wf-1",
          intentId: intent.id,
          intentStateId: state.id,
          outcomeContractId: outcome.id,
          proofObligationIds: [obligationId],
        },
      },
      deps(),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        workflowId: "wf-1",
        intentId: intent.id,
        intentStateId: state.id,
        outcomeContractId: outcome.id,
        proofObligationIds: [obligationId],
      },
    });
  });

  it("accepts owner-read outcome contracts enriched with safe workflow metadata", async () => {
    const result = await validateEvidenceSubmissionLineage(
      {
        envelopes: [{
          id: "ev-1",
          source: "merchant-portal",
          contentHash: "hash-1",
          captureTime: "2026-08-22T10:03:00.000Z",
        }],
        claims: [],
        lineage: {
          workflowId: "wf-1",
          intentId: intent.id,
          intentStateId: state.id,
          outcomeContractId: outcome.id,
          proofObligationIds: [obligationId],
        },
      },
      deps({
        getOutcomeContract: async () => ({
          ok: true,
          value: {
            ...outcome,
            workflowId: "wf-1",
            domain: "travel",
          },
        }),
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        workflowId: "wf-1",
        intentId: intent.id,
        intentStateId: state.id,
        outcomeContractId: outcome.id,
        proofObligationIds: [obligationId],
      },
    });
  });

  it("rejects foreign lineage mismatches fail closed", async () => {
    const result = await validateEvidenceSubmissionLineage(
      {
        envelopes: [{
          id: "ev-1",
          source: "merchant-portal",
          contentHash: "hash-1",
          captureTime: "2026-08-22T10:03:00.000Z",
        }],
        claims: [],
        lineage: {
          workflowId: "wf-1",
          intentId: "intent-foreign",
        },
      },
      deps(),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects proof obligation lineage without a bound workflow", async () => {
    const result = await validateEvidenceSubmissionLineage(
      {
        envelopes: [{
          id: "ev-1",
          source: "merchant-portal",
          contentHash: "hash-1",
          captureTime: "2026-08-22T10:03:00.000Z",
        }],
        claims: [],
        lineage: {
          proofObligationIds: [obligationId],
        },
      },
      deps(),
    );
    expect(result.ok).toBe(false);
  });
});

describe("evidence submission normalization", () => {
  it("stamps server-owned trust and taint metadata without verifying evidence", () => {
    const normalized = normalizeEvidenceSubmission(
      {
        envelopes: [{
          id: "ev-1",
          source: "merchant-portal",
          contentHash: "hash-1",
          captureTime: "2026-08-22T10:03:00.000Z",
          originId: "merchant-object-1",
        }],
        claims: [{
          id: "claim-1",
          evidenceId: "ev-1",
          concept: "merchant",
          value: "supplier-a",
          confidence: 0.9,
        }],
        lineage: {
          workflowId: "wf-1",
          intentId: intent.id,
          proofObligationIds: [obligationId],
        },
      },
      "tm-dev-public-bff@test.iam.gserviceaccount.com",
      {
        workflowId: "wf-1",
        intentId: intent.id,
        proofObligationIds: [obligationId],
      },
    );

    expect(normalized.envelopes[0]).toMatchObject({
      trustClass: "UNTRUSTED_EXTERNAL",
      taint: {
        classes: ["EXTERNAL_CONTENT"],
      },
      originId: "merchant-object-1",
    });
    expect(normalized.envelopes[0]?.taint.origins).toContain(
      "caller:tm-dev-public-bff@test.iam.gserviceaccount.com",
    );
    expect(normalized.envelopes[0]?.taint.origins).toContain("source:merchant-portal");
    expect(normalized.envelopes[0]?.taint.origins).toContain("wf-1");
    expect(normalized.claims[0]).toMatchObject({
      derivedBy: "public-evidence-submission",
      taint: { classes: ["EXTERNAL_CONTENT"] },
    });
  });
});

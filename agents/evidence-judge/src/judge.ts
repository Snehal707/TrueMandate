import { invokeJudge } from "@truemandate/guardian-core";
import type { ModelPort } from "@truemandate/model";
import {
  JudgeId,
  type ActionProposal,
  type EvidenceClaim,
  type EvidenceEnvelope,
  type JudgeResult,
} from "@truemandate/protocol";
import {
  EVIDENCE_PROMPT_VERSION,
  EVIDENCE_SCHEMA_ID,
  EVIDENCE_SCHEMA_VERSION,
  EVIDENCE_SYSTEM_INSTRUCTION,
} from "./prompts/v1.js";

export interface EvidenceJudgeInput {
  readonly action: ActionProposal;
  readonly evidenceEnvelopes: readonly EvidenceEnvelope[];
  readonly evidenceClaims: readonly EvidenceClaim[];
  readonly claimedFacts?: Readonly<Record<string, unknown>>;
}

export interface EvidenceJudgeDeps {
  readonly model: ModelPort;
  readonly modelId?: string;
  readonly requestId?: string;
}

export async function runEvidenceJudge(
  input: EvidenceJudgeInput,
  deps: EvidenceJudgeDeps,
): Promise<JudgeResult> {
  return invokeJudge({
    judgeId: JudgeId.EVIDENCE,
    model: deps.model,
    modelId: deps.modelId ?? "evidence-judge",
    promptVersion: EVIDENCE_PROMPT_VERSION,
    schemaId: EVIDENCE_SCHEMA_ID,
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    systemInstruction: EVIDENCE_SYSTEM_INSTRUCTION,
    userPayload: {
      action: input.action,
      claimedFacts: input.claimedFacts ?? {
        product: input.action.product,
        merchant: input.action.merchant,
        amount: input.action.amount,
        currency: input.action.currency,
        quantity: input.action.quantity,
        parameters: input.action.parameters,
      },
      evidenceEnvelopes: input.evidenceEnvelopes.map((e) => ({
        id: e.id,
        trustClass: e.trustClass,
        taint: e.taint,
        contentHash: e.contentHash,
        captureTime: e.captureTime,
        eventTime: e.eventTime,
        freshnessDeadline: e.freshnessDeadline,
        // trustClass is read-only; model must not upgrade it
      })),
      evidenceClaims: input.evidenceClaims,
    },
    requestId: deps.requestId ?? `evidence-${input.action.id}`,
  });
}

import { invokeJudge } from "@truemandate/guardian-core";
import type { ModelPort } from "@truemandate/model";
import {
  JudgeId,
  type ActionProposal,
  type Constraint,
  type EvidenceClaim,
  type EvidenceEnvelope,
  type JudgeResult,
} from "@truemandate/protocol";
import {
  CONTRADICTION_PROMPT_VERSION,
  CONTRADICTION_SCHEMA_ID,
  CONTRADICTION_SCHEMA_VERSION,
  CONTRADICTION_SYSTEM_INSTRUCTION,
} from "./prompts/v1.js";

export interface ContradictionJudgeInput {
  readonly constraints: readonly Constraint[];
  readonly action: ActionProposal;
  readonly evidenceClaims: readonly EvidenceClaim[];
  readonly evidenceEnvelopes: readonly EvidenceEnvelope[];
}

export interface ContradictionJudgeDeps {
  readonly model: ModelPort;
  readonly modelId?: string;
  readonly requestId?: string;
}

export async function runContradictionJudge(
  input: ContradictionJudgeInput,
  deps: ContradictionJudgeDeps,
): Promise<JudgeResult> {
  return invokeJudge({
    judgeId: JudgeId.CONTRADICTION,
    model: deps.model,
    modelId: deps.modelId ?? "contradiction-judge",
    promptVersion: CONTRADICTION_PROMPT_VERSION,
    schemaId: CONTRADICTION_SCHEMA_ID,
    schemaVersion: CONTRADICTION_SCHEMA_VERSION,
    systemInstruction: CONTRADICTION_SYSTEM_INSTRUCTION,
    userPayload: {
      constraints: input.constraints,
      action: input.action,
      evidenceClaims: input.evidenceClaims,
      evidenceEnvelopes: input.evidenceEnvelopes.map((e) => ({
        id: e.id,
        trustClass: e.trustClass,
        taint: e.taint,
        contentHash: e.contentHash,
      })),
    },
    requestId: deps.requestId ?? `contradiction-${input.action.id}`,
  });
}

import { invokeJudge } from "@truemandate/guardian-core";
import type { ModelPort } from "@truemandate/model";
import {
  JudgeId,
  type ActionProposal,
  type Assumption,
  type Constraint,
  type EvidenceClaim,
  type IntentState,
  type JudgeResult,
  type PlanGraph,
} from "@truemandate/protocol";
import {
  FIDELITY_PROMPT_VERSION,
  FIDELITY_SCHEMA_ID,
  FIDELITY_SCHEMA_VERSION,
  FIDELITY_SYSTEM_INSTRUCTION,
} from "./prompts/v1.js";

export interface FidelityJudgeInput {
  readonly rawIntent: string;
  readonly intentState: IntentState;
  readonly constraints: readonly Constraint[];
  readonly plan?: PlanGraph;
  readonly action: ActionProposal;
  readonly evidenceClaims: readonly EvidenceClaim[];
  readonly assumptions: readonly Assumption[];
  readonly provenanceSummary?: unknown;
}

export interface FidelityJudgeDeps {
  readonly model: ModelPort;
  readonly modelId?: string;
  readonly requestId?: string;
}

export async function runFidelityJudge(
  input: FidelityJudgeInput,
  deps: FidelityJudgeDeps,
): Promise<JudgeResult> {
  return invokeJudge({
    judgeId: JudgeId.FIDELITY,
    model: deps.model,
    modelId: deps.modelId ?? "fidelity-judge",
    promptVersion: FIDELITY_PROMPT_VERSION,
    schemaId: FIDELITY_SCHEMA_ID,
    schemaVersion: FIDELITY_SCHEMA_VERSION,
    systemInstruction: FIDELITY_SYSTEM_INSTRUCTION,
    userPayload: {
      rawIntent: input.rawIntent,
      intentStateId: input.intentState.id,
      constraints: input.constraints,
      planId: input.plan?.id,
      planStepId: input.action.planStepId,
      action: input.action,
      evidenceClaims: input.evidenceClaims,
      assumptions: input.assumptions,
      provenanceSummary: input.provenanceSummary ?? null,
    },
    requestId: deps.requestId ?? `fidelity-${input.action.id}`,
  });
}

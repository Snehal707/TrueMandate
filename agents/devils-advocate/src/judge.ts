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
  DEVILS_ADVOCATE_PROMPT_VERSION,
  DEVILS_ADVOCATE_SCHEMA_ID,
  DEVILS_ADVOCATE_SCHEMA_VERSION,
  DEVILS_ADVOCATE_SYSTEM_INSTRUCTION,
} from "./prompts/v1.js";

export interface DevilsAdvocateInput {
  readonly rawIntent: string;
  readonly intentState: IntentState;
  readonly constraints: readonly Constraint[];
  readonly plan?: PlanGraph;
  readonly action: ActionProposal;
  readonly evidenceClaims: readonly EvidenceClaim[];
  readonly assumptions: readonly Assumption[];
  readonly provenanceSummary?: unknown;
}

export interface DevilsAdvocateDeps {
  readonly model: ModelPort;
  readonly modelId?: string;
  readonly requestId?: string;
}

/** Same inputs as fidelity — deliberately does not receive a fidelity verdict. */
export async function runDevilsAdvocate(
  input: DevilsAdvocateInput,
  deps: DevilsAdvocateDeps,
): Promise<JudgeResult> {
  return invokeJudge({
    judgeId: JudgeId.DEVILS_ADVOCATE,
    model: deps.model,
    modelId: deps.modelId ?? "devils-advocate",
    promptVersion: DEVILS_ADVOCATE_PROMPT_VERSION,
    schemaId: DEVILS_ADVOCATE_SCHEMA_ID,
    schemaVersion: DEVILS_ADVOCATE_SCHEMA_VERSION,
    systemInstruction: DEVILS_ADVOCATE_SYSTEM_INSTRUCTION,
    userPayload: {
      rawIntent: input.rawIntent,
      intentStateId: input.intentState.id,
      constraints: input.constraints,
      planId: input.plan?.id,
      action: input.action,
      evidenceClaims: input.evidenceClaims,
      assumptions: input.assumptions,
      provenanceSummary: input.provenanceSummary ?? null,
    },
    requestId: deps.requestId ?? `devils-${input.action.id}`,
  });
}

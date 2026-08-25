import type { ModelPort } from "@truemandate/model";
import {
  ErrorCode,
  JudgeInvocationStatus,
  type ConstraintId,
  type JudgeFinding,
  type JudgeId,
  type JudgeResult,
} from "@truemandate/protocol";
import { JudgeModelOutputSchema } from "@truemandate/schemas";

export interface InvokeJudgeInput {
  readonly judgeId: JudgeId;
  readonly model: ModelPort;
  readonly modelId: string;
  readonly promptVersion: string;
  readonly schemaId: string;
  readonly schemaVersion: string;
  readonly systemInstruction: string;
  readonly userPayload: unknown;
  readonly requestId: string;
}

/**
 * Invokes a single judge via ModelPort. Schema failures and provider errors
 * become explicit JudgeResult statuses — never treated as positive evidence.
 */
export async function invokeJudge(
  input: InvokeJudgeInput,
): Promise<JudgeResult> {
  const generated = await input.model.generateStructured({
    modelId: input.modelId,
    promptVersion: input.promptVersion,
    schemaId: input.schemaId,
    schemaVersion: input.schemaVersion,
    schema: JudgeModelOutputSchema,
    systemInstruction: input.systemInstruction,
    userPayload: input.userPayload,
    requestId: input.requestId,
  });

  if (!generated.ok) {
    let status: JudgeInvocationStatus = JudgeInvocationStatus.PROVIDER_FAILURE;
    if (generated.code === ErrorCode.MODEL_UNAVAILABLE) {
      status = generated.details?.reason === "MODEL_DEADLINE_EXCEEDED"
        ? JudgeInvocationStatus.TIMEOUT
        : JudgeInvocationStatus.UNAVAILABLE;
    } else if (
      generated.code === ErrorCode.SCHEMA_PARSE_FAILED ||
      generated.code === ErrorCode.GUARDIAN_SCHEMA_PARSE_FAILED
    ) {
      status = JudgeInvocationStatus.SCHEMA_PARSE_FAILED;
    }
    return {
      judgeId: input.judgeId,
      status,
      findings: [],
      message: generated.message,
      promptVersion: input.promptVersion,
      schemaId: input.schemaId,
      schemaVersion: input.schemaVersion,
    };
  }

  const out = generated.value.value;
  const findings: JudgeFinding[] = out.findings.map((f) => ({
    judgeId: input.judgeId,
    code: f.code,
    severity: f.severity,
    message: f.message,
    confidence: f.confidence,
    sourceRefs: f.sourceRefs,
  }));

  return {
    judgeId: input.judgeId,
    status: JudgeInvocationStatus.OK,
    findings,
    constraintClassifications: out.constraintClassifications?.map((c) => ({
      constraintId: c.constraintId as ConstraintId,
      classification: c.classification,
      confidence: c.confidence,
      rationale: c.rationale,
    })),
    modelId: generated.value.modelId,
    promptVersion: generated.value.promptVersion,
    schemaId: generated.value.schemaId,
    schemaVersion: generated.value.schemaVersion,
  };
}

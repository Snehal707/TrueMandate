import { z } from "zod";
import {
  createSdkCore,
  RecordIntentRequestSchema,
  SdkApprovalDecisionRequestSchema,
  SdkApprovalViewSchema,
  SdkEvidenceViewSchema,
  SdkOutcomeViewSchema,
  SdkResolutionCaseViewSchema,
  SdkWorkflowRequestSchema,
  SdkWorkflowViewSchema,
  type SdkApprovalView,
  type SdkOutcomeView,
  type SdkResolutionCaseView,
  type SdkWorkflowView,
} from "@truemandate/sdk-core";
import { EvidenceClaimSchema, EvidenceEnvelopeSchema } from "@truemandate/schemas";
import type {
  ApprovalIdInput,
  DecideApprovalInput,
  EvidenceIdInput,
  GovernedAdkCore,
  GovernedAdkToolDefinition,
  GovernedAdkToolFactoryConfig,
  GovernedAdkToolset,
  OutcomeContractIdInput,
  ResolutionCaseIdInput,
  ResumeWorkflowInput,
  ToolSuccessFormatter,
  WorkflowIdInput,
} from "./types.js";

const EMPTY_INPUT_SCHEMA = z.object({}).strict();
const WORKFLOW_ID_INPUT_SCHEMA = z
  .object({ workflowId: z.string().min(1) })
  .strict();
const APPROVAL_ID_INPUT_SCHEMA = z
  .object({ approvalId: z.string().min(1) })
  .strict();
const EVIDENCE_ID_INPUT_SCHEMA = z
  .object({ evidenceId: z.string().min(1) })
  .strict();
const OUTCOME_CONTRACT_ID_INPUT_SCHEMA = z
  .object({ outcomeContractId: z.string().min(1) })
  .strict();
const RESOLUTION_CASE_ID_INPUT_SCHEMA = z
  .object({ resolutionCaseId: z.string().min(1) })
  .strict();
const RESUME_WORKFLOW_INPUT_SCHEMA = z
  .object({
    workflowId: z.string().min(1),
    approvalId: z.string().min(1),
  })
  .strict();
const DECIDE_APPROVAL_INPUT_SCHEMA = z
  .object({
    approvalId: z.string().min(1),
    decision: SdkApprovalDecisionRequestSchema.shape.decision,
    reason: z.string().min(1).optional(),
  })
  .strict();
const SUBMIT_EVIDENCE_INPUT_SCHEMA = z
  .object({
    envelopes: z.array(EvidenceEnvelopeSchema).min(1),
    claims: z.array(EvidenceClaimSchema).default([]),
  })
  .strict();

function resolveCore(config: GovernedAdkToolFactoryConfig): GovernedAdkCore {
  if (config.core) return config.core;
  if (!config.baseUrl) {
    throw new Error(
      "Governed ADK tools require either a prebuilt sdk-core client or a public baseUrl",
    );
  }
  return createSdkCore({
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
  });
}

function formatFailure(code: string, message: string, details?: unknown): string {
  return JSON.stringify({
    ok: false,
    code,
    message,
    ...(details === undefined ? {} : { details }),
  });
}

function formatSuccess(payload: Record<string, unknown>): string {
  return JSON.stringify({ ok: true, ...payload });
}

function validateGovernedResponse<T>(
  schema: z.ZodType<T>,
  value: unknown,
  label: string,
): { ok: true; value: T } | { ok: false; code: string; message: string } {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      code: "SCHEMA_PARSE_FAILED",
      message: `invalid governed ${label} response`,
    };
  }
  return { ok: true, value: parsed.data };
}

async function executeGovernedTool<TArgs, TValue>(
  schema: z.ZodType<TArgs>,
  input: unknown,
  invoke: (args: TArgs) => Promise<{ ok: true; value: TValue } | { ok: false; code: string; message: string; details?: unknown }>,
  formatValue: ToolSuccessFormatter<TValue>,
): Promise<string> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return formatFailure("SCHEMA_PARSE_FAILED", "invalid ADK tool request", {
      issues: parsed.error.issues,
    });
  }
  const result = await invoke(parsed.data);
  if (!result.ok) {
    return formatFailure(result.code, result.message, result.details);
  }
  return formatSuccess(formatValue(result.value));
}

function workflowPayload(
  workflow: SdkWorkflowView,
  extras?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    workflow,
    ...(extras ?? {}),
  };
}

function approvalPayload(
  approval: SdkApprovalView,
  extras?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    approval,
    ...(extras ?? {}),
  };
}

function outcomePayload(outcome: SdkOutcomeView): Record<string, unknown> {
  return { outcome };
}

function resolutionPayload(
  resolution: SdkResolutionCaseView,
  extras?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    resolution,
    ...(extras ?? {}),
  };
}

export const TRUE_MANDATE_ADK_TOOL_NAMES = [
  "true_mandate_record_intent",
  "true_mandate_canonical_proof",
  "true_mandate_submit_workflow",
  "true_mandate_read_workflow",
  "true_mandate_resume_workflow",
  "true_mandate_read_approval",
  "true_mandate_decide_approval",
  "true_mandate_submit_evidence",
  "true_mandate_read_evidence",
  "true_mandate_read_outcome",
  "true_mandate_read_resolution_case",
  "true_mandate_read_resolution_by_outcome",
] as const;

export function buildGovernedSdkAdkToolset(
  config: GovernedAdkToolFactoryConfig,
): GovernedAdkToolset {
  const core = resolveCore(config);

  const recordIntent: GovernedAdkToolDefinition = {
    name: "true_mandate_record_intent",
    description:
      "Record a durable Intent in the TrueMandate trust core. This records only the raw human intent text and never compiles, authorizes, or executes anything.",
    parameters: RecordIntentRequestSchema,
    execute: (input) =>
      executeGovernedTool(
        RecordIntentRequestSchema,
        input,
        (args) => core.recordIntent(args),
        (intent) => ({
          recorded: true,
          intentId: intent.id,
          contentHash: intent.contentHash,
          note: "Intent recorded only. No compile, no authority, no execution followed.",
        }),
      ),
  };

  const readCanonicalProof: GovernedAdkToolDefinition = {
    name: "true_mandate_canonical_proof",
    description:
      "Read the canonical Phase C v5 proof projection through the governed public API. This is a fixed-allowlist, read-only inspection surface.",
    parameters: EMPTY_INPUT_SCHEMA,
    execute: (input) =>
      executeGovernedTool(
        EMPTY_INPUT_SCHEMA,
        input,
        () => core.readCanonicalProjection(),
        (projection) => ({
          read: true,
          intentId: projection.intent.id,
          authorityDecision: projection.authority.decision,
          executionState: projection.execution.resultState,
          outcomeState: projection.outcome.state,
          divergence: projection.outcome.divergence,
          resolutionState: projection.resolution.state,
          readOnly: projection.meta.readOnly,
        }),
      ),
  };

  const submitWorkflow: GovernedAdkToolDefinition = {
    name: "true_mandate_submit_workflow",
    description:
      "Submit a governed workflow through the generic TrueMandate public workflow API. The request stays domain-neutral at the top level and never bypasses Guardian, Authority, approval, monitoring, PREPARE, or Gateway.",
    parameters: SdkWorkflowRequestSchema,
    execute: (input) =>
      executeGovernedTool(
        SdkWorkflowRequestSchema,
        input,
        async (args) => {
          const result = await core.submitWorkflow(args);
          if (!result.ok) return result;
          return validateGovernedResponse(
            SdkWorkflowViewSchema,
            result.value,
            "workflow",
          );
        },
        (workflow) =>
          workflowPayload(workflow, {
            submitted: true,
          }),
      ),
  };

  const readWorkflow: GovernedAdkToolDefinition = {
    name: "true_mandate_read_workflow",
    description:
      "Read the sanitized status of a governed workflow by workflow identity only.",
    parameters: WORKFLOW_ID_INPUT_SCHEMA,
    execute: (input) =>
      executeGovernedTool(
        WORKFLOW_ID_INPUT_SCHEMA,
        input,
        async ({ workflowId }: WorkflowIdInput) => {
          const result = await core.readWorkflow(workflowId);
          if (!result.ok) return result;
          return validateGovernedResponse(
            SdkWorkflowViewSchema,
            result.value,
            "workflow",
          );
        },
        (workflow) => workflowPayload(workflow, { read: true }),
      ),
  };

  const resumeWorkflow: GovernedAdkToolDefinition = {
    name: "true_mandate_resume_workflow",
    description:
      "Resume a governed workflow after durable approval has already been satisfied. This uses the public workflow resume route and never performs an inline authority override.",
    parameters: RESUME_WORKFLOW_INPUT_SCHEMA,
    execute: (input) =>
      executeGovernedTool(
        RESUME_WORKFLOW_INPUT_SCHEMA,
        input,
        async ({ workflowId, approvalId }: ResumeWorkflowInput) => {
          const result = await core.resumeWorkflow(workflowId, { approvalId });
          if (!result.ok) return result;
          return validateGovernedResponse(
            SdkWorkflowViewSchema,
            result.value,
            "workflow",
          );
        },
        (workflow) => workflowPayload(workflow, { resumed: true }),
      ),
  };

  const readApproval: GovernedAdkToolDefinition = {
    name: "true_mandate_read_approval",
    description:
      "Read a durable approval request through the governed public API.",
    parameters: APPROVAL_ID_INPUT_SCHEMA,
    execute: (input) =>
      executeGovernedTool(
        APPROVAL_ID_INPUT_SCHEMA,
        input,
        async ({ approvalId }: ApprovalIdInput) => {
          const result = await core.readApproval(approvalId);
          if (!result.ok) return result;
          return validateGovernedResponse(
            SdkApprovalViewSchema,
            result.value,
            "approval",
          );
        },
        (approval) => approvalPayload(approval, { read: true }),
      ),
  };

  const decideApproval: GovernedAdkToolDefinition = {
    name: "true_mandate_decide_approval",
    description:
      "Submit a durable approval decision through the governed public API. This records the approval response but never mints grants, exposes commit tokens, or executes anything directly.",
    parameters: DECIDE_APPROVAL_INPUT_SCHEMA,
    execute: (input) =>
      executeGovernedTool(
        DECIDE_APPROVAL_INPUT_SCHEMA,
        input,
        async ({ approvalId, decision, reason }: DecideApprovalInput) => {
          const result = await core.decideApproval(approvalId, {
            decision,
            ...(reason === undefined ? {} : { reason }),
          });
          if (!result.ok) return result;
          return validateGovernedResponse(
            SdkApprovalViewSchema,
            result.value,
            "approval",
          );
        },
        (approval) => approvalPayload(approval, { decided: true }),
      ),
  };

  const submitEvidence: GovernedAdkToolDefinition = {
    name: "true_mandate_submit_evidence",
    description:
      "Submit governed evidence through the same public-safe evidence lifecycle used by sdk-core. This does not create authority or bypass any verification stage.",
    parameters: SUBMIT_EVIDENCE_INPUT_SCHEMA,
    execute: (input) =>
      executeGovernedTool(
        SUBMIT_EVIDENCE_INPUT_SCHEMA,
        input,
        (args) => core.submitEvidence(args),
        (receipt) => ({
          submitted: true,
          evidenceReceipt: receipt,
        }),
      ),
  };

  const readEvidence: GovernedAdkToolDefinition = {
    name: "true_mandate_read_evidence",
    description:
      "Read an allowlisted evidence envelope through the governed public API.",
    parameters: EVIDENCE_ID_INPUT_SCHEMA,
    execute: (input) =>
      executeGovernedTool(
        EVIDENCE_ID_INPUT_SCHEMA,
        input,
        async ({ evidenceId }: EvidenceIdInput) => {
          const result = await core.readEvidence(evidenceId);
          if (!result.ok) return result;
          return validateGovernedResponse(
            SdkEvidenceViewSchema,
            result.value,
            "evidence",
          );
        },
        (evidence) => ({
          read: true,
          evidence,
        }),
      ),
  };

  const readOutcome: GovernedAdkToolDefinition = {
    name: "true_mandate_read_outcome",
    description:
      "Read the allowlisted status of an OutcomeContract through the governed public API.",
    parameters: OUTCOME_CONTRACT_ID_INPUT_SCHEMA,
    execute: (input) =>
      executeGovernedTool(
        OUTCOME_CONTRACT_ID_INPUT_SCHEMA,
        input,
        async ({ outcomeContractId }: OutcomeContractIdInput) => {
          const result = await core.readOutcome(outcomeContractId);
          if (!result.ok) return result;
          return validateGovernedResponse(
            SdkOutcomeViewSchema,
            result.value,
            "outcome",
          );
        },
        outcomePayload,
      ),
  };

  const readResolutionCase: GovernedAdkToolDefinition = {
    name: "true_mandate_read_resolution_case",
    description:
      "Read an allowlisted ResolutionCase view by case id through the governed public API.",
    parameters: RESOLUTION_CASE_ID_INPUT_SCHEMA,
    execute: (input) =>
      executeGovernedTool(
        RESOLUTION_CASE_ID_INPUT_SCHEMA,
        input,
        async ({ resolutionCaseId }: ResolutionCaseIdInput) => {
          const result = await core.readResolutionCase(resolutionCaseId);
          if (!result.ok) return result;
          return validateGovernedResponse(
            SdkResolutionCaseViewSchema,
            result.value,
            "resolution",
          );
        },
        (resolution) => resolutionPayload(resolution, { read: true }),
      ),
  };

  const readResolutionByOutcome: GovernedAdkToolDefinition = {
    name: "true_mandate_read_resolution_by_outcome",
    description:
      "Read an allowlisted ResolutionCase view by outcome contract id through the governed public API.",
    parameters: OUTCOME_CONTRACT_ID_INPUT_SCHEMA,
    execute: (input) =>
      executeGovernedTool(
        OUTCOME_CONTRACT_ID_INPUT_SCHEMA,
        input,
        async ({ outcomeContractId }: OutcomeContractIdInput) => {
          const result = await core.readResolutionByOutcome(outcomeContractId);
          if (!result.ok) return result;
          return validateGovernedResponse(
            SdkResolutionCaseViewSchema,
            result.value,
            "resolution",
          );
        },
        (resolution) =>
          resolutionPayload(resolution, {
            outcomeContractId: resolution.contractId,
          }),
      ),
  };

  const tools = [
    recordIntent,
    readCanonicalProof,
    submitWorkflow,
    readWorkflow,
    resumeWorkflow,
    readApproval,
    decideApproval,
    submitEvidence,
    readEvidence,
    readOutcome,
    readResolutionCase,
    readResolutionByOutcome,
  ] as const;

  return {
    core,
    tools,
    recordIntent,
    readCanonicalProof,
    submitWorkflow,
    readWorkflow,
    resumeWorkflow,
    readApproval,
    decideApproval,
    submitEvidence,
    readEvidence,
    readOutcome,
    readResolutionCase,
    readResolutionByOutcome,
  };
}

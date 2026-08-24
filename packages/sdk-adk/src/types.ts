import type { AnyZodObject } from "zod";
import type {
  RecordIntentRequest,
  SdkApprovalDecisionRequest,
  SdkApprovalView,
  SdkCore,
  SdkEvidenceView,
  SdkOutcomeView,
  SdkResolutionCaseView,
  SdkWorkflowRequest,
  SdkWorkflowResumeRequest,
  SdkWorkflowView,
} from "@truemandate/sdk-core";
import type { CanonicalProjection, Intent } from "@truemandate/sdk-core";
import type { Result } from "@truemandate/protocol";

export interface GovernedAdkToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: AnyZodObject;
  execute(input: unknown): Promise<string>;
}

export interface GovernedAdkToolFactoryConfig {
  readonly baseUrl?: string;
  readonly core?: GovernedAdkCore;
  readonly timeoutMs?: number;
}

export type GovernedAdkCore = Pick<
  SdkCore,
  | "recordIntent"
  | "readCanonicalProjection"
  | "submitWorkflow"
  | "readWorkflow"
  | "resumeWorkflow"
  | "readApproval"
  | "decideApproval"
  | "submitEvidence"
  | "readEvidence"
  | "readOutcome"
  | "readResolutionCase"
  | "readResolutionByOutcome"
>;

export interface GovernedAdkToolset {
  readonly core: GovernedAdkCore;
  readonly tools: readonly GovernedAdkToolDefinition[];
  readonly recordIntent: GovernedAdkToolDefinition;
  readonly readCanonicalProof: GovernedAdkToolDefinition;
  readonly submitWorkflow: GovernedAdkToolDefinition;
  readonly readWorkflow: GovernedAdkToolDefinition;
  readonly resumeWorkflow: GovernedAdkToolDefinition;
  readonly readApproval: GovernedAdkToolDefinition;
  readonly decideApproval: GovernedAdkToolDefinition;
  readonly submitEvidence: GovernedAdkToolDefinition;
  readonly readEvidence: GovernedAdkToolDefinition;
  readonly readOutcome: GovernedAdkToolDefinition;
  readonly readResolutionCase: GovernedAdkToolDefinition;
  readonly readResolutionByOutcome: GovernedAdkToolDefinition;
}

export type ToolSuccessFormatter<TValue> = (value: TValue) => Record<string, unknown>;

export type RecordIntentResult = Result<Intent>;
export type CanonicalProofResult = Result<CanonicalProjection>;
export type SubmitWorkflowResult = Result<SdkWorkflowView>;
export type ReadWorkflowResult = Result<SdkWorkflowView>;
export type ResumeWorkflowResult = Result<SdkWorkflowView>;
export type ReadApprovalResult = Result<SdkApprovalView>;
export type DecideApprovalResult = Result<SdkApprovalView>;
export type SubmitEvidenceResult = Result<unknown>;
export type ReadEvidenceResult = Result<SdkEvidenceView>;
export type ReadOutcomeResult = Result<SdkOutcomeView>;
export type ReadResolutionCaseResult = Result<SdkResolutionCaseView>;
export type ReadResolutionByOutcomeResult = Result<SdkResolutionCaseView>;

export interface WorkflowIdInput {
  readonly workflowId: string;
}

export interface ApprovalIdInput {
  readonly approvalId: string;
}

export interface EvidenceIdInput {
  readonly evidenceId: string;
}

export interface OutcomeContractIdInput {
  readonly outcomeContractId: string;
}

export interface ResolutionCaseIdInput {
  readonly resolutionCaseId: string;
}

export interface ResumeWorkflowInput extends WorkflowIdInput, SdkWorkflowResumeRequest {}

export interface DecideApprovalInput extends ApprovalIdInput, SdkApprovalDecisionRequest {}

export type SubmitWorkflowInput = SdkWorkflowRequest;
export type RecordIntentInput = RecordIntentRequest;

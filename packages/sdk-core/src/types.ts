import { z } from "zod";
import type { ErrorCode } from "@truemandate/protocol";
import {
  GenericWorkflowRequestSchema,
  WorkflowApprovalResumeRequestSchema,
} from "@truemandate/schemas";

/**
 * @truemandate/sdk-core - framework-neutral client types.
 *
 * Truth contract (verified against the public BFF on Friday, August 21, 2026):
 * the SDK exposes only real public routes, and it classifies them honestly.
 * The SDK proposes, transports, and verifies. Infrastructure authorizes.
 */

export interface SdkHttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface SdkTransport {
  post(path: string, body: unknown): Promise<SdkHttpResponse>;
  get(path: string): Promise<SdkHttpResponse>;
}

export interface SdkCoreConfig {
  readonly baseUrl: string;
  readonly transport?: SdkTransport;
  readonly timeoutMs?: number;
}

export interface SdkRemoteError {
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export function isRemoteErrorBody(
  body: unknown,
): body is { error: SdkRemoteError } {
  return (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof (body as { error: unknown }).error === "object"
  );
}

export function parseSuccessBody<T>(
  schema: z.ZodType<T>,
  body: unknown,
): z.SafeParseReturnType<unknown, T> {
  return schema.safeParse(body);
}

export const SDK_EVIDENCE_ALLOWLIST = [
  "id",
  "source",
  "contentHash",
  "trustClass",
  "captureTime",
  "eventTime",
  "freshnessDeadline",
  "mimeType",
] as const;

export const SdkEvidenceViewSchema = z
  .object({
    id: z.string(),
    source: z.string(),
    contentHash: z.string(),
    trustClass: z.string(),
    captureTime: z.string(),
    eventTime: z.string().optional(),
    freshnessDeadline: z.string().optional(),
    mimeType: z.string().optional(),
  })
  .strict();
export type SdkEvidenceView = z.infer<typeof SdkEvidenceViewSchema>;

export const SdkWorkflowRequestSchema = GenericWorkflowRequestSchema;
export type SdkWorkflowRequest = z.infer<typeof SdkWorkflowRequestSchema>;

export const SdkWorkflowResumeRequestSchema =
  WorkflowApprovalResumeRequestSchema.omit({
    workflowId: true,
  });
export type SdkWorkflowResumeRequest = z.infer<
  typeof SdkWorkflowResumeRequestSchema
>;

export const SdkApprovalDecisionRequestSchema = z
  .object({
    decision: z.enum(["APPROVE", "DENY"]),
    reason: z.string().min(1).optional(),
  })
  .strict();
export type SdkApprovalDecisionRequest = z.infer<
  typeof SdkApprovalDecisionRequestSchema
>;

export const SdkApprovalViewSchema = z
  .object({
    id: z.string().min(1),
    workflowId: z.string().min(1),
    intentId: z.string().min(1),
    intentStateId: z.string().min(1),
    status: z.string().min(1),
    requestedCapability: z.string().min(1),
    requestedScope: z
      .object({
        amount: z.number(),
        currency: z.string().min(1),
        merchant: z.string().min(1),
        quantity: z.number().optional(),
      })
      .strict(),
    requestedAt: z.string().min(1),
    expiresAt: z.string().min(1),
    decidedAt: z.string().min(1).optional(),
    decidedBy: z.string().min(1).optional(),
    decision: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
  })
  .strict();
export type SdkApprovalView = z.infer<typeof SdkApprovalViewSchema>;

export const SdkWorkflowViewSchema = z
  .object({
    workflowId: z.string().min(1),
    state: z.string().min(1),
    artifacts: z.unknown().optional(),
    evaluation: z.unknown().optional(),
    approval: SdkApprovalViewSchema.partial().optional(),
    monitoringContract: z.unknown().optional(),
    outcomeContract: z.unknown().optional(),
    execution: z
      .object({
        status: z.string().min(1).optional(),
        executionId: z.string().min(1).optional(),
        resultRef: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type SdkWorkflowView = z.infer<typeof SdkWorkflowViewSchema>;

export const SdkWorkflowCommitResultSchema = z
  .object({
    status: z.string().min(1),
    executionId: z.string().min(1).optional(),
    resultRef: z.string().min(1).optional(),
  })
  .strict();
export type SdkWorkflowCommitResult = z.infer<
  typeof SdkWorkflowCommitResultSchema
>;

export const SdkOutcomeViewSchema = z
  .object({
    id: z.string().min(1),
    workflowId: z.string().min(1),
    intentId: z.string().min(1),
    intentStateId: z.string().min(1),
    domain: z.string().min(1),
    state: z.string().min(1),
    paymentStatus: z.string().min(1),
    monitoringContractId: z.string().min(1).optional(),
    resolutionCaseId: z.string().min(1).optional(),
    updatedAt: z.string().min(1).optional(),
  })
  .strict();
export type SdkOutcomeView = z.infer<typeof SdkOutcomeViewSchema>;

export const SdkResolutionCaseViewSchema = z
  .object({
    id: z.string().min(1),
    contractId: z.string().min(1),
    intentId: z.string().min(1),
    intentStateId: z.string().min(1),
    openedAt: z.string().min(1),
    responsibilityState: z.string().min(1),
    state: z.string().min(1),
    updatedAt: z.string().min(1).optional(),
  })
  .strict();
export type SdkResolutionCaseView = z.infer<
  typeof SdkResolutionCaseViewSchema
>;

export type SdkCapabilityStatus =
  | "supported"
  | "degraded"
  | "demo-only"
  | "infrastructure-owned";

export interface SdkCapabilityDescriptor {
  readonly status: SdkCapabilityStatus;
  readonly route?: string;
  readonly note: string;
}

export const SDK_CAPABILITIES = {
  "intents.record": {
    status: "supported",
    route: "POST /v1/intents",
    note: "durable Intent record only; nothing follows automatically",
  },
  "proof.canonical": {
    status: "supported",
    route: "GET /v1/demo/canonical-phase-c-v5",
    note: "fixed-allowlist durable read of the canonical proof projection",
  },
  "workflow.submit": {
    status: "supported",
    route: "POST /v1/workflows",
    note: "generic governed workflow submit across registered DomainPacks",
  },
  "workflow.read": {
    status: "supported",
    route: "GET /v1/workflows/:workflowId",
    note: "sanitized workflow lifecycle status read",
  },
  "workflow.resume": {
    status: "supported",
    route: "POST /v1/workflows/:workflowId/resume-approval",
    note: "governed approval resumption by workflow id only",
  },
  "workflow.commit": {
    status: "supported",
    route: "POST /v1/workflows/:workflowId/commit",
    note: "governed commit by workflow identity only",
  },
  "approval.read": {
    status: "supported",
    route: "GET /v1/approvals/:id",
    note: "allowlisted durable approval request read",
  },
  "approval.decide": {
    status: "supported",
    route: "POST /v1/approvals/:id/decide",
    note: "governed durable approval decision",
  },
  "evidence.submit": {
    status: "supported",
    route: "POST /v1/evidence",
    note: "governed evidence-owner submission through the public BFF",
  },
  "evidence.read": {
    status: "supported",
    route: "GET /v1/evidence/:id",
    note: "allowlisted evidence envelope read through the governed public BFF",
  },
  "outcome.read": {
    status: "supported",
    route: "GET /v1/outcomes/contracts/:id",
    note: "allowlisted outcome status read",
  },
  "resolution.read": {
    status: "supported",
    route: "GET /v1/resolutions/cases/:id",
    note: "allowlisted resolution case read",
  },
  "resolution.read_by_outcome": {
    status: "supported",
    route: "GET /v1/resolutions/cases/by-outcome/:outcomeContractId",
    note: "allowlisted resolution case lookup by outcome contract",
  },
  "resolution.remedies": {
    status: "supported",
    route: "GET /v1/resolutions/cases/:id/remedies",
    note: "planned remedy inspection only",
  },
  "resolution.mandate": {
    status: "supported",
    route: "GET /v1/resolutions/mandates/:id",
    note: "remediation mandate inspection only",
  },
  "workspace.read": {
    status: "demo-only",
    route: "GET /v1/workspace/:intentId",
    note: "synthetic DemoRuntime view; not canonical production state",
  },
  "intents.compile": { status: "infrastructure-owned", note: "no public route" },
  "workflow.trigger": { status: "infrastructure-owned", note: "no public route" },
  "guardian.verdict": { status: "infrastructure-owned", note: "no public route" },
  "authority.evaluate": { status: "infrastructure-owned", note: "no public route" },
  "grant.mint": { status: "infrastructure-owned", note: "no public route" },
  "commit.token": { status: "infrastructure-owned", note: "no public route" },
  "gateway.commit": { status: "infrastructure-owned", note: "no public route" },
  "provenance.write": { status: "infrastructure-owned", note: "no public route" },
} as const satisfies Record<string, SdkCapabilityDescriptor>;

export type SdkCapability = keyof typeof SDK_CAPABILITIES;

export type { ErrorCode };

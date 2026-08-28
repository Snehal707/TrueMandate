import { z } from "zod";
import { err, ErrorCode, ok, type Result } from "@truemandate/protocol";
import { asHashDigest, asIntentId, asPrincipalId } from "@truemandate/protocol";
import type { Intent } from "@truemandate/protocol";
import type { CanonicalProjection, IntentWorkspaceView } from "@truemandate/read-model";
import {
  SDK_CAPABILITIES,
  SdkApprovalDecisionRequestSchema,
  SdkApprovalViewSchema,
  SdkEvidenceViewSchema,
  SdkOutcomeViewSchema,
  SdkResolutionCaseViewSchema,
  SdkWorkflowCommitResultSchema,
  SdkWorkflowRequestSchema,
  SdkWorkflowResumeRequestSchema,
  SdkWorkflowViewSchema,
  type SdkApprovalDecisionRequest,
  type SdkApprovalView,
  type SdkCoreConfig,
  type SdkEvidenceView,
  type SdkHttpResponse,
  type SdkOutcomeView,
  type SdkResolutionCaseView,
  type SdkTransport,
  type SdkWorkflowCommitResult,
  type SdkWorkflowRequest,
  type SdkWorkflowResumeRequest,
  type SdkWorkflowView,
  isRemoteErrorBody,
} from "./types.js";

/**
 * @truemandate/sdk-core client.
 *
 * Route truth verified against the public BFF on Friday, August 21, 2026.
 * The SDK proposes, transports, and verifies. Infrastructure authorizes.
 */

export const IntentWireSchema = z
  .object({
    id: z.string().min(1),
    principalId: z.string().min(1),
    rawText: z.string().min(1),
    createdAt: z.string().min(1),
    contentHash: z.string().min(1),
  })
  .strict();

export const RecordIntentRequestSchema = z
  .object({
    principalId: z.string().min(1),
    rawText: z.string().min(1),
    id: z.string().min(1).optional(),
    createdAt: z.string().min(1).optional(),
  })
  .strict();
export type RecordIntentRequest = z.infer<typeof RecordIntentRequestSchema>;

const IdParamSchema = z.string().min(1).max(512);

const PATHS = {
  intents: "/v1/intents",
  canonicalProjection: "/v1/demo/canonical-phase-c-v5",
  workflows: "/v1/workflows",
  workflow: (workflowId: string): string =>
    `/v1/workflows/${encodeURIComponent(workflowId)}`,
  workflowResume: (workflowId: string): string =>
    `/v1/workflows/${encodeURIComponent(workflowId)}/resume-approval`,
  workflowCommit: (workflowId: string): string =>
    `/v1/workflows/${encodeURIComponent(workflowId)}/commit`,
  approval: (id: string): string => `/v1/approvals/${encodeURIComponent(id)}`,
  approvalDecide: (id: string): string =>
    `/v1/approvals/${encodeURIComponent(id)}/decide`,
  evidenceSubmit: "/v1/evidence",
  evidence: (id: string): string => `/v1/evidence/${encodeURIComponent(id)}`,
  outcome: (id: string): string =>
    `/v1/outcomes/contracts/${encodeURIComponent(id)}`,
  resolutionCase: (id: string): string =>
    `/v1/resolutions/cases/${encodeURIComponent(id)}`,
  resolutionByOutcome: (outcomeContractId: string): string =>
    `/v1/resolutions/cases/by-outcome/${encodeURIComponent(outcomeContractId)}`,
  resolutionRemedies: (caseId: string): string =>
    `/v1/resolutions/cases/${encodeURIComponent(caseId)}/remedies`,
  resolutionMandate: (id: string): string =>
    `/v1/resolutions/mandates/${encodeURIComponent(id)}`,
  /**
   * `workflowId` is additive and optional. Omitting it is byte-identical to the
   * pre-projection route; supplying it lets the backend bind the response to
   * that exact workflow's durable artifacts (see `lifecycle` on the result) —
   * the backend independently verifies the workflow actually belongs to
   * `intentId` before using anything from it.
   */
  workspace: (intentId: string, workflowId?: string): string =>
    `/v1/workspace/${encodeURIComponent(intentId)}${
      workflowId ? `?workflowId=${encodeURIComponent(workflowId)}` : ""
    }`,
} as const;

const DEFAULT_TIMEOUT_MS = 15_000;

function defaultFetchTransport(
  baseUrl: string,
  timeoutMs: number,
): SdkTransport {
  return {
    async post(path, body): Promise<SdkHttpResponse> {
      const res = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      return {
        status: res.status,
        body: await res.json().catch(() => undefined),
      };
    },
    async get(path): Promise<SdkHttpResponse> {
      const res = await fetch(`${baseUrl}${path}`, {
        method: "GET",
        signal: AbortSignal.timeout(timeoutMs),
      });
      return {
        status: res.status,
        body: await res.json().catch(() => undefined),
      };
    },
  };
}

function toRemoteError(res: SdkHttpResponse): Result<never> {
  if (isRemoteErrorBody(res.body) && typeof res.body.error.code === "string") {
    const code = res.body.error.code as ErrorCode;
    return err(code, res.body.error.message, res.body.error.details);
  }
  return err(
    ErrorCode.VALIDATION_FAILED,
    `unexpected remote response (HTTP ${res.status})`,
    {
      status: res.status,
      retryable: res.status >= 500,
    },
  );
}

function parseOrFail<T>(
  parsed: z.SafeParseReturnType<unknown, T>,
  what: string,
): Result<T> {
  if (parsed.success) return ok(parsed.data);
  return err(ErrorCode.SCHEMA_PARSE_FAILED, `invalid ${what} response`);
}

function toIntent(wire: z.infer<typeof IntentWireSchema>): Intent {
  return {
    id: asIntentId(wire.id),
    principalId: asPrincipalId(wire.principalId),
    rawText: wire.rawText,
    createdAt: wire.createdAt,
    contentHash: asHashDigest(wire.contentHash),
  };
}

function assertCanonicalProjectionShape(
  body: unknown,
): body is CanonicalProjection {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  const meta = b.meta as Record<string, unknown> | undefined;
  const intent = b.intent as Record<string, unknown> | undefined;
  return (
    typeof meta === "object" &&
    meta !== null &&
    meta.readOnly === true &&
    typeof meta.projectionKind === "string" &&
    typeof intent === "object" &&
    intent !== null &&
    typeof intent.id === "string" &&
    typeof intent.rawText === "string" &&
    typeof intent.contentHash === "string"
  );
}

export interface SdkCore {
  readonly capabilities: typeof SDK_CAPABILITIES;
  recordIntent(input: RecordIntentRequest): Promise<Result<Intent>>;
  readCanonicalProjection(): Promise<Result<CanonicalProjection>>;
  submitWorkflow(input: SdkWorkflowRequest): Promise<Result<SdkWorkflowView>>;
  readWorkflow(workflowId: string): Promise<Result<SdkWorkflowView>>;
  resumeWorkflow(
    workflowId: string,
    input: SdkWorkflowResumeRequest,
  ): Promise<Result<SdkWorkflowView>>;
  commitWorkflow(workflowId: string): Promise<Result<SdkWorkflowCommitResult>>;
  readApproval(id: string): Promise<Result<SdkApprovalView>>;
  decideApproval(
    id: string,
    input: SdkApprovalDecisionRequest,
  ): Promise<Result<SdkApprovalView>>;
  submitEvidence(input: unknown): Promise<Result<unknown>>;
  readEvidence(id: string): Promise<Result<SdkEvidenceView>>;
  readOutcome(id: string): Promise<Result<SdkOutcomeView>>;
  readResolutionCase(id: string): Promise<Result<SdkResolutionCaseView>>;
  readResolutionByOutcome(
    outcomeContractId: string,
  ): Promise<Result<SdkResolutionCaseView>>;
  listResolutionRemedies(caseId: string): Promise<Result<unknown>>;
  readResolutionMandate(id: string): Promise<Result<unknown>>;
  /**
   * `workflowId` is additive and optional — see `PATHS.workspace`. Omitting it
   * preserves the exact legacy response for this intent.
   */
  readWorkspace(
    intentId: string,
    workflowId?: string,
  ): Promise<Result<IntentWorkspaceView>>;
}

export function createSdkCore(config: SdkCoreConfig): SdkCore {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const transport =
    config.transport ??
    defaultFetchTransport(baseUrl, config.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  return {
    capabilities: SDK_CAPABILITIES,

    async recordIntent(input) {
      const parsed = RecordIntentRequestSchema.safeParse(input);
      if (!parsed.success) {
        return err(
          ErrorCode.SCHEMA_PARSE_FAILED,
          "invalid record-intent request",
        );
      }
      const res = await transport.post(PATHS.intents, parsed.data);
      if (res.status !== 200) return toRemoteError(res);
      const parsedBody = IntentWireSchema.safeParse(res.body);
      if (!parsedBody.success) {
        return err(ErrorCode.SCHEMA_PARSE_FAILED, "invalid intent response");
      }
      return ok(toIntent(parsedBody.data));
    },

    async readCanonicalProjection() {
      const res = await transport.get(PATHS.canonicalProjection);
      if (res.status !== 200) return toRemoteError(res);
      if (!assertCanonicalProjectionShape(res.body)) {
        return err(
          ErrorCode.SCHEMA_PARSE_FAILED,
          "invalid canonical projection response",
        );
      }
      return ok(res.body);
    },

    async submitWorkflow(input) {
      const parsed = SdkWorkflowRequestSchema.safeParse(input);
      if (!parsed.success) {
        return err(ErrorCode.SCHEMA_PARSE_FAILED, "invalid workflow request");
      }
      const res = await transport.post(PATHS.workflows, parsed.data);
      if (res.status !== 200) return toRemoteError(res);
      return parseOrFail(
        SdkWorkflowViewSchema.safeParse(res.body),
        "workflow",
      );
    },

    async readWorkflow(workflowId) {
      const idParsed = IdParamSchema.safeParse(workflowId);
      if (!idParsed.success) {
        return err(ErrorCode.SCHEMA_PARSE_FAILED, "invalid workflow id");
      }
      const res = await transport.get(PATHS.workflow(idParsed.data));
      if (res.status !== 200) return toRemoteError(res);
      return parseOrFail(
        SdkWorkflowViewSchema.safeParse(res.body),
        "workflow",
      );
    },

    async resumeWorkflow(workflowId, input) {
      const idParsed = IdParamSchema.safeParse(workflowId);
      if (!idParsed.success) {
        return err(ErrorCode.SCHEMA_PARSE_FAILED, "invalid workflow id");
      }
      const parsed = SdkWorkflowResumeRequestSchema.safeParse(input);
      if (!parsed.success) {
        return err(
          ErrorCode.SCHEMA_PARSE_FAILED,
          "invalid workflow resume request",
        );
      }
      const res = await transport.post(
        PATHS.workflowResume(idParsed.data),
        parsed.data,
      );
      if (res.status !== 200) return toRemoteError(res);
      return parseOrFail(
        SdkWorkflowViewSchema.safeParse(res.body),
        "workflow",
      );
    },

    async commitWorkflow(workflowId) {
      const idParsed = IdParamSchema.safeParse(workflowId);
      if (!idParsed.success) {
        return err(ErrorCode.SCHEMA_PARSE_FAILED, "invalid workflow id");
      }
      const res = await transport.post(PATHS.workflowCommit(idParsed.data), {});
      if (res.status !== 200) return toRemoteError(res);
      return parseOrFail(
        SdkWorkflowCommitResultSchema.safeParse(res.body),
        "workflow commit",
      );
    },

    async readApproval(id) {
      const idParsed = IdParamSchema.safeParse(id);
      if (!idParsed.success) {
        return err(ErrorCode.SCHEMA_PARSE_FAILED, "invalid approval id");
      }
      const res = await transport.get(PATHS.approval(idParsed.data));
      if (res.status !== 200) return toRemoteError(res);
      return parseOrFail(
        SdkApprovalViewSchema.safeParse(res.body),
        "approval",
      );
    },

    async decideApproval(id, input) {
      const idParsed = IdParamSchema.safeParse(id);
      if (!idParsed.success) {
        return err(ErrorCode.SCHEMA_PARSE_FAILED, "invalid approval id");
      }
      const parsed = SdkApprovalDecisionRequestSchema.safeParse(input);
      if (!parsed.success) {
        return err(
          ErrorCode.SCHEMA_PARSE_FAILED,
          "invalid approval decision request",
        );
      }
      const res = await transport.post(
        PATHS.approvalDecide(idParsed.data),
        parsed.data,
      );
      if (res.status !== 200) return toRemoteError(res);
      return parseOrFail(
        SdkApprovalViewSchema.safeParse(res.body),
        "approval",
      );
    },

    async submitEvidence(input) {
      const res = await transport.post(PATHS.evidenceSubmit, input);
      if (res.status !== 200) return toRemoteError(res);
      if (
        typeof res.body !== "object" ||
        res.body === null ||
        Array.isArray(res.body)
      ) {
        return err(
          ErrorCode.SCHEMA_PARSE_FAILED,
          "invalid evidence submit response",
        );
      }
      return ok(res.body);
    },

    async readEvidence(id) {
      const idParsed = IdParamSchema.safeParse(id);
      if (!idParsed.success) {
        return err(ErrorCode.SCHEMA_PARSE_FAILED, "invalid evidence id");
      }
      const res = await transport.get(PATHS.evidence(idParsed.data));
      if (res.status !== 200) return toRemoteError(res);
      return parseOrFail(
        SdkEvidenceViewSchema.safeParse(res.body),
        "evidence",
      );
    },

    async readOutcome(id) {
      const idParsed = IdParamSchema.safeParse(id);
      if (!idParsed.success) {
        return err(
          ErrorCode.SCHEMA_PARSE_FAILED,
          "invalid outcome contract id",
        );
      }
      const res = await transport.get(PATHS.outcome(idParsed.data));
      if (res.status !== 200) return toRemoteError(res);
      return parseOrFail(
        SdkOutcomeViewSchema.safeParse(res.body),
        "outcome",
      );
    },

    async readResolutionCase(id) {
      const idParsed = IdParamSchema.safeParse(id);
      if (!idParsed.success) {
        return err(
          ErrorCode.SCHEMA_PARSE_FAILED,
          "invalid resolution case id",
        );
      }
      const res = await transport.get(PATHS.resolutionCase(idParsed.data));
      if (res.status !== 200) return toRemoteError(res);
      return parseOrFail(
        SdkResolutionCaseViewSchema.safeParse(res.body),
        "resolution",
      );
    },

    async readResolutionByOutcome(outcomeContractId) {
      const idParsed = IdParamSchema.safeParse(outcomeContractId);
      if (!idParsed.success) {
        return err(
          ErrorCode.SCHEMA_PARSE_FAILED,
          "invalid outcome contract id",
        );
      }
      const res = await transport.get(PATHS.resolutionByOutcome(idParsed.data));
      if (res.status !== 200) return toRemoteError(res);
      return parseOrFail(
        SdkResolutionCaseViewSchema.safeParse(res.body),
        "resolution",
      );
    },

    async listResolutionRemedies(caseId) {
      const idParsed = IdParamSchema.safeParse(caseId);
      if (!idParsed.success) {
        return err(
          ErrorCode.SCHEMA_PARSE_FAILED,
          "invalid resolution case id",
        );
      }
      const res = await transport.get(PATHS.resolutionRemedies(idParsed.data));
      if (res.status !== 200) return toRemoteError(res);
      return ok(res.body);
    },

    async readResolutionMandate(id) {
      const idParsed = IdParamSchema.safeParse(id);
      if (!idParsed.success) {
        return err(ErrorCode.SCHEMA_PARSE_FAILED, "invalid mandate id");
      }
      const res = await transport.get(PATHS.resolutionMandate(idParsed.data));
      if (res.status !== 200) return toRemoteError(res);
      if (
        typeof res.body !== "object" ||
        res.body === null ||
        Array.isArray(res.body)
      ) {
        return err(ErrorCode.SCHEMA_PARSE_FAILED, "invalid mandate response");
      }
      return ok(res.body);
    },

    async readWorkspace(intentId, workflowId) {
      const idParsed = IdParamSchema.safeParse(intentId);
      if (!idParsed.success) {
        return err(ErrorCode.SCHEMA_PARSE_FAILED, "invalid intent id");
      }
      if (workflowId !== undefined) {
        const workflowIdParsed = IdParamSchema.safeParse(workflowId);
        if (!workflowIdParsed.success) {
          return err(ErrorCode.SCHEMA_PARSE_FAILED, "invalid workflow id");
        }
      }
      const res = await transport.get(PATHS.workspace(idParsed.data, workflowId));
      if (res.status !== 200) return toRemoteError(res);
      if (typeof res.body !== "object" || res.body === null) {
        return err(ErrorCode.SCHEMA_PARSE_FAILED, "invalid workspace response");
      }
      return ok(res.body as IntentWorkspaceView);
    },
  };
}

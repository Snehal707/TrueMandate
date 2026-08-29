import { ErrorCode, err, ok, type Result } from "@truemandate/protocol";
import {
  ExecutionAuthorizationArtifactPayloadSchema,
  GenericWorkflowRequestSchema,
  WorkflowApprovalResumeRequestSchema,
  type GenericWorkflowRequest,
} from "@truemandate/schemas";
import type { IntentProvenanceS2SClient } from "@truemandate/cloud-runtime";
import type { WorkflowRequestBase } from "./domain-pack.js";
import type { GenericWorkflowEngine } from "./generic-workflow-engine.js";
import {
  createWave45DomainPackRegistry,
  type DomainPackRegistry,
  type WorkflowPackAdapter,
} from "./workflow-registry.js";

type WorkflowEngine = GenericWorkflowEngine<WorkflowRequestBase>;

type WorkflowArtifact = {
  readonly id?: string;
  readonly kind?: string;
  readonly contentHash?: string;
  readonly payload?: Record<string, unknown>;
  readonly predecessors?: readonly {
    readonly id?: string;
    readonly kind?: string;
    readonly contentHash?: string;
  }[];
};

function resolveExecutionAuthorization(
  workflowId: string,
  workflow: WorkflowArtifact,
  artifacts: readonly WorkflowArtifact[],
): Result<{ readonly commitTokenId: string }> {
  const authorization = artifacts.find(
    (row) => row.kind === "EXECUTION_AUTHORIZATION",
  );
  if (!authorization) {
    return err(
      ErrorCode.VALIDATION_FAILED,
      "Workflow has no durable execution authorization handle",
      { workflowId },
    );
  }
  const parsed = ExecutionAuthorizationArtifactPayloadSchema.safeParse(
    authorization.payload,
  );
  const predecessor = authorization.predecessors?.[0];
  if (
    !parsed.success ||
    authorization.id !== `execution-authorization-${workflowId}` ||
    parsed.data.workflowId !== workflowId ||
    authorization.predecessors?.length !== 1 ||
    predecessor?.id !== workflow.id ||
    predecessor?.kind !== "WORKFLOW" ||
    predecessor?.contentHash !== workflow.contentHash
  ) {
    return err(
      ErrorCode.VALIDATION_FAILED,
      "Workflow execution authorization handle has invalid lineage",
      { workflowId },
    );
  }
  return ok({ commitTokenId: parsed.data.commitTokenId });
}

function sanitizeWorkflowResult(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const value = raw as Record<string, unknown>;
  const response: Record<string, unknown> = {
    workflowId: value.workflowId,
    state: value.state,
  };
  for (const key of [
    "artifacts",
    "evaluation",
    "approval",
    "monitoringContract",
    "outcomeContract",
  ] as const) {
    if (key in value) response[key] = value[key];
  }
  if (value.state === "AUTHORIZED") {
    response.execution = { status: "AUTHORIZED" };
  }
  return response;
}

function sanitizeCommitResult(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const value = raw as Record<string, unknown>;
  const response: Record<string, unknown> = {};
  for (const key of ["status", "executionId", "resultRef"] as const) {
    if (key in value) response[key] = value[key];
  }
  return response;
}

function buildWorkflowSnapshot(
  workflowId: string,
  rows: readonly unknown[],
): Result<unknown> {
  const artifacts = rows.filter(
    (row): row is WorkflowArtifact =>
      typeof row === "object" && row !== null,
  );
  const byKind = (kind: string): WorkflowArtifact | undefined =>
    artifacts.find((row) => row.kind === kind);
  const workflow = byKind("WORKFLOW");
  if (!workflow) {
    return err(
      ErrorCode.VALIDATION_FAILED,
      "Workflow artifacts do not include a canonical WORKFLOW row",
      { workflowId },
    );
  }
  const workflowPayload = workflow.payload ?? {};
  const executionAuthorization = byKind("EXECUTION_AUTHORIZATION");
  if (executionAuthorization) {
    const resolved = resolveExecutionAuthorization(
      workflowId,
      workflow,
      artifacts,
    );
    if (!resolved.ok) return resolved;
  }
  const state =
    executionAuthorization !== undefined
      ? "AUTHORIZED"
      : typeof workflowPayload.state === "string"
        ? workflowPayload.state
        : "AUTHORITY_EVALUATION";
  const refs = {
    workflowId,
    intentStateId:
      typeof workflowPayload.intentStateId === "string"
        ? workflowPayload.intentStateId
        : undefined,
    intentStateHash:
      typeof workflowPayload.intentStateHash === "string"
        ? workflowPayload.intentStateHash
        : undefined,
    workflow:
      workflow.id && workflow.contentHash
        ? { id: workflow.id, hash: workflow.contentHash }
        : undefined,
    plan: (() => {
      const row = byKind("PLAN");
      return row?.id && row.contentHash
        ? { id: row.id, hash: row.contentHash }
        : undefined;
    })(),
    planVerification: (() => {
      const row = byKind("PLAN_VERIFICATION");
      return row?.id && row.contentHash
        ? { id: row.id, hash: row.contentHash }
        : undefined;
    })(),
    action: (() => {
      const row = byKind("ACTION");
      return row?.id && row.contentHash
        ? { id: row.id, hash: row.contentHash }
        : undefined;
    })(),
    guardian: (() => {
      const row = byKind("GUARDIAN");
      return row?.id && row.contentHash
        ? { id: row.id, hash: row.contentHash }
        : undefined;
    })(),
    proofs: artifacts
      .filter((row) => row.kind === "PROOF" && row.id && row.contentHash)
      .map((row) => ({ id: row.id!, hash: row.contentHash! })),
  };
  const response: Record<string, unknown> = {
    workflowId,
    state,
    artifacts: refs,
  };
  if (executionAuthorization?.payload) {
    response.execution = { status: "AUTHORIZED" };
    const payload = executionAuthorization.payload;
    if (
      typeof payload.outcomeContractId === "string" &&
      typeof payload.outcomeContractHash === "string"
    ) {
      response.outcomeContract = {
        id: payload.outcomeContractId,
        definitionHash: payload.outcomeContractHash,
      };
    }
  }
  return ok(response);
}

export class GenericWorkflowDispatcher {
  constructor(
    private readonly owner: Pick<
      IntentProvenanceS2SClient,
      "createIntent" | "listWorkflowArtifacts"
    >,
    private readonly engines: Readonly<Record<string, WorkflowEngine>>,
    private readonly registry: DomainPackRegistry = createWave45DomainPackRegistry(),
  ) {}

  private async resolvePackAdapter(
    packId: string,
  ): Promise<Result<WorkflowPackAdapter<WorkflowRequestBase>>> {
    return this.registry.get(packId);
  }

  private async resolvePackIdForWorkflow(
    workflowId: string,
  ): Promise<Result<string>> {
    const rows = await this.owner.listWorkflowArtifacts(workflowId);
    if (!rows.ok) return rows as Result<string>;
    const workflow = rows.value.find(
      (row) =>
        typeof row === "object" &&
        row !== null &&
        (row as WorkflowArtifact).kind === "WORKFLOW",
    ) as WorkflowArtifact | undefined;
    const packId = workflow?.payload?.packId;
    return typeof packId === "string"
      ? ok(packId)
      : err(
          ErrorCode.VALIDATION_FAILED,
          "Workflow artifacts do not declare a canonical packId",
          { workflowId },
        );
  }

  private engineFor(packId: string): Result<WorkflowEngine> {
    const engine = this.engines[packId];
    return engine
      ? ok(engine)
      : err(
          ErrorCode.VALIDATION_FAILED,
          "Workflow engine unavailable for pack",
          { packId },
        );
  }

  private async toReferenceRequest(
    request: GenericWorkflowRequest,
  ): Promise<Result<GenericWorkflowRequest>> {
    if (request.intent.kind === "REFERENCE") return ok(request);
    const created = await this.owner.createIntent({
      principalId: request.intent.principalId,
      rawText: request.intent.rawText,
      ...(request.intent.id ? { id: request.intent.id } : {}),
      ...(request.intent.createdAt
        ? { createdAt: request.intent.createdAt }
        : {}),
      // request.domain is required on every GenericWorkflowRequest (RAW or
      // REFERENCE) — this is the one authoritative domain selection for the
      // workflow, already present on this same request; a RAW submission
      // can never disagree with itself about which domain it targets.
      // Forwarded so compilation can constrain concept vocabulary to this
      // domain's canonical set instead of compiling free-form.
      packId: request.domain.packId,
    });
    if (!created.ok) return created as Result<GenericWorkflowRequest>;
    return ok({
      ...request,
      intent: {
        kind: "REFERENCE",
        intentId: created.value.id,
      },
    });
  }

  async submitWorkflow(raw: unknown): Promise<Result<unknown>> {
    const parsed = GenericWorkflowRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return err(ErrorCode.SCHEMA_PARSE_FAILED, "Invalid generic workflow request", {
        issues: parsed.error.issues,
      });
    }
    const referenceRequest = await this.toReferenceRequest(parsed.data);
    if (!referenceRequest.ok) return referenceRequest;
    const adapter = await this.resolvePackAdapter(
      referenceRequest.value.domain.packId,
    );
    if (!adapter.ok) return adapter as Result<unknown>;
    const engine = this.engineFor(adapter.value.packId);
    if (!engine.ok) return engine as Result<unknown>;
    const input = adapter.value.toEngineInput(referenceRequest.value);
    if (!input.ok) return input as Result<unknown>;
    const result = await engine.value.run(input.value);
    if (!result.ok) return result;
    return ok(sanitizeWorkflowResult(result.value));
  }

  async run(raw: unknown): Promise<Result<unknown>> {
    const adapter = await this.resolvePackAdapter("procurement");
    if (!adapter.ok) return adapter as Result<unknown>;
    if (!adapter.value.fromLegacyRequest) {
      return err(
        ErrorCode.VALIDATION_FAILED,
        "Procurement legacy workflow route is unavailable",
      );
    }
    const generic = adapter.value.fromLegacyRequest(raw);
    if (!generic.ok) return generic as Result<unknown>;
    const input = adapter.value.toEngineInput(generic.value);
    if (!input.ok) return input as Result<unknown>;
    const engine = this.engineFor(adapter.value.packId);
    if (!engine.ok) return engine as Result<unknown>;
    return engine.value.run(input.value);
  }

  async resumeWorkflow(raw: unknown): Promise<Result<unknown>> {
    const parsed = WorkflowApprovalResumeRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        ErrorCode.SCHEMA_PARSE_FAILED,
        "Invalid workflow approval resumption request",
        { issues: parsed.error.issues },
      );
    }
    const packId = await this.resolvePackIdForWorkflow(parsed.data.workflowId);
    if (!packId.ok) return packId as Result<unknown>;
    const engine = this.engineFor(packId.value);
    if (!engine.ok) return engine as Result<unknown>;
    const resumed = await engine.value.resumeWithApproval({
      workflowId: parsed.data.workflowId,
      approvalId: parsed.data.approvalId,
    });
    if (!resumed.ok) return resumed;
    return ok(sanitizeWorkflowResult(resumed.value));
  }

  async resumeWithApproval(raw: unknown): Promise<Result<unknown>> {
    const parsed = WorkflowApprovalResumeRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        ErrorCode.SCHEMA_PARSE_FAILED,
        "Invalid workflow approval resumption request",
        { issues: parsed.error.issues },
      );
    }
    const packId = await this.resolvePackIdForWorkflow(parsed.data.workflowId);
    if (!packId.ok) return packId as Result<unknown>;
    const engine = this.engineFor(packId.value);
    if (!engine.ok) return engine as Result<unknown>;
    return engine.value.resumeWithApproval(parsed.data);
  }

  async readWorkflow(workflowId: string): Promise<Result<unknown>> {
    const rows = await this.owner.listWorkflowArtifacts(workflowId);
    if (!rows.ok) return rows as Result<unknown>;
    return buildWorkflowSnapshot(workflowId, rows.value);
  }

  async commitWorkflow(workflowId: string): Promise<Result<unknown>> {
    const packId = await this.resolvePackIdForWorkflow(workflowId);
    if (!packId.ok) return packId as Result<unknown>;
    const engine = this.engineFor(packId.value);
    if (!engine.ok) return engine as Result<unknown>;
    const rows = await this.owner.listWorkflowArtifacts(workflowId);
    if (!rows.ok) return rows as Result<unknown>;
    const artifacts = rows.value.filter(
      (row): row is WorkflowArtifact => typeof row === "object" && row !== null,
    );
    const workflow = artifacts.find((row) => row.kind === "WORKFLOW");
    if (!workflow) {
      return err(
        ErrorCode.VALIDATION_FAILED,
        "Workflow artifacts do not include a canonical WORKFLOW row",
        { workflowId },
      );
    }
    const authorization = resolveExecutionAuthorization(
      workflowId,
      workflow,
      artifacts,
    );
    if (!authorization.ok) return authorization;
    const committed = await engine.value.commitAuthorizedExecution({
      commitTokenId: authorization.value.commitTokenId,
    });
    if (!committed.ok) return committed;
    return ok(sanitizeCommitResult(committed.value));
  }

  async commitAuthorizedExecution(raw: unknown): Promise<Result<unknown>> {
    const parsed = raw as { commitTokenId?: string };
    if (typeof parsed.commitTokenId !== "string") {
      return err(ErrorCode.SCHEMA_PARSE_FAILED, "Invalid commit request");
    }
    const engine = Object.values(this.engines)[0];
    return engine
      ? engine.commitAuthorizedExecution(raw)
      : err(ErrorCode.VALIDATION_FAILED, "Phase B execution path is not wired");
  }
}

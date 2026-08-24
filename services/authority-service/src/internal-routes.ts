import type { InternalRoute, InternalRouteResponse } from "@truemandate/cloud-runtime";
import {
  AuthorityDecision,
  ErrorCode,
  type RemediationMandate,
  type RemedyProposal,
  type Result,
} from "@truemandate/protocol";
import {
  ActionProposalSchema,
  AuthorityRequestSchema,
  GuardianVerdictSchema,
  RemediationMandateSchema,
  RemedyProposalSchema,
  PreparedActionRecordSchema,
  parseWithSchema,
} from "@truemandate/schemas";
import { parseOutcomeContract } from "@truemandate/outcome-core";
import { z } from "zod";
import { hashCanonical } from "@truemandate/crypto";
import type { AuthorityService } from "./service.js";
import {
  createEvaluationRecord,
  InMemoryEvaluationStore,
  type EvaluationStore,
} from "./evaluation-record.js";
import {
  assertIndependentRemedyAuthority,
  assertRemediationMandateValid,
  composeAdaptiveAuthorityDecision,
  parseApprovalRequest,
} from "@truemandate/authority";
import {
  assertCurrentIntentState,
  resolveSemanticArtifactChain,
  resolveTemporalExecutionBound,
  type SemanticArtifactClient,
  type SemanticArtifactReference,
} from "./semantic-artifact-resolver.js";
import { evaluatePrivilegedAuthority } from "./privileged.js";
import {
  loadAdaptiveAuthoritySignals,
  type LearningAdaptiveReadPort,
} from "./adaptive-signals.js";

const ArtifactReferenceSchema = z
  .object({ id: z.string().min(1), hash: z.string().min(1) })
  .strict();
const WorkflowReferencesSchema = z
  .object({
    workflowId: z.string().min(1),
    intentStateId: z.string().min(1),
    intentStateHash: z.string().min(1),
    workflow: ArtifactReferenceSchema,
    plan: ArtifactReferenceSchema,
    planVerification: ArtifactReferenceSchema,
    action: ArtifactReferenceSchema,
    guardian: ArtifactReferenceSchema,
    proofs: z.array(ArtifactReferenceSchema),
    outcomeContract: ArtifactReferenceSchema.optional(),
    correlationId: z.string().min(1).optional(),
    idempotencyKey: z.string().min(1),
  })
  .strict();
const BindMintSchema = z
  .object({
    evaluation: ArtifactReferenceSchema,
    preparedAction: ArtifactReferenceSchema,
    outcomeContract: ArtifactReferenceSchema,
    idempotencyKey: z.string().min(1),
    correlationId: z.string().min(1).optional(),
    approvalId: z.string().min(1).optional(),
  })
  .strict();

const RemedyEvaluationSchema = z
  .object({
    workflowId: z.string().min(1),
    intentStateId: z.string().min(1),
    intentStateHash: z.string().min(1),
    workflow: ArtifactReferenceSchema,
    action: ArtifactReferenceSchema,
    guardian: ArtifactReferenceSchema,
    mandateId: z.string().min(1),
    resolutionCaseId: z.string().min(1),
    originalPaymentGrantId: z.string().min(1),
    idempotencyKey: z.string().min(1),
  })
  .strict();

function fromResult<T>(result: Result<T>): InternalRouteResponse {
  if (result.ok) {
    return { status: 200, body: result.value };
  }
  const retryable =
    result.details?.retryable === true ||
    result.code === ErrorCode.MODEL_UNAVAILABLE;
  return {
    status: retryable ? 503 : 400,
    body: {
      error: result.code,
      message: result.message,
      details: result.details,
    },
  };
}

export function createAuthorityInternalRoutes(input: {
  readonly authority: AuthorityService;
  readonly artifacts?: SemanticArtifactClient;
  readonly evaluations?: EvaluationStore;
  readonly preparedActions?: { get(id: string): Promise<Result<unknown>> };
  readonly outcomeContracts?: { get(id: string): Promise<Result<unknown>> };
  readonly provenance?: {
    createAuthorityBinding(raw: unknown): Promise<Result<unknown>>;
  };
  readonly approvals?: { get(id: string): Promise<unknown> };
  readonly learning?: LearningAdaptiveReadPort;
  readonly resolution?: {
    getMandate(id: string): Promise<Result<unknown>>;
    getCase(id: string): Promise<Result<unknown>>;
    getRemedy(caseId: string, remedyId: string): Promise<Result<unknown>>;
  };
}): readonly InternalRoute[] {
  const {
    authority,
    artifacts,
    evaluations = new InMemoryEvaluationStore(),
    preparedActions,
    outcomeContracts,
    provenance,
    approvals,
    learning,
    resolution,
  } = input;

  const evaluateWorkflow = async (
    body: unknown,
  ): Promise<InternalRouteResponse> => {
    if (!artifacts) {
      return fromResult({
        ok: false,
        code: ErrorCode.VALIDATION_FAILED,
        message: "Semantic artifact client unavailable",
        details: {},
      });
    }
    const parsed = parseWithSchema(
      WorkflowReferencesSchema,
      body,
      "AuthorityWorkflowReferences",
    );
    if (!parsed.ok) return fromResult(parsed);
    const refs: SemanticArtifactReference[] = [
      { ...parsed.value.workflow, kind: "WORKFLOW" },
      { ...parsed.value.plan, kind: "PLAN" },
      { ...parsed.value.planVerification, kind: "PLAN_VERIFICATION" },
      { ...parsed.value.action, kind: "ACTION" },
      { ...parsed.value.guardian, kind: "GUARDIAN" },
      ...parsed.value.proofs.map((proof) => ({
        ...proof,
        kind: "PROOF" as const,
      })),
    ];
    const chain = await resolveSemanticArtifactChain({
      client: artifacts,
      workflowId: parsed.value.workflowId,
      intentStateId: parsed.value.intentStateId,
      intentStateHash: parsed.value.intentStateHash,
      references: refs,
    });
    if (!chain.ok) return fromResult(chain);
    const workflow = chain.value.find((artifact) => artifact.kind === "WORKFLOW");
    const action = chain.value.find((artifact) => artifact.kind === "ACTION");
    const guardian = chain.value.find(
      (artifact) => artifact.kind === "GUARDIAN",
    );
    const workflowPayload = workflow?.payload as Record<string, unknown> | undefined;
    const domain =
      typeof workflowPayload?.packId === "string"
        ? workflowPayload.packId
        : "procurement";
    const payload = action?.payload;
    if (
      !payload ||
      typeof payload !== "object" ||
      !("authorityRequest" in payload)
    ) {
      return fromResult({
        ok: false,
        code: ErrorCode.VALIDATION_FAILED,
        message: "Resolved Action lacks a durable AuthorityRequest",
        details: {},
      });
    }
    const request = parseWithSchema(
      AuthorityRequestSchema,
      (payload as Record<string, unknown>).authorityRequest,
      "ResolvedAuthorityRequest",
    );
    if (!request.ok) return fromResult(request);
    if (request.value.intentStateId !== parsed.value.intentStateId) {
      return fromResult({
        ok: false,
        code: ErrorCode.GRANT_INTENT_STATE_MISMATCH,
        message: "Resolved AuthorityRequest tip mismatch",
        details: {},
      });
    }
    const actionProposal = parseWithSchema(
      ActionProposalSchema,
      (payload as Record<string, unknown>).action,
      "ResolvedActionProposal",
    );
    if (!actionProposal.ok) return fromResult(actionProposal);
    const guardianPayload = guardian?.payload;
    if (
      !guardianPayload ||
      typeof guardianPayload !== "object" ||
      !("verdict" in guardianPayload)
    ) {
      return fromResult({
        ok: false,
        code: ErrorCode.GUARDIAN_VERDICT_REQUIRED,
        message: "Resolved Guardian lacks a durable GuardianVerdict",
        details: {},
      });
    }
    const guardianVerdict = parseWithSchema(
      GuardianVerdictSchema,
      (guardianPayload as Record<string, unknown>).verdict,
      "ResolvedGuardianVerdict",
    );
    if (!guardianVerdict.ok) return fromResult(guardianVerdict);
    const fresh = await assertCurrentIntentState(artifacts, {
      intentId: String(request.value.intentId),
      intentStateId: parsed.value.intentStateId,
      intentStateHash: parsed.value.intentStateHash,
    });
    if (!fresh.ok) return fromResult(fresh);
    const baseline = await evaluatePrivilegedAuthority(authority, {
      request: request.value,
      action:
        actionProposal.value as unknown as import("@truemandate/protocol").ActionProposal,
      verdict:
        guardianVerdict.value as unknown as import("@truemandate/protocol").GuardianVerdict,
    });
    if (!baseline.ok) return fromResult(baseline);
    const ownerState = await artifacts.getIntentState?.(parsed.value.intentStateId);
    if (!ownerState?.ok) {
      return fromResult(
        ownerState ?? {
          ok: false,
          code: ErrorCode.VALIDATION_FAILED,
          message: "Authority temporal owner read unavailable",
          details: {},
        },
      );
    }
    const resolvedTemporal = resolveTemporalExecutionBound(
      ownerState.value,
      new Date().toISOString(),
    );
    const actionExpiry = (request.value.scope as { expiresAt?: string }).expiresAt;
    if (
      resolvedTemporal.ok &&
      actionExpiry &&
      Date.parse(actionExpiry) > Date.parse(resolvedTemporal.value.expiresAt)
    ) {
      return fromResult({
        ok: false,
        code: ErrorCode.VALIDATION_FAILED,
        message: "Action expiry extends authoritative temporal bound",
        details: {},
      });
    }
    if (!resolvedTemporal.ok && actionExpiry) {
      return fromResult({
        ok: false,
        code: ErrorCode.VALIDATION_FAILED,
        message: "Action expiry lacks authoritative temporal bound",
        details: {},
      });
    }
    const adaptiveSignals = await loadAdaptiveAuthoritySignals(learning, {
      adaptiveSubjectId: request.value.adaptiveSubjectId,
      agentId: String(actionProposal.value.agentId),
      merchant: request.value.merchant,
      domain,
    });
    if (!adaptiveSignals.ok) return fromResult(adaptiveSignals);
    const adaptive = composeAdaptiveAuthorityDecision({
      baselineDecision: baseline.value.decision,
      currentIntentState: fresh.value,
      currentScope: request.value.scope,
      action: {
        refundable: actionProposal.value.refundable,
        deliveryTerms: actionProposal.value.deliveryTerms,
      },
      agentTrust: adaptiveSignals.value.agentTrust,
      counterpartyTrust: adaptiveSignals.value.counterpartyTrust,
      preferences: adaptiveSignals.value.preferences,
      workflowRules: adaptiveSignals.value.workflowRules,
    });
    if (!adaptive.ok) return fromResult(adaptive);
    const expiresAt = resolvedTemporal.ok
      ? resolvedTemporal.value.expiresAt
      : undefined;
    const materializationReason = !resolvedTemporal.ok
      ? resolvedTemporal.code === ErrorCode.GRANT_EXPIRED
        ? "TEMPORAL_AUTHORITY_EXPIRED"
        : "MISSING_TEMPORAL_AUTHORITY"
      : adaptive.value.decision === "ALLOW_WITH_MONITORING"
        ? "PENDING_MONITORING"
        : adaptive.value.decision === "REQUIRE_APPROVAL"
          ? "PENDING_APPROVAL"
          : adaptive.value.decision === "BLOCK"
            ? "AUTHORITY_BLOCKED"
            : undefined;
    const materializationEligible =
      (adaptive.value.decision === "ALLOW" ||
        adaptive.value.decision === "ALLOW_WITH_MONITORING") &&
      resolvedTemporal.ok;
    const record = await createEvaluationRecord(evaluations, {
      schemaVersion: 1,
      id: `evaluation-${parsed.value.workflowId}-${request.value.id}`,
      workflowId: parsed.value.workflowId,
      adaptiveSubjectId: request.value.adaptiveSubjectId,
      workflow: parsed.value.workflow,
      action: parsed.value.action,
      guardian: parsed.value.guardian,
      evaluatedIntentState: {
        id: fresh.value.id,
        hash: fresh.value.stateHash,
        version: fresh.value.version,
      },
      decision: adaptive.value.decision,
      scope: request.value.scope,
      capability: request.value.capability,
      merchant: request.value.merchant,
      amount: request.value.amount,
      currency: request.value.currency,
      expiresAt,
      materializationEligible,
      materializationReason,
      createdAt: request.value.createdAt,
    });
    if (!record.ok) return fromResult(record);
    return {
      status: 200,
      body: {
        decision: adaptive.value.decision,
        reasons: [...baseline.value.reasons, ...adaptive.value.reasons],
        evaluation: {
          id: record.value.id,
          hash: record.value.recordHash,
          materializationEligible: record.value.materializationEligible,
          materializationReason: record.value.materializationReason,
          expiresAt: record.value.expiresAt,
        },
        evaluatedIntentState: fresh.value,
      },
    };
  };

  return [
    ...(artifacts
      ? ([
          {
            method: "POST",
            pattern: "/internal/authority/evaluate",
            handler: async ({ body }: { body: unknown }) =>
              evaluateWorkflow(body),
          },
          {
            method: "POST",
            pattern: "/internal/authority/procurement",
            handler: async ({ body }: { body: unknown }) =>
              evaluateWorkflow(body),
          },
        ] satisfies readonly InternalRoute[])
      : []),
    {
      method: "GET",
      pattern: "/internal/authority/evaluations/:id",
      handler: async ({ params }: { params: Record<string, string> }) => {
        const id = params.id;
        if (!id) {
          return fromResult({
            ok: false,
            code: ErrorCode.VALIDATION_FAILED,
            message: "Evaluation id missing",
            details: {},
          });
        }
        const record = await evaluations.get(id);
        return fromResult(record);
      },
    } satisfies InternalRoute,
    ...(artifacts && resolution
      ? ([
          {
            method: "POST",
            pattern: "/internal/authority/remedy-evaluations",
            handler: async ({ body }: { body: unknown }) => {
              const parsed = parseWithSchema(
                RemedyEvaluationSchema,
                body,
                "AuthorityRemedyEvaluation",
              );
              if (!parsed.ok) return fromResult(parsed);
              const request = parsed.value;

              const workflowRow = await artifacts.getSemanticArtifact(
                request.workflow.id,
              );
              const actionRow = await artifacts.getSemanticArtifact(
                request.action.id,
              );
              const guardianRow = await artifacts.getSemanticArtifact(
                request.guardian.id,
              );
              if (!workflowRow.ok || !actionRow.ok || !guardianRow.ok) {
                return fromResult({
                  ok: false,
                  code: ErrorCode.VALIDATION_FAILED,
                  message: "Missing remedy semantic artifact",
                  details: {},
                });
              }
              const workflow = workflowRow.value as Record<string, unknown>;
              const actionArtifact = actionRow.value as Record<string, unknown>;
              const guardianArtifact = guardianRow.value as Record<string, unknown>;
              if (
                workflow.kind !== "WORKFLOW" ||
                workflow.id !== request.workflowId ||
                workflow.workflowId !== request.workflowId ||
                workflow.contentHash !== request.workflow.hash
              ) {
                return fromResult({
                  ok: false,
                  code: ErrorCode.VALIDATION_FAILED,
                  message: "Remedy workflow lineage mismatch",
                  details: {},
                });
              }
              if (
                actionArtifact.kind !== "ACTION" ||
                actionArtifact.workflowId !== request.workflowId ||
                actionArtifact.contentHash !== request.action.hash
              ) {
                return fromResult({
                  ok: false,
                  code: ErrorCode.VALIDATION_FAILED,
                  message: "Remedy action lineage mismatch",
                  details: {},
                });
              }
              if (
                guardianArtifact.kind !== "GUARDIAN" ||
                guardianArtifact.workflowId !== request.workflowId ||
                guardianArtifact.contentHash !== request.guardian.hash
              ) {
                return fromResult({
                  ok: false,
                  code: ErrorCode.VALIDATION_FAILED,
                  message: "Remedy guardian lineage mismatch",
                  details: {},
                });
              }

              const payload = actionArtifact.payload as Record<string, unknown>;
              const authorityRequest = parseWithSchema(
                AuthorityRequestSchema,
                payload.authorityRequest,
                "RemedyAuthorityRequest",
              );
              if (!authorityRequest.ok) return fromResult(authorityRequest);
              const verdict = parseWithSchema(
                GuardianVerdictSchema,
                (guardianArtifact.payload as Record<string, unknown>).verdict,
                "RemedyGuardianVerdict",
              );
              if (!verdict.ok) return fromResult(verdict);
              if (
                verdict.value.decision !== AuthorityDecision.ALLOW ||
                verdict.value.criticalFailure
              ) {
                return fromResult({
                  ok: false,
                  code: ErrorCode.AUTHORITY_BLOCKED,
                  message: "Remedy guardian verdict is not executable",
                  details: {},
                });
              }
              if (
                authorityRequest.value.intentStateId !== request.intentStateId ||
                authorityRequest.value.merchant === undefined ||
                authorityRequest.value.amount === undefined
              ) {
                return fromResult({
                  ok: false,
                  code: ErrorCode.VALIDATION_FAILED,
                  message: "Remedy AuthorityRequest binding incomplete",
                  details: {},
                });
              }

              const fresh = await assertCurrentIntentState(artifacts, {
                intentId: String(authorityRequest.value.intentId),
                intentStateId: request.intentStateId,
                intentStateHash: request.intentStateHash,
              });
              if (!fresh.ok) return fromResult(fresh);

              const mandateResult = await resolution.getMandate(request.mandateId);
              if (!mandateResult.ok) return fromResult(mandateResult);
              const mandate = parseWithSchema(
                RemediationMandateSchema,
                mandateResult.value,
                "ResolutionRemediationMandate",
              );
              if (!mandate.ok) return fromResult(mandate);
              const caseResult = await resolution.getCase(request.resolutionCaseId);
              if (!caseResult.ok) return fromResult(caseResult);
              const remedyResult = await resolution.getRemedy(
                request.resolutionCaseId,
                String(mandate.value.remedyProposalId),
              );
              if (!remedyResult.ok) return fromResult(remedyResult);
              const remedy = parseWithSchema(
                RemedyProposalSchema,
                remedyResult.value,
                "ResolutionRemedyProposal",
              );
              if (!remedy.ok) return fromResult(remedy);
              if (
                !remedy.value.requiredRemediationMandateId ||
                remedy.value.requiredRemediationMandateId !== mandate.value.id
              ) {
                return fromResult({
                  ok: false,
                  code: ErrorCode.REMEDIATION_MANDATE_INVALID,
                  message: "Remedy is not bound to this mandate",
                  details: {},
                });
              }
              const parsedRemedy = remedy.value as unknown as RemedyProposal;
              const parsedMandate = mandate.value as unknown as RemediationMandate;

              const now = new Date().toISOString();
              const indep = assertIndependentRemedyAuthority(
                parsedRemedy,
                request.originalPaymentGrantId as never,
                parsedMandate,
              );
              if (!indep.ok) return fromResult(indep);
              const scoped = assertRemediationMandateValid(parsedMandate, {
                remedy: parsedRemedy,
                resolutionCaseId: request.resolutionCaseId,
                now,
                originalPaymentGrantId: request.originalPaymentGrantId as never,
                proposedMerchant: String(authorityRequest.value.merchant),
                proposedCapability: String(authorityRequest.value.capability),
                proposedAmount: Number(authorityRequest.value.amount),
              });
              if (!scoped.ok) return fromResult(scoped);

              const record = await createEvaluationRecord(evaluations, {
                schemaVersion: 1,
                id: `remedy-evaluation-${request.mandateId}-${request.workflowId}`,
                workflowId: request.workflowId,
                workflow: request.workflow,
                action: request.action,
                guardian: request.guardian,
                evaluatedIntentState: {
                  id: fresh.value.id,
                  hash: fresh.value.stateHash,
                  version: fresh.value.version,
                },
                decision: AuthorityDecision.ALLOW,
                scope: {
                  capabilities: { execute_payment: AuthorityDecision.ALLOW },
                  maxAmount: mandate.value.maxAmount,
                  currency: mandate.value.currency,
                  allowedMerchants: [...mandate.value.allowedMerchants],
                  expiresAt: mandate.value.expiresAt,
                },
                capability: String(authorityRequest.value.capability),
                merchant: String(authorityRequest.value.merchant),
                amount: Number(authorityRequest.value.amount),
                currency: String(authorityRequest.value.currency),
                expiresAt: mandate.value.expiresAt,
                materializationEligible: true,
                createdAt: String(authorityRequest.value.createdAt ?? now),
              });
              if (!record.ok) return fromResult(record);
              return {
                status: 200,
                body: {
                  decision: AuthorityDecision.ALLOW,
                  reasons: [
                    "remediation mandate validated; independent authority granted",
                  ],
                  evaluation: {
                    id: record.value.id,
                    hash: record.value.recordHash,
                    materializationEligible: true,
                    materializationReason: undefined,
                    expiresAt: mandate.value.expiresAt,
                  },
                  evaluatedIntentState: fresh.value,
                },
              };
            },
          },
        ] satisfies readonly InternalRoute[])
      : []),
    ...(preparedActions && outcomeContracts
      ? ([
          {
            method: "POST",
            pattern: "/internal/authority/bind-and-mint",
            handler: async ({ body }: { body: unknown }) => {
              const request = parseWithSchema(
                BindMintSchema,
                body,
                "AuthorityBindAndMintReferences",
              );
              if (!request.ok) return fromResult(request);
              const evaluation = await evaluations.get(request.value.evaluation.id);
              if (!evaluation.ok || !evaluation.value) {
                return fromResult(
                  evaluation.ok
                    ? {
                        ok: false,
                        code: ErrorCode.VALIDATION_FAILED,
                        message: "Unknown EvaluationRecord",
                        details: {},
                      }
                    : evaluation,
                );
              }
              if (
                evaluation.value.recordHash !== request.value.evaluation.hash
              ) {
                return fromResult({
                  ok: false,
                  code: ErrorCode.VALIDATION_FAILED,
                  message: "EvaluationRecord hash mismatch",
                  details: {},
                });
              }
              const rawPrepared = await preparedActions.get(
                request.value.preparedAction.id,
              );
              if (!rawPrepared.ok) return fromResult(rawPrepared);
              const prepared = parseWithSchema(
                PreparedActionRecordSchema,
                rawPrepared.value,
                "GatewayPreparedActionRecord",
              );
              if (
                !prepared.ok ||
                prepared.value.preparedAction.preparedActionHash !==
                  request.value.preparedAction.hash
              ) {
                return fromResult({
                  ok: false,
                  code: ErrorCode.PREPARED_ACTION_HASH_MISMATCH,
                  message: "PreparedAction hash mismatch",
                  details: {},
                });
              }
              const rawOutcome = await outcomeContracts.get(
                request.value.outcomeContract.id,
              );
              if (!rawOutcome.ok) return fromResult(rawOutcome);
              const outcome = parseOutcomeContract(
                rawOutcome.value,
                "OutcomeContract",
              );
              if (
                !outcome.ok ||
                outcome.value.definitionHash !== request.value.outcomeContract.hash
              ) {
                return fromResult({
                  ok: false,
                  code: ErrorCode.OUTCOME_CONTRACT_STALE,
                  message: "OutcomeContract hash mismatch",
                  details: {},
                });
              }

              let approval:
                | import("@truemandate/protocol").ApprovalRequest
                | undefined;
              if (request.value.approvalId) {
                if (!approvals) {
                  return fromResult({
                    ok: false,
                    code: ErrorCode.APPROVAL_REQUIRED,
                    message: "Approval store not configured",
                    details: {},
                  });
                }
                const rawApproval = await approvals.get(request.value.approvalId);
                if (!rawApproval) {
                  return fromResult({
                    ok: false,
                    code: ErrorCode.APPROVAL_NOT_PENDING,
                    message: "Unknown approval request",
                    details: { approvalId: request.value.approvalId },
                  });
                }
                const parsedApproval = parseApprovalRequest(rawApproval);
                if (!parsedApproval.ok) return fromResult(parsedApproval);
                if (
                  parsedApproval.value.authorityEvaluationId !== evaluation.value.id
                ) {
                  return fromResult({
                    ok: false,
                    code: ErrorCode.APPROVAL_FOREIGN_ACTION,
                    message: "Approval does not belong to this evaluation",
                    details: {},
                  });
                }
                approval = parsedApproval.value;
              }

              const minted = await authority.mintGrantFromEvaluation({
                evaluation: evaluation.value,
                preparedAction:
                  prepared.value.preparedAction as unknown as import("@truemandate/protocol").PreparedAction,
                outcomeContract: {
                  ...outcome.value,
                  definitionHash: outcome.value.definitionHash!,
                },
                idempotencyKey: request.value.idempotencyKey,
                approval,
              });
              if (!minted.ok || !provenance) return fromResult(minted);
              const bound = await provenance.createAuthorityBinding({
                lineage: {
                  preparedActionId: prepared.value.preparedAction.id,
                  preparedActionHash:
                    prepared.value.preparedAction.preparedActionHash,
                  actionId: prepared.value.preparedAction.actionProposalId,
                  actionHash: prepared.value.preparedAction.actionContentHash,
                  workflowId: prepared.value.preparedAction.workflowId,
                  evaluationId: evaluation.value.id,
                  evaluationHash: evaluation.value.recordHash,
                  outcomeContractId: outcome.value.id,
                  outcomeContractHash: outcome.value.definitionHash,
                  intentStateId: prepared.value.preparedAction.intentStateId,
                  intentStateHash: prepared.value.preparedAction.intentStateHash,
                  intentStateVersion:
                    prepared.value.preparedAction.evaluatedIntentStateVersion,
                  grantId: minted.value.id,
                  grantHash: hashCanonical(minted.value),
                  principalId: minted.value.principalId,
                },
                createdAt: minted.value.createdAt,
              });
              if (!bound.ok) return fromResult(bound);
              return fromResult(minted);
            },
          },
        ] satisfies readonly InternalRoute[])
      : []),
  ];
}

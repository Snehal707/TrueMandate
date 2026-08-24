import { proofObligationId } from "@truemandate/crypto";
import {
  ErrorCode,
  TaintClass,
  TrustClass,
  err,
  ok,
  type EvidenceClaim,
  type EvidenceEnvelope,
  type Intent,
  type IntentState,
  type OutcomeContract,
  type Result,
} from "@truemandate/protocol";
import {
  OutcomeContractSchema,
  PublicEvidenceSubmissionSchema,
  type PublicEvidenceSubmission,
} from "@truemandate/schemas";

type WorkflowArtifact = {
  readonly id?: string;
  readonly intentId?: string;
  readonly kind?: string;
  readonly payload?: Record<string, unknown>;
};

export interface EvidenceSubmissionLineageDeps {
  getIntent(intentId: string): Promise<Result<Intent>>;
  getIntentState(intentStateId: string): Promise<Result<IntentState>>;
  listWorkflowArtifacts(workflowId: string): Promise<Result<readonly unknown[]>>;
  getOutcomeContract(outcomeContractId: string): Promise<Result<unknown>>;
}

export interface ValidatedEvidenceLineage {
  readonly workflowId?: string;
  readonly intentId?: string;
  readonly intentStateId?: string;
  readonly outcomeContractId?: string;
  readonly proofObligationIds: readonly string[];
}

function unique(values: readonly string[]): readonly string[] {
  return values.filter((value, index, all) => all.indexOf(value) === index);
}

function workflowArtifact(rows: readonly unknown[]): WorkflowArtifact | undefined {
  return rows.find(
    (row): row is WorkflowArtifact =>
      typeof row === "object" &&
      row !== null &&
      (row as WorkflowArtifact).kind === "WORKFLOW",
  );
}

function planProofObligationIds(rows: readonly unknown[]): readonly string[] {
  const plan = rows.find(
    (row): row is WorkflowArtifact =>
      typeof row === "object" &&
      row !== null &&
      (row as WorkflowArtifact).kind === "PLAN",
  );
  const raw = plan?.payload?.proofObligations;
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  for (const obligation of raw) {
    if (obligation && typeof obligation === "object") {
      ids.push(proofObligationId(obligation));
    }
  }
  return ids;
}

function durableProofObligationIds(rows: readonly unknown[]): readonly string[] {
  const action = rows.find(
    (row): row is WorkflowArtifact =>
      typeof row === "object" &&
      row !== null &&
      (row as WorkflowArtifact).kind === "ACTION",
  );
  const fromAction = Array.isArray(action?.payload?.requiredProofObligationIds)
    ? action!.payload!.requiredProofObligationIds.filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      )
    : [];
  const fromProofs = rows
    .filter(
      (row): row is WorkflowArtifact =>
        typeof row === "object" &&
        row !== null &&
        (row as WorkflowArtifact).kind === "PROOF",
    )
    .map((row) => row.payload?.obligationId)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  return unique([...planProofObligationIds(rows), ...fromAction, ...fromProofs]);
}

function stripOutcomeReadMetadata(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const row = value as Record<string, unknown>;
  if (!("workflowId" in row) && !("domain" in row)) {
    return value;
  }
  const { workflowId: _workflowId, domain: _domain, ...canonical } = row;
  return canonical;
}

export async function validateEvidenceSubmissionLineage(
  submission: PublicEvidenceSubmission,
  deps: EvidenceSubmissionLineageDeps,
): Promise<Result<ValidatedEvidenceLineage>> {
  const parsed = PublicEvidenceSubmissionSchema.safeParse(submission);
  if (!parsed.success) {
    return err(ErrorCode.SCHEMA_PARSE_FAILED, "Invalid public evidence submission", {
      issues: parsed.error.issues,
    });
  }
  const lineage = parsed.data.lineage;
  if (!lineage) {
    return ok({ proofObligationIds: [] });
  }

  let workflowIntentId: string | undefined;
  let workflowIntentStateId: string | undefined;
  let workflowProofObligationIds: readonly string[] = [];

  if (lineage.intentId) {
    const intent = await deps.getIntent(lineage.intentId);
    if (!intent.ok) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown evidence lineage intent", {
        intentId: lineage.intentId,
      });
    }
  }

  if (lineage.intentStateId) {
    const state = await deps.getIntentState(lineage.intentStateId);
    if (!state.ok) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown evidence lineage intent state", {
        intentStateId: lineage.intentStateId,
      });
    }
    if (lineage.intentId && state.value.intentId !== lineage.intentId) {
      return err(ErrorCode.VALIDATION_FAILED, "IntentState does not belong to supplied intent", {
        intentId: lineage.intentId,
        intentStateId: lineage.intentStateId,
      });
    }
  }

  if (lineage.workflowId) {
    const rows = await deps.listWorkflowArtifacts(lineage.workflowId);
    if (!rows.ok || rows.value.length === 0) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown evidence lineage workflow", {
        workflowId: lineage.workflowId,
      });
    }
    const workflow = workflowArtifact(rows.value);
    if (!workflow) {
      return err(ErrorCode.VALIDATION_FAILED, "Workflow artifacts missing canonical WORKFLOW row", {
        workflowId: lineage.workflowId,
      });
    }
    workflowIntentId =
      typeof workflow.intentId === "string" && workflow.intentId.length > 0
        ? workflow.intentId
        : undefined;
    workflowIntentStateId =
      typeof workflow.payload?.intentStateId === "string" &&
      workflow.payload.intentStateId.length > 0
        ? workflow.payload.intentStateId
        : undefined;
    workflowProofObligationIds = durableProofObligationIds(rows.value);

    if (lineage.intentId && workflowIntentId && workflowIntentId !== lineage.intentId) {
      return err(ErrorCode.VALIDATION_FAILED, "Workflow does not belong to supplied intent", {
        workflowId: lineage.workflowId,
        intentId: lineage.intentId,
      });
    }
    if (
      lineage.intentStateId &&
      workflowIntentStateId &&
      workflowIntentStateId !== lineage.intentStateId
    ) {
      return err(
        ErrorCode.VALIDATION_FAILED,
        "Workflow does not belong to supplied intent state",
        {
          workflowId: lineage.workflowId,
          intentStateId: lineage.intentStateId,
        },
      );
    }
  }

  if (lineage.outcomeContractId) {
    const contract = await deps.getOutcomeContract(lineage.outcomeContractId);
    if (!contract.ok) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown evidence lineage outcome contract", {
        outcomeContractId: lineage.outcomeContractId,
      });
    }
    const parsedContract = OutcomeContractSchema.safeParse(stripOutcomeReadMetadata(contract.value));
    if (!parsedContract.success) {
      return err(ErrorCode.VALIDATION_FAILED, "Malformed outcome contract lineage", {
        outcomeContractId: lineage.outcomeContractId,
      });
    }
    const outcome = parsedContract.data as unknown as OutcomeContract;
    if (lineage.intentId && outcome.intentId !== lineage.intentId) {
      return err(ErrorCode.VALIDATION_FAILED, "OutcomeContract does not belong to supplied intent", {
        outcomeContractId: lineage.outcomeContractId,
        intentId: lineage.intentId,
      });
    }
    if (lineage.intentStateId && outcome.intentStateId !== lineage.intentStateId) {
      return err(
        ErrorCode.VALIDATION_FAILED,
        "OutcomeContract does not belong to supplied intent state",
        {
          outcomeContractId: lineage.outcomeContractId,
          intentStateId: lineage.intentStateId,
        },
      );
    }
    const outcomeWorkflowId = outcome.preExecutionBinding?.workflowId;
    if (lineage.workflowId && outcomeWorkflowId && outcomeWorkflowId !== lineage.workflowId) {
      return err(
        ErrorCode.VALIDATION_FAILED,
        "OutcomeContract does not belong to supplied workflow",
        {
          outcomeContractId: lineage.outcomeContractId,
          workflowId: lineage.workflowId,
        },
      );
    }
  }

  if (lineage.proofObligationIds?.length) {
    if (!lineage.workflowId) {
      return err(
        ErrorCode.VALIDATION_FAILED,
        "proofObligationIds require a workflowId lineage binding",
      );
    }
    const available = new Set(workflowProofObligationIds);
    for (const obligationId of lineage.proofObligationIds) {
      if (!available.has(obligationId)) {
        return err(ErrorCode.VALIDATION_FAILED, "Unknown workflow proof obligation", {
          workflowId: lineage.workflowId,
          proofObligationId: obligationId,
        });
      }
    }
  }

  return ok({
    workflowId: lineage.workflowId,
    intentId: lineage.intentId ?? workflowIntentId,
    intentStateId: lineage.intentStateId ?? workflowIntentStateId,
    outcomeContractId: lineage.outcomeContractId,
    proofObligationIds: lineage.proofObligationIds ?? [],
  });
}

function envelopeOrigins(
  callerEmail: string,
  envelope: PublicEvidenceSubmission["envelopes"][number],
  lineage: ValidatedEvidenceLineage,
): readonly string[] {
  return unique(
    [
      `caller:${callerEmail}`,
      `source:${envelope.source}`,
      lineage.workflowId,
      lineage.intentId,
      lineage.intentStateId,
      lineage.outcomeContractId,
      ...lineage.proofObligationIds,
    ].filter((value): value is string => typeof value === "string" && value.length > 0),
  );
}

export function normalizeEvidenceSubmission(
  submission: PublicEvidenceSubmission,
  callerEmail: string,
  lineage: ValidatedEvidenceLineage,
): {
  readonly envelopes: readonly EvidenceEnvelope[];
  readonly claims: readonly EvidenceClaim[];
} {
  const originsByEnvelopeId = new Map<string, readonly string[]>();
  const envelopes = submission.envelopes.map((envelope: PublicEvidenceSubmission["envelopes"][number]) => {
    const origins = envelopeOrigins(callerEmail, envelope, lineage);
    originsByEnvelopeId.set(envelope.id, origins);
    const normalized: EvidenceEnvelope = {
      id: envelope.id as EvidenceEnvelope["id"],
      source: envelope.source,
      contentHash: envelope.contentHash as EvidenceEnvelope["contentHash"],
      trustClass: TrustClass.UNTRUSTED_EXTERNAL,
      captureTime: envelope.captureTime,
      eventTime: envelope.eventTime,
      freshnessDeadline: envelope.freshnessDeadline,
      mimeType: envelope.mimeType,
      lineageGroupId: envelope.lineageGroupId,
      originId: envelope.originId,
      taint: {
        classes: [TaintClass.EXTERNAL_CONTENT],
        origins: origins as EvidenceEnvelope["taint"]["origins"],
      },
    };
    return normalized;
  });
  const claims = submission.claims.map((claim: PublicEvidenceSubmission["claims"][number]) => ({
    id: claim.id as EvidenceClaim["id"],
    evidenceId: claim.evidenceId as EvidenceClaim["evidenceId"],
    concept: claim.concept,
    value: claim.value,
    confidence: claim.confidence,
    derivedBy: "public-evidence-submission",
    taint: {
      classes: [TaintClass.EXTERNAL_CONTENT],
      origins: (originsByEnvelopeId.get(claim.evidenceId) ?? [
        `caller:${callerEmail}`,
      ]) as EvidenceClaim["taint"]["origins"],
    },
  }));
  return { envelopes, claims };
}

import { ErrorCode, TaintClass, TrustClass, err, ok, type EvidenceClaim, type EvidenceEnvelope, type Result } from "@truemandate/protocol";
import {
  PublicEvidenceSubmissionLineageSchema,
  parseWithSchema,
} from "@truemandate/schemas";
import { z } from "zod";
import { validateEvidenceSubmissionLineage, type EvidenceSubmissionLineageDeps } from "./submissions.js";

const EvidenceVerificationRequestSchema = z
  .object({
    verificationId: z.string().min(1),
    envelopeId: z.string().min(1),
    claimIds: z.array(z.string().min(1)).default([]),
    verifiedEnvelopeId: z.string().min(1).optional(),
    verifiedClaimIds: z.array(z.string().min(1)).optional(),
    lineage: PublicEvidenceSubmissionLineageSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.verifiedClaimIds !== undefined &&
      value.verifiedClaimIds.length !== value.claimIds.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "verifiedClaimIds must match claimIds length",
      });
    }
  });

export type EvidenceVerificationRequest = z.infer<
  typeof EvidenceVerificationRequestSchema
>;

export function parseEvidenceVerificationRequest(
  raw: unknown,
): Result<EvidenceVerificationRequest> {
  const parsed = parseWithSchema(
    EvidenceVerificationRequestSchema,
    raw,
    "EvidenceVerificationRequest",
  );
  if (!parsed.ok) return parsed;
  return ok({
    ...parsed.value,
    claimIds: parsed.value.claimIds ?? [],
  });
}

export async function verifyEvidenceSubmission(
  raw: unknown,
  callerEmail: string,
  deps: EvidenceSubmissionLineageDeps & {
    getEnvelope(id: string): Promise<EvidenceEnvelope | undefined>;
    getClaim(id: string): Promise<EvidenceClaim | undefined>;
  },
): Promise<
  Result<{
    envelope: EvidenceEnvelope;
    claims: readonly EvidenceClaim[];
    lineage: Awaited<ReturnType<typeof validateEvidenceSubmissionLineage>> extends Result<
      infer T
    >
      ? T
      : never;
    verificationId: string;
  }>
> {
  const parsed = parseEvidenceVerificationRequest(raw);
  if (!parsed.ok) return parsed;

  const sourceEnvelope = await deps.getEnvelope(parsed.value.envelopeId);
  if (!sourceEnvelope) {
    return err(ErrorCode.VALIDATION_FAILED, "Unknown evidence envelope", {
      envelopeId: parsed.value.envelopeId,
    });
  }
  if (sourceEnvelope.trustClass !== TrustClass.UNTRUSTED_EXTERNAL) {
    return err(
      ErrorCode.VALIDATION_FAILED,
      "Only untrusted external evidence may enter the verification seam",
      {
        envelopeId: parsed.value.envelopeId,
        trustClass: sourceEnvelope.trustClass,
      },
    );
  }

  const sourceClaims: EvidenceClaim[] = [];
  for (const claimId of parsed.value.claimIds) {
    const claim = await deps.getClaim(claimId);
    if (!claim) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown evidence claim", {
        claimId,
      });
    }
    if (claim.evidenceId !== sourceEnvelope.id) {
      return err(
        ErrorCode.VALIDATION_FAILED,
        "Evidence claim does not belong to supplied envelope",
        { claimId, envelopeId: sourceEnvelope.id },
      );
    }
    sourceClaims.push(claim);
  }

  const submissionLike = {
    envelopes: [
      {
        id: sourceEnvelope.id,
        source: sourceEnvelope.source,
        contentHash: sourceEnvelope.contentHash,
        captureTime: sourceEnvelope.captureTime,
        ...(sourceEnvelope.eventTime
          ? { eventTime: sourceEnvelope.eventTime }
          : {}),
        ...(sourceEnvelope.freshnessDeadline
          ? { freshnessDeadline: sourceEnvelope.freshnessDeadline }
          : {}),
        ...(sourceEnvelope.mimeType ? { mimeType: sourceEnvelope.mimeType } : {}),
        ...(sourceEnvelope.lineageGroupId
          ? { lineageGroupId: sourceEnvelope.lineageGroupId }
          : {}),
        ...(sourceEnvelope.originId ? { originId: sourceEnvelope.originId } : {}),
      },
    ],
    claims: sourceClaims.map((claim) => ({
      id: claim.id,
      evidenceId: claim.evidenceId,
      concept: claim.concept,
      value: claim.value,
      confidence: claim.confidence,
    })),
    ...(parsed.value.lineage ? { lineage: parsed.value.lineage } : {}),
  };
  const lineage = await validateEvidenceSubmissionLineage(submissionLike, deps);
  if (!lineage.ok) return lineage;

  const verifiedEnvelopeId =
    parsed.value.verifiedEnvelopeId ??
    `${parsed.value.envelopeId}-verified-${parsed.value.verificationId}`;
  const verifiedOrigins = [
    ...sourceEnvelope.taint.origins,
    `verified-by:${callerEmail}`,
    `verification:${parsed.value.verificationId}`,
    `source-envelope:${sourceEnvelope.id}`,
  ].filter((value, index, all) => all.indexOf(value) === index);
  const verifiedEnvelope: EvidenceEnvelope = {
    ...sourceEnvelope,
    id: verifiedEnvelopeId as EvidenceEnvelope["id"],
    trustClass: TrustClass.ELEVATED_EXTERNAL,
    taint: {
      classes: [TaintClass.EXTERNAL_CONTENT],
      origins:
        verifiedOrigins as unknown as EvidenceEnvelope["taint"]["origins"],
    },
  };

  const verifiedClaims = sourceClaims.map((claim, index) => {
    const verifiedClaimId =
      parsed.value.verifiedClaimIds?.[index] ??
      `${claim.id}-verified-${parsed.value.verificationId}`;
    return {
      ...claim,
      id: verifiedClaimId as EvidenceClaim["id"],
      evidenceId: verifiedEnvelope.id,
      derivedBy: `verified-evidence:${parsed.value.verificationId}`,
      taint: {
        classes: [TaintClass.EXTERNAL_CONTENT],
        origins: [
          ...claim.taint.origins,
          `verified-by:${callerEmail}`,
          `source-claim:${claim.id}`,
        ].filter((value, i, all) => all.indexOf(value) === i) as unknown as EvidenceClaim["taint"]["origins"],
      },
    } satisfies EvidenceClaim;
  });

  return ok({
    verificationId: parsed.value.verificationId,
    envelope: verifiedEnvelope,
    claims: verifiedClaims,
    lineage: lineage.value,
  });
}

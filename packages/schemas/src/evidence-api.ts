import { z } from "zod";

const IdSchema = z.string().min(1);

export const PublicEvidenceSubmissionEnvelopeSchema = z
  .object({
    id: IdSchema,
    source: z.string().min(1),
    contentHash: z.string().min(1),
    captureTime: z.string().min(1),
    eventTime: z.string().min(1).optional(),
    freshnessDeadline: z.string().min(1).optional(),
    mimeType: z.string().min(1).optional(),
    lineageGroupId: z.string().min(1).optional(),
    originId: z.string().min(1).optional(),
  })
  .strict();

export const PublicEvidenceSubmissionClaimSchema = z
  .object({
    id: IdSchema,
    evidenceId: IdSchema,
    concept: z.string().min(1),
    value: z.unknown(),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const PublicEvidenceSubmissionLineageSchema = z
  .object({
    workflowId: IdSchema.optional(),
    intentId: IdSchema.optional(),
    intentStateId: IdSchema.optional(),
    outcomeContractId: IdSchema.optional(),
    proofObligationIds: z.array(IdSchema).min(1).optional(),
  })
  .strict();

export const PublicEvidenceSubmissionSchema = z
  .object({
    envelopes: z.array(PublicEvidenceSubmissionEnvelopeSchema).min(1),
    claims: z.array(PublicEvidenceSubmissionClaimSchema).default([]),
    lineage: PublicEvidenceSubmissionLineageSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const envelopeIds = new Set(value.envelopes.map((envelope) => envelope.id));
    for (const claim of value.claims) {
      if (!envelopeIds.has(claim.evidenceId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Claim evidenceId ${claim.evidenceId} is not present in envelopes`,
        });
      }
    }
    if (value.lineage?.proofObligationIds) {
      const unique = new Set(value.lineage.proofObligationIds);
      if (unique.size !== value.lineage.proofObligationIds.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "proofObligationIds must be unique",
        });
      }
    }
  });

export type PublicEvidenceSubmissionEnvelope = z.infer<
  typeof PublicEvidenceSubmissionEnvelopeSchema
>;
export type PublicEvidenceSubmissionClaim = z.infer<
  typeof PublicEvidenceSubmissionClaimSchema
>;
export type PublicEvidenceSubmissionLineage = z.infer<
  typeof PublicEvidenceSubmissionLineageSchema
>;
export type PublicEvidenceSubmission = z.infer<
  typeof PublicEvidenceSubmissionSchema
>;

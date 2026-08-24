import { z } from "zod";

/** Canonical kinds accepted by the intent/provenance semantic artifact owner. */
export const SemanticArtifactKindSchema = z.enum([
  "COMPILATION",
  "COMPILATION_VERIFICATION",
  "SEMANTIC_VERIFICATION",
  "PLAN",
  "PLAN_VERIFICATION",
  "PROOF",
  "ACTION",
  "GUARDIAN",
  "WORKFLOW",
  "EXECUTION_AUTHORIZATION",
]);

export type SemanticArtifactKind = z.infer<typeof SemanticArtifactKindSchema>;

/**
 * Internal-only workflow authorization handle. Public workflow APIs must never
 * expose this payload because it contains the opaque Gateway commit-token id.
 */
export const ExecutionAuthorizationArtifactPayloadSchema = z
  .object({
    intentStateId: z.string().min(1),
    intentStateHash: z.string().regex(/^[a-f0-9]{64}$/i),
    workflowId: z.string().min(1),
    packId: z.string().min(1),
    commitTokenId: z.string().min(1),
    preparedActionId: z.string().min(1),
    preparedActionHash: z.string().regex(/^[a-f0-9]{64}$/i),
    grantId: z.string().min(1),
    outcomeContractId: z.string().min(1),
    outcomeContractHash: z.string().regex(/^[a-f0-9]{64}$/i),
  })
  .strict();

export type ExecutionAuthorizationArtifactPayload = z.infer<
  typeof ExecutionAuthorizationArtifactPayloadSchema
>;

import { z } from "zod";
import { ActionProposalSchema } from "./objects.js";

const IdSchema = z.string().min(1);

export const WorkflowIntentReferenceInputSchema = z
  .object({
    kind: z.literal("REFERENCE"),
    intentId: IdSchema,
    expectedIntentStateId: IdSchema.optional(),
    expectedIntentStateHash: z.string().min(1).optional(),
  })
  .strict();

export const WorkflowIntentRawInputSchema = z
  .object({
    kind: z.literal("RAW"),
    principalId: IdSchema,
    rawText: z.string().min(1),
    id: IdSchema.optional(),
    createdAt: z.string().min(1).optional(),
  })
  .strict();

export const WorkflowIntentInputSchema = z.discriminatedUnion("kind", [
  WorkflowIntentReferenceInputSchema,
  WorkflowIntentRawInputSchema,
]);

export const WorkflowActionDraftSchema = ActionProposalSchema.omit({
  id: true,
  intentId: true,
  intentStateId: true,
  agentId: true,
  createdAt: true,
  planId: true,
  planStepId: true,
}).strict();

export const WorkflowDomainSelectionSchema = z
  .object({
    packId: IdSchema,
    payload: z.unknown(),
  })
  .strict();

export const GenericWorkflowRequestSchema = z
  .object({
    intent: WorkflowIntentInputSchema,
    action: WorkflowActionDraftSchema,
    domain: WorkflowDomainSelectionSchema,
    workflowId: IdSchema.optional(),
    adaptiveSubjectId: IdSchema.optional(),
    idempotencyKey: IdSchema,
  })
  .strict();

export const WorkflowApprovalResumeRequestSchema = z
  .object({
    workflowId: IdSchema,
    approvalId: IdSchema,
  })
  .strict();

export type WorkflowIntentReferenceInput = z.infer<
  typeof WorkflowIntentReferenceInputSchema
>;
export type WorkflowIntentRawInput = z.infer<typeof WorkflowIntentRawInputSchema>;
export type WorkflowIntentInput = z.infer<typeof WorkflowIntentInputSchema>;
export type WorkflowActionDraft = z.infer<typeof WorkflowActionDraftSchema>;
export type WorkflowDomainSelection = z.infer<
  typeof WorkflowDomainSelectionSchema
>;
export type GenericWorkflowRequest = z.infer<typeof GenericWorkflowRequestSchema>;
export type WorkflowApprovalResumeRequest = z.infer<
  typeof WorkflowApprovalResumeRequestSchema
>;

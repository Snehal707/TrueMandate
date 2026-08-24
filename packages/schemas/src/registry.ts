import { CoreProtocolSchemas } from "./objects.js";
import {
  PlanGraphSchema,
  PlanStepSchema,
  PlanVerificationResultSchema,
} from "./planning.js";
import {
  CandidateInterpretationSchema,
  SemanticVerificationResultSchema,
} from "./semantic.js";

/** Registry of all protocol object schemas for envelope validation. */
export const ProtocolSchemas = {
  ...CoreProtocolSchemas,
  PlanGraph: PlanGraphSchema,
  PlanStep: PlanStepSchema,
  CandidateInterpretation: CandidateInterpretationSchema,
  SemanticVerificationResult: SemanticVerificationResultSchema,
  PlanVerificationResult: PlanVerificationResultSchema,
} as const;

export type ProtocolSchemaName = keyof typeof ProtocolSchemas;

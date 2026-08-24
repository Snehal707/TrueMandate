import { z } from "zod";

export const SafeDomainSchema = z.enum([
  "procurement",
  "travel",
  "commerce",
  "subscriptions",
  "payments",
]);
export type SafeDomain = z.infer<typeof SafeDomainSchema>;

export const SafeClassificationSchema = z.enum(["benign", "adversarial"]);
export type SafeClassification = z.infer<typeof SafeClassificationSchema>;

export const SafeSeveritySchema = z.enum([
  "S0_INFORMATIONAL",
  "S1_LOW",
  "S2_MODERATE",
  "S3_HIGH",
  "S4_CRITICAL",
]);
export type SafeSeverity = z.infer<typeof SafeSeveritySchema>;

export const SafeFamilySchema = z.enum([
  "semantic",
  "authority",
  "injection",
  "execution",
  "outcome",
  "resolution",
  "benign",
]);
export type SafeFamily = z.infer<typeof SafeFamilySchema>;

export const ExpectedAuthoritySchema = z.enum([
  "ALLOW",
  "BLOCK",
  "REQUIRE_APPROVAL",
]);
export type ExpectedAuthority = z.infer<typeof ExpectedAuthoritySchema>;

export const ExpectedExecutionSchema = z.enum([
  "SUCCESS",
  "BLOCKED",
  "UNKNOWN",
  "NONE",
]);
export type ExpectedExecution = z.infer<typeof ExpectedExecutionSchema>;

export const ExpectedOutcomeSchema = z.enum([
  "SATISFIED",
  "PARTIAL",
  "BREACHED",
  "AT_RISK",
  "NONE",
  "AWAITING_OUTCOME",
]);
export type ExpectedOutcome = z.infer<typeof ExpectedOutcomeSchema>;

export const ExpectedResolutionSchema = z.enum([
  "OPEN",
  "NONE",
  "ESCALATED",
  "GATHERING_EVIDENCE",
  "ANALYZING",
  "REMEDY_PROPOSED",
  "AWAITING_AUTHORITY",
  "REMEDIATING",
  "VERIFYING_REMEDY",
  "RESOLVED",
  "CLOSED",
]);
export type ExpectedResolution = z.infer<typeof ExpectedResolutionSchema>;

export const SafeSplitSchema = z.enum([
  "golden",
  "development",
  "validation",
  "holdout",
]);
export type SafeSplit = z.infer<typeof SafeSplitSchema>;

export const ExpectedConstraintSchema = z.object({
  concept: z.string().min(1),
  criticality: z.enum(["OPTIONAL", "SOFT", "HARD", "SAFETY_CRITICAL"]),
  operator: z.string().optional(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  /** When true, the expected constraint is a negation (must NOT hold / must exclude). */
  negated: z.boolean().optional(),
});
export type ExpectedConstraint = z.infer<typeof ExpectedConstraintSchema>;

export const MutationOperatorSchema = z.enum([
  "drop_constraint",
  "reverse_negation",
  "weaken_numeric",
  "change_amount",
  "change_currency",
  "change_merchant",
  "change_deadline",
  "ships_vs_arrives",
  "inject_instruction",
  "stale_evidence",
  "replay_token",
  "split_payment",
  "change_prepared_field",
]);
export type MutationOperator = z.infer<typeof MutationOperatorSchema>;

export const ScenarioMutationMetaSchema = z.object({
  sourceScenarioId: z.string(),
  mutationOperator: MutationOperatorSchema,
  mutatedField: z.string(),
  originalValue: z.unknown().optional(),
  newValue: z.unknown().optional(),
  expectedSecurityConsequence: z.string(),
});
export type ScenarioMutationMeta = z.infer<typeof ScenarioMutationMetaSchema>;

/**
 * SAFE scenario DSL. `attackLabel` is evaluator-only — never send to SUT prompts.
 */
export const SafeScenarioSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  domain: SafeDomainSchema,
  classification: SafeClassificationSchema,
  severity: SafeSeveritySchema,
  family: SafeFamilySchema,
  rawIntent: z.string().min(1),
  expectedConstraints: z.array(ExpectedConstraintSchema),
  expectedAuthority: ExpectedAuthoritySchema,
  expectedExecution: ExpectedExecutionSchema,
  expectedOutcome: ExpectedOutcomeSchema,
  expectedResolution: ExpectedResolutionSchema,
  groundTruthFirstDivergence: z.string().optional(),
  /** When true, a successful resolution must restore the original human intent. */
  expectedIntentRestored: z.boolean().optional(),
  acceptableResponsibility: z.array(z.string()).default([]),
  reasonCodes: z.array(z.string()).default([]),
  mutations: z.array(MutationOperatorSchema).optional(),
  split: SafeSplitSchema,
  /** Evaluator-only. MUST NOT be forwarded to SystemUnderTest prompts. */
  attackLabel: z.string().optional(),
  environmentPublic: z.record(z.unknown()).optional(),
  sourceScenarioId: z.string().optional(),
  mutationOperator: MutationOperatorSchema.optional(),
  mutatedField: z.string().optional(),
  originalValue: z.unknown().optional(),
  newValue: z.unknown().optional(),
  expectedSecurityConsequence: z.string().optional(),
});
export type SafeScenario = z.infer<typeof SafeScenarioSchema>;

/** Strip evaluator-only fields before any SUT prompt construction. */
export function toSutPublicInput(scenario: SafeScenario): {
  readonly rawIntent: string;
  readonly environmentPublic: Record<string, unknown>;
} {
  return {
    rawIntent: scenario.rawIntent,
    environmentPublic: { ...(scenario.environmentPublic ?? {}) },
  };
}

import type { ActionProposal, IntentState, Result } from "@truemandate/protocol";
import type {
  ConceptFamily,
  ExecutionCriticalConceptRule,
} from "@truemandate/semantic-readiness";
import type { z } from "zod";

/**
 * DomainPack — domain-specific semantics only.
 *
 * A DomainPack MUST NOT contain a governance pipeline. It never receives
 * Authority, Gateway, or Outcome S2S clients. Privileged operations
 * (grant mint, CommitToken issuance, Gateway commit) remain exclusively
 * owned by GenericWorkflowEngine.
 */

/**
 * Common workflow-request fields required by every DomainPack input.
 * Domain-specific commercial fields are added by each pack's schema.
 */
export interface WorkflowRequestBase {
  readonly intentId: string;
  readonly workflowId?: string;
  readonly expectedIntentStateId?: string;
  readonly expectedIntentStateHash?: string;
  readonly adaptiveSubjectId?: string;
  readonly idempotencyKey: string;
  readonly approvalId?: string;
  /**
   * Evidence the caller references, never evidence the caller vouches for. Every
   * pack schema already declares this; the engine reads it to resolve which
   * envelopes are ALREADY trusted before the evidence-backed readiness handoff.
   */
  readonly evidenceIds?: readonly string[];
}

/** Engine-owned context for building ActionProposal business fields. */
export interface ActionProposalContext {
  readonly workflowId: string;
  readonly intentId: string;
  readonly intentStateId: string;
  readonly createdAt: string;
  readonly offerNodeId: string;
}

/**
 * Business fields of an ActionProposal. Structural fields
 * (id, intentId, intentStateId, agentId, createdAt, planId) stay engine-owned.
 */
export interface DomainActionFields {
  readonly capability: string;
  readonly merchant: string;
  readonly product: string;
  readonly quantity: number;
  readonly amount: number;
  readonly currency: string;
  readonly refundable?: boolean;
  readonly deliveryTerms?: string;
  readonly parameters: Record<string, unknown>;
  readonly consequenceLevel: "LOW" | "MEDIUM" | "HIGH";
}

export interface OfferNodeContext {
  readonly workflowId: string;
  readonly intentStateId: string;
  readonly offerHash: string;
}

export interface OutcomeContractContext {
  readonly workflowId: string;
  readonly intentId: string;
  readonly intentStateId: string;
}

export type PlanningPhaseIntent =
  | "VERIFY_OFFER"
  | "BIND_EVIDENCE"
  | "EXECUTE"
  | "VERIFY_OUTCOME";

export interface DomainPlanningDescriptor {
  readonly executionCapability: string;
  readonly executionLabel: string;
  readonly requiredPhases: readonly PlanningPhaseIntent[];
  readonly conceptFamilies: readonly ConceptFamily[];
  readonly executionCriticalConceptRules: readonly ExecutionCriticalConceptRule[];
  readonly offerBackedCanonicalConcepts: readonly string[];
}

export interface ActionFidelityRow {
  /**
   * Absent only for a fail-closed UNKNOWN row produced when no compiled
   * constraint resolves to this check's canonicalConcept at all — there is
   * no constraint to attribute the row to. See action-fidelity.ts.
   */
  readonly constraintId?: string;
  readonly canonicalConcept: string;
  readonly field: string;
  readonly expectedValue: unknown;
  readonly actualValue: unknown;
  readonly status: "MATCH" | "MISMATCH" | "UNKNOWN";
  readonly reason: string;
}

export interface ActionFidelityEvaluation {
  readonly rows: readonly ActionFidelityRow[];
  readonly preservesIntent: boolean;
}

/**
 * DomainPack provides only domain-specific semantics.
 * Governance (Guardian → Authority → Gateway → Outcome → Resolution)
 * is exclusively owned by GenericWorkflowEngine.
 */
export interface DomainPack<TInput extends WorkflowRequestBase> {
  readonly id: string;
  readonly requestSchema: z.ZodType<TInput>;
  readonly planning: DomainPlanningDescriptor;

  workflowId(input: TInput, intentStateHash: string): string;
  assertWorkflowId(input: TInput, intentStateHash: string): Result<string>;

  /**
   * Optional override for the EXECUTION idempotency identity the engine uses
   * for OutcomeContract / PreparedAction / Gateway / idempotencyStore /
   * side-effect-ledger keying -- distinct from workflowId (which stays keyed
   * on the caller's per-submission input.idempotencyKey so distinct
   * submission attempts keep distinct workflow records/provenance). Defaults
   * to input.idempotencyKey when a pack does not implement this -- unchanged
   * behavior for every domain that doesn't need a business-identity-bound
   * execution key.
   */
  resolveExecutionIdempotencyKey?(input: TInput): string;

  /**
   * Server-owned inputs for this pack's DETERMINISTIC_RULE-mechanism
   * constraints (see ExecutionCriticalConceptRule), keyed by ruleId. Computed
   * ONLY from the already-parsed, server-validated workflow input -- MUST
   * NEVER echo or forward a caller-supplied "satisfied"/boolean claim. Only
   * raw identity/binding data that evaluateDeterministicRule will
   * independently re-derive and check belongs here. Absent for packs with no
   * DETERMINISTIC_RULE constraints.
   */
  buildDeterministicRuleInputs?(input: TInput): Readonly<Record<string, Readonly<Record<string, unknown>>>>;

  /**
   * Server-side evaluator for one of this pack's DETERMINISTIC_RULE-mechanism
   * constraints, called by PreExecutionReadinessService -- never by a
   * caller-facing route directly. Must fail closed to UNKNOWN on a missing,
   * malformed, or unrecognized ruleId/inputs, and must never return SATISFIED
   * merely because some input value is present -- it must independently
   * derive the canonical identity itself and compare.
   */
  evaluateDeterministicRule?(
    ruleId: string,
    inputs: Readonly<Record<string, unknown>> | undefined,
  ): { readonly status: "SATISFIED" | "UNSATISFIED" | "UNKNOWN"; readonly reason: string };

  buildActionProposal(input: TInput, ctx: ActionProposalContext): DomainActionFields;

  /**
   * Deterministic action fidelity: compares the current ActionProposal against
   * the authoritative IntentState for domain-critical execution fields only.
   * Proof completeness remains separate and is evaluated from the authoritative
   * proof snapshot.
   */
  evaluateActionFidelity(
    input: TInput,
    state: IntentState,
    action: ActionProposal,
  ): ActionFidelityEvaluation;

  buildExternalOfferNode(
    input: TInput,
    ctx: OfferNodeContext,
  ): { readonly label: string; readonly metadata: Record<string, unknown> };

  /**
   * Commercial fields for OutcomeContract creation. The engine still owns
   * the S2S call; the pack only supplies domain-shaped commercial inputs.
   */
  buildOutcomeContractInput(
    input: TInput,
    ctx: OutcomeContractContext,
  ): {
    readonly merchant: string;
    readonly quantity: number;
    readonly budgetMax: number;
    readonly product?: string;
    readonly domain: string;
    readonly parameters?: Record<string, unknown>;
  };
}

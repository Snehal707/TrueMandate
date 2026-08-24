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
  readonly constraintId: string;
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

import {
  asRemedyProposalId,
  type OutcomeContract,
  type RemedyProposal,
  type RemedyType,
  type ResolutionCaseId,
} from "@truemandate/protocol";
import { assertIndependentRemedyAuthority } from "@truemandate/authority";

export interface RemedyOption {
  readonly kind: RemedyType;
  readonly description: string;
  readonly requiresFinancialAction: boolean;
  readonly financialCost: number;
  readonly expectedRecoveryValue: number;
  readonly restoresCriticalRequirements: boolean;
  readonly currency?: string;
}

/**
 * Rank remedies by intent restoration, not refund amount.
 * Critical requirement restoration dominates.
 */
export function rankRemedies(
  options: readonly RemedyOption[],
): readonly RemedyOption[] {
  return [...options].sort((a, b) => {
    if (a.restoresCriticalRequirements !== b.restoresCriticalRequirements) {
      return a.restoresCriticalRequirements ? -1 : 1;
    }
    return b.expectedRecoveryValue - a.expectedRecoveryValue;
  });
}

export function proposeProcurementRemedies(input: {
  readonly contract: OutcomeContract;
  readonly caseId: ResolutionCaseId;
  readonly now: string;
  readonly altSupplierExtraCost?: number;
  readonly altSupplierBeforeDeadline?: boolean;
}): readonly RemedyProposal[] {
  const qty = input.contract.requirements.find(
    (r) => r.concept === "quantity_received",
  );
  const food = input.contract.requirements.find((r) => r.concept === "food_grade");
  const options: RemedyOption[] = [];

  if (qty && (qty.state === "PARTIAL" || qty.state === "BREACHED")) {
    const missing =
      typeof qty.value === "number"
        ? Math.max(0, qty.value - 450) // diagnostic default shortfall context
        : 50;
    options.push({
      kind: "REPLACEMENT",
      description: `Obtain remaining ~${missing} units before deadline`,
      requiresFinancialAction: true,
      financialCost: input.altSupplierExtraCost ?? 6000,
      expectedRecoveryValue: 20000,
      restoresCriticalRequirements: true,
      currency: "INR",
    });
    options.push({
      kind: "REFUND",
      description: "Partial refund for shortfall",
      requiresFinancialAction: true,
      financialCost: 0,
      expectedRecoveryValue: 5000,
      restoresCriticalRequirements: false,
      currency: "INR",
    });
  }
  if (food?.state === "BREACHED") {
    options.push({
      kind: "REPLACEMENT",
      description: "Replace with food-grade certified units (hard constraint)",
      requiresFinancialAction: true,
      financialCost: 50000,
      expectedRecoveryValue: 80000,
      restoresCriticalRequirements: true,
      currency: "INR",
    });
    // Soft refund alone must not rank as complete for SAFETY_CRITICAL
    options.push({
      kind: "REFUND",
      description: "Keep industrial goods + small refund",
      requiresFinancialAction: true,
      financialCost: 0,
      expectedRecoveryValue: 1000,
      restoresCriticalRequirements: false,
      currency: "INR",
    });
  }
  if (input.contract.state === "AT_RISK") {
    options.push({
      kind: "EVIDENCE",
      description: "Investigate carrier ETA / alternate fulfillment (read-only)",
      requiresFinancialAction: false,
      financialCost: 0,
      expectedRecoveryValue: 5000,
      restoresCriticalRequirements: false,
    });
  }

  const ranked = rankRemedies(options);
  return ranked.map((o, i) => ({
    id: asRemedyProposalId(`remedy-${input.caseId}-${i}`),
    resolutionCaseId: input.caseId,
    description: o.description,
    requiresFinancialAction: o.requiresFinancialAction,
    estimatedAmount: o.financialCost,
    financialCost: o.financialCost,
    expectedRecoveryValue: o.expectedRecoveryValue,
    currency: o.currency,
    createdAt: input.now,
    // Deterministic taxonomy (Wave 3.6) — the exact same value already
    // computed above as `o.kind`, now exposed as a first-class field
    // instead of only being embedded in proposedActions[0].
    remedyType: o.kind,
    reversibility: o.kind === "EVIDENCE" ? "HIGH" : "MEDIUM",
    proposedActions: [o.kind],
  }));
}

export { assertIndependentRemedyAuthority };

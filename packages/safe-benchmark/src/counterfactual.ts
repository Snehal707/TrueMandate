import type { SafeScenario } from "./scenario-schema.js";

/**
 * Counterfactual: tighten budget and update expected authority when amount exceeds.
 */
export function applyBudgetCounterfactual(
  scenario: SafeScenario,
  newBudget: number,
): SafeScenario {
  const amount =
    typeof scenario.environmentPublic?.amount === "number"
      ? scenario.environmentPublic.amount
      : undefined;
  const overBudget = amount !== undefined && amount > newBudget;
  return {
    ...scenario,
    id: `${scenario.id}__cf_budget_${newBudget}`,
    environmentPublic: {
      ...(scenario.environmentPublic ?? {}),
      budget: newBudget,
    },
    expectedAuthority: overBudget ? "BLOCK" : scenario.expectedAuthority,
    expectedSecurityConsequence: overBudget
      ? "BLOCK_BUDGET_COUNTERFACTUAL"
      : scenario.expectedSecurityConsequence,
    reasonCodes: overBudget
      ? [...scenario.reasonCodes, "BUDGET_COUNTERFACTUAL"]
      : scenario.reasonCodes,
  };
}

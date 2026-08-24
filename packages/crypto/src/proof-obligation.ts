import { hashCanonical } from "./hash.js";

/** Sole canonical identity for immutable PlanGraph proof obligations. */
export function proofObligationId(obligation: unknown): string {
  return String(hashCanonical(obligation));
}

import { AuthorityDecision, type CapabilityScope } from "@truemandate/protocol";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  capabilityDecisionRank,
  isCapabilityScopeSubset,
} from "./capability-subset.js";

const decisions = [
  AuthorityDecision.BLOCK,
  AuthorityDecision.REQUIRE_APPROVAL,
  AuthorityDecision.ALLOW_WITH_MONITORING,
  AuthorityDecision.ALLOW,
] as const;

const decisionArb = fc.constantFrom(...decisions);
const capNameArb = fc.constantFrom(
  "search",
  "compare",
  "execute_payment",
  "compensate",
  "reserve",
);

function scopeArb(): fc.Arbitrary<CapabilityScope> {
  return fc.record({
    capabilities: fc.dictionary(capNameArb, decisionArb, { maxKeys: 5 }),
    maxAmount: fc.option(fc.integer({ min: 0, max: 1_000_000 }), { nil: undefined }),
    currency: fc.option(fc.constantFrom("INR", "USD", "EUR"), { nil: undefined }),
    allowedMerchants: fc.option(
      fc.uniqueArray(fc.constantFrom("a", "b", "c", "d"), { maxLength: 4 }),
      { nil: undefined },
    ),
    deniedMerchants: fc.option(
      fc.uniqueArray(fc.constantFrom("x", "y", "z"), { maxLength: 3 }),
      { nil: undefined },
    ),
    allowedCategories: fc.option(
      fc.uniqueArray(fc.constantFrom("containers", "food", "tools"), { maxLength: 3 }),
      { nil: undefined },
    ),
    resourceScope: fc.option(
      fc.uniqueArray(fc.constantFrom("procurement", "logistics"), { maxLength: 2 }),
      { nil: undefined },
    ),
    expiresAt: fc.option(
      fc.constantFrom(
        "2026-06-01T00:00:00.000Z",
        "2026-12-01T00:00:00.000Z",
        "2027-01-01T00:00:00.000Z",
      ),
      { nil: undefined },
    ),
    maxDelegationDepth: fc.option(fc.integer({ min: 0, max: 5 }), { nil: undefined }),
  });
}

function isAllowListOk(
  child: readonly string[] | undefined,
  parent: readonly string[] | undefined,
): boolean {
  if (parent !== undefined && child === undefined) return false;
  if (child === undefined || parent === undefined) return true;
  const set = new Set(parent);
  return child.every((x) => set.has(x));
}

function oracleSubset(child: CapabilityScope, parent: CapabilityScope): boolean {
  for (const [name, childDecision] of Object.entries(child.capabilities)) {
    if (childDecision === undefined) continue;
    const parentDecision = parent.capabilities[name] ?? AuthorityDecision.BLOCK;
    if (capabilityDecisionRank(childDecision) > capabilityDecisionRank(parentDecision)) {
      return false;
    }
  }
  if (parent.maxAmount !== undefined && child.maxAmount === undefined) return false;
  if (
    child.maxAmount !== undefined &&
    (parent.maxAmount === undefined || child.maxAmount > parent.maxAmount)
  ) {
    return false;
  }
  if (parent.currency !== undefined && child.currency === undefined) return false;
  if (
    child.currency !== undefined &&
    parent.currency !== undefined &&
    child.currency !== parent.currency
  ) {
    return false;
  }
  if (!isAllowListOk(child.allowedMerchants, parent.allowedMerchants)) return false;
  if (!isAllowListOk(child.allowedCategories, parent.allowedCategories)) return false;
  if (!isAllowListOk(child.resourceScope, parent.resourceScope)) return false;
  const parentDenied = parent.deniedMerchants ?? [];
  const childDenied = new Set(child.deniedMerchants ?? []);
  if (!parentDenied.every((d) => childDenied.has(d))) return false;
  if (parent.expiresAt !== undefined && child.expiresAt === undefined) return false;
  if (
    child.expiresAt !== undefined &&
    parent.expiresAt !== undefined &&
    Date.parse(child.expiresAt) > Date.parse(parent.expiresAt)
  ) {
    return false;
  }
  if (parent.maxDelegationDepth !== undefined && child.maxDelegationDepth === undefined) {
    return false;
  }
  if (
    child.maxDelegationDepth !== undefined &&
    (parent.maxDelegationDepth === undefined ||
      child.maxDelegationDepth > parent.maxDelegationDepth)
  ) {
    return false;
  }
  return true;
}

describe("INV_002 property: accepted delegation implies real subset", () => {
  it("holds for random parent/child pairs", () => {
    fc.assert(
      fc.property(scopeArb(), scopeArb(), (parent, child) => {
        const result = isCapabilityScopeSubset(child, parent);
        if (result.ok) {
          expect(oracleSubset(child, parent)).toBe(true);
        } else {
          expect(oracleSubset(child, parent)).toBe(false);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it("always rejects dropping child maxAmount under capped parent", () => {
    fc.assert(
      fc.property(scopeArb(), (parentBase) => {
        const parent: CapabilityScope = { ...parentBase, maxAmount: 50000 };
        const { maxAmount: _drop, ...child } = parent;
        expect(isCapabilityScopeSubset(child, parent).ok).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});

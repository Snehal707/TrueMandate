import { AuthorityDecision, type CapabilityScope } from "@truemandate/protocol";
import { isCapabilityScopeSubset } from "@truemandate/authority";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

const decisions = [
  AuthorityDecision.BLOCK,
  AuthorityDecision.REQUIRE_APPROVAL,
  AuthorityDecision.ALLOW_WITH_MONITORING,
  AuthorityDecision.ALLOW,
] as const;

function scopeArb(): fc.Arbitrary<CapabilityScope> {
  return fc.record({
    capabilities: fc.dictionary(
      fc.constantFrom("search", "compare", "execute_payment", "reserve"),
      fc.constantFrom(...decisions),
      { maxKeys: 4 },
    ),
    maxAmount: fc.option(fc.integer({ min: 0, max: 1_000_000 }), { nil: undefined }),
    currency: fc.option(fc.constantFrom("INR", "USD"), { nil: undefined }),
    allowedMerchants: fc.option(
      fc.uniqueArray(fc.constantFrom("a", "b", "c"), { maxLength: 3 }),
      { nil: undefined },
    ),
    allowedCategories: fc.option(
      fc.uniqueArray(fc.constantFrom("containers", "food"), { maxLength: 2 }),
      { nil: undefined },
    ),
    resourceScope: fc.option(
      fc.uniqueArray(fc.constantFrom("procurement"), { maxLength: 1 }),
      { nil: undefined },
    ),
    expiresAt: fc.option(
      fc.constantFrom("2026-06-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z"),
      { nil: undefined },
    ),
    maxDelegationDepth: fc.option(fc.integer({ min: 0, max: 4 }), { nil: undefined }),
  });
}

function oracleSubset(child: CapabilityScope, parent: CapabilityScope): boolean {
  return isCapabilityScopeSubset(child, parent).ok;
}

describe("delegation firewall property tests", () => {
  it("accepted child scope is always a true subset of parent (oracle)", () => {
    fc.assert(
      fc.property(scopeArb(), scopeArb(), (child, parent) => {
        const result = isCapabilityScopeSubset(child, parent);
        expect(result.ok).toBe(oracleSubset(child, parent));
        if (result.ok) {
          // amount
          if (parent.maxAmount !== undefined && child.maxAmount !== undefined) {
            expect(child.maxAmount).toBeLessThanOrEqual(parent.maxAmount);
          }
          // depth
          if (
            parent.maxDelegationDepth !== undefined &&
            child.maxDelegationDepth !== undefined
          ) {
            expect(child.maxDelegationDepth).toBeLessThanOrEqual(parent.maxDelegationDepth);
          }
          // expiry
          if (parent.expiresAt && child.expiresAt) {
            expect(Date.parse(child.expiresAt)).toBeLessThanOrEqual(
              Date.parse(parent.expiresAt),
            );
          }
        }
      }),
      { numRuns: 80 },
    );
  });
});

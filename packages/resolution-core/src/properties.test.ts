import {
  OutcomeContractState,
  ResolutionCaseState,
  asAuthorityGrantId,
  asRemediationMandateId,
  asRemedyProposalId,
  asResolutionCaseId,
} from "@truemandate/protocol";
import { assertIndependentRemedyAuthority } from "@truemandate/authority";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RESOLUTION_BOUNDS,
  assertWithinBounds,
} from "./bounds.js";
import { assertResolutionTransition } from "./transitions.js";

const STATES = Object.values(ResolutionCaseState);

describe("resolution-core property tests", () => {
  it("property: only legal transitions succeed", () => {
    const legal = new Set([
      "OPEN→GATHERING_EVIDENCE",
      "OPEN→ANALYZING",
      "OPEN→ESCALATED",
      "OPEN→CLOSED",
      "GATHERING_EVIDENCE→ANALYZING",
      "GATHERING_EVIDENCE→REMEDY_PROPOSED",
      "GATHERING_EVIDENCE→ESCALATED",
      "ANALYZING→GATHERING_EVIDENCE",
      "ANALYZING→REMEDY_PROPOSED",
      "ANALYZING→AWAITING_AUTHORITY",
      "ANALYZING→ESCALATED",
      "REMEDY_PROPOSED→AWAITING_AUTHORITY",
      "REMEDY_PROPOSED→REMEDIATING",
      "REMEDY_PROPOSED→ESCALATED",
      "AWAITING_AUTHORITY→REMEDIATING",
      "AWAITING_AUTHORITY→ESCALATED",
      "AWAITING_AUTHORITY→CLOSED",
      "REMEDIATING→VERIFYING_REMEDY",
      "REMEDIATING→ESCALATED",
      "VERIFYING_REMEDY→RESOLVED",
      "VERIFYING_REMEDY→REMEDY_PROPOSED",
      "VERIFYING_REMEDY→ESCALATED",
      "RESOLVED→CLOSED",
      "ESCALATED→CLOSED",
    ]);
    fc.assert(
      fc.property(fc.constantFrom(...STATES), fc.constantFrom(...STATES), (from, to) => {
        const r = assertResolutionTransition(from, to);
        if (from === to) {
          expect(r.ok).toBe(true);
          return;
        }
        expect(r.ok).toBe(legal.has(`${from}→${to}`));
      }),
      { numRuns: 100 },
    );
  });

  it("property: original grant never funds financial remedy", () => {
    fc.assert(
      fc.property(fc.uuid(), (grant) => {
        const g = asAuthorityGrantId(grant);
        const r = assertIndependentRemedyAuthority(
          {
            id: asRemedyProposalId("r1"),
            resolutionCaseId: asResolutionCaseId("c1"),
            description: "refund",
            requiresFinancialAction: true,
            requiredRemediationMandateId: asRemediationMandateId(grant),
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          g,
        );
        expect(r.ok).toBe(false);
      }),
      { numRuns: 20 },
    );
  });

  it("property: recursion depth beyond max fails closed", () => {
    fc.assert(
      fc.property(
        fc.integer({
          min: DEFAULT_RESOLUTION_BOUNDS.maxRecursionDepth + 1,
          max: 20,
        }),
        (depth) => {
          const r = assertWithinBounds(DEFAULT_RESOLUTION_BOUNDS, {
            remedyAttempts: 0,
            economicExposure: 0,
            recursionDepth: depth,
            evidenceRequests: 0,
          });
          expect(r.ok).toBe(false);
        },
      ),
      { numRuns: 10 },
    );
  });

  it("property: remediative exposure above max fails closed", () => {
    const r = assertWithinBounds(DEFAULT_RESOLUTION_BOUNDS, {
      remedyAttempts: 0,
      economicExposure: DEFAULT_RESOLUTION_BOUNDS.maxEconomicExposure + 1,
      recursionDepth: 0,
      evidenceRequests: 0,
    });
    expect(r.ok).toBe(false);
  });

  it("SATISFIED is not reachable from tool SUCCESS alone (state machine)", () => {
    // Tool SUCCESS lands in VERIFYING_REMEDY; RESOLVED requires separate hop
    const toVerify = assertResolutionTransition(
      ResolutionCaseState.REMEDIATING,
      ResolutionCaseState.VERIFYING_REMEDY,
    );
    const skipResolve = assertResolutionTransition(
      ResolutionCaseState.REMEDIATING,
      ResolutionCaseState.RESOLVED,
    );
    expect(toVerify.ok).toBe(true);
    expect(skipResolve.ok).toBe(false);
    void OutcomeContractState.SATISFIED;
  });
});

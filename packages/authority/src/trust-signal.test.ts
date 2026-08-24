import {
  AuthorityDecision,
  ConstraintKind,
  ErrorCode,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { makeConstraint, makeParentScope } from "./fixtures.js";
import {
  assertReputationCannotOverridePolicy,
  assertTrustSignalCannotOverrideAuthorityDecision,
  assertTrustSignalCannotWeakenConstraint,
  parseTrustSignal,
} from "./trust-signal.js";

const NOW = "2026-06-04T12:00:00.000Z";

describe("INV_026 TrustSignal contract", () => {
  it("parses a well-formed TrustSignal", () => {
    const parsed = parseTrustSignal({
      subjectType: "COUNTERPARTY",
      subjectId: "supplier-a",
      domain: "procurement",
      value: 0.82,
      sampleSize: 12,
      basis: ["partial_fulfillment_rate"],
      computedAt: NOW,
    });
    expect(parsed.ok).toBe(true);
  });

  it("rejects TrustSignal value outside 0..1", () => {
    const parsed = parseTrustSignal({
      subjectType: "AGENT",
      subjectId: "agent-1",
      domain: "procurement",
      value: 1.5,
      sampleSize: 1,
      basis: [],
      computedAt: NOW,
    });
    expect(parsed.ok).toBe(false);
  });
});

describe("INV_026 assertTrustSignalCannotWeakenConstraint", () => {
  it("allows attempted override of SOFT / PREFERENCE", () => {
    const soft = makeConstraint({
      id: "c-soft",
      concept: "preferred_vendor",
      kind: ConstraintKind.SOFT,
    });
    expect(assertTrustSignalCannotWeakenConstraint(soft, true).ok).toBe(true);
    const pref = makeConstraint({
      id: "c-pref",
      concept: "refundable",
      kind: ConstraintKind.PREFERENCE,
    });
    expect(assertTrustSignalCannotWeakenConstraint(pref, true).ok).toBe(true);
  });

  it("blocks attempted override of sticky policy kinds", () => {
    for (const kind of [
      ConstraintKind.HARD,
      ConstraintKind.SAFETY_CRITICAL,
      ConstraintKind.LEGAL,
      ConstraintKind.ORGANIZATIONAL_POLICY,
    ] as const) {
      const c = makeConstraint({ id: `c-${kind}`, concept: kind, kind });
      const result = assertTrustSignalCannotWeakenConstraint(c, true);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(ErrorCode.REPUTATION_CANNOT_OVERRIDE_POLICY);
      }
    }
  });

  it("allows sticky constraints when attemptedOverride is false", () => {
    const hard = makeConstraint({
      id: "c-hard",
      concept: "food_grade",
      kind: ConstraintKind.HARD,
    });
    expect(assertTrustSignalCannotWeakenConstraint(hard, false).ok).toBe(true);
  });
});

describe("INV_026 assertTrustSignalCannotOverrideAuthorityDecision", () => {
  it("allows equal or more restrictive decisions", () => {
    expect(
      assertTrustSignalCannotOverrideAuthorityDecision(
        AuthorityDecision.ALLOW,
        AuthorityDecision.ALLOW,
      ).ok,
    ).toBe(true);
    expect(
      assertTrustSignalCannotOverrideAuthorityDecision(
        AuthorityDecision.ALLOW,
        AuthorityDecision.REQUIRE_APPROVAL,
      ).ok,
    ).toBe(true);
    expect(
      assertTrustSignalCannotOverrideAuthorityDecision(
        AuthorityDecision.REQUIRE_APPROVAL,
        AuthorityDecision.BLOCK,
      ).ok,
    ).toBe(true);
  });

  it("blocks more permissive decisions", () => {
    const fromBlock = assertTrustSignalCannotOverrideAuthorityDecision(
      AuthorityDecision.BLOCK,
      AuthorityDecision.ALLOW,
    );
    expect(fromBlock.ok).toBe(false);
    if (!fromBlock.ok) {
      expect(fromBlock.code).toBe(ErrorCode.REPUTATION_CANNOT_OVERRIDE_POLICY);
    }
    const fromApproval = assertTrustSignalCannotOverrideAuthorityDecision(
      AuthorityDecision.REQUIRE_APPROVAL,
      AuthorityDecision.ALLOW,
    );
    expect(fromApproval.ok).toBe(false);
  });
});

describe("INV_026 assertReputationCannotOverridePolicy umbrella", () => {
  it("blocks sticky constraint override via umbrella", () => {
    const hard = makeConstraint({
      id: "c-hard",
      concept: "food_grade",
      kind: ConstraintKind.HARD,
    });
    const result = assertReputationCannotOverridePolicy({
      constraint: { constraint: hard, attemptedOverride: true },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ErrorCode.REPUTATION_CANNOT_OVERRIDE_POLICY);
    }
  });

  it("blocks capability expansion via umbrella", () => {
    const current = makeParentScope();
    const expanded = { ...current, maxAmount: (current.maxAmount ?? 0) + 1_000_000 };
    const result = assertReputationCannotOverridePolicy({
      currentScope: current,
      proposedScope: expanded,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ErrorCode.REPUTATION_CANNOT_OVERRIDE_POLICY);
    }
  });

  it("allows narrowing scope and more restrictive decision", () => {
    const current = makeParentScope();
    const narrower = {
      ...current,
      maxAmount: Math.max(1, (current.maxAmount ?? 1000) - 100),
    };
    const result = assertReputationCannotOverridePolicy({
      decision: {
        baseline: AuthorityDecision.ALLOW,
        proposed: AuthorityDecision.REQUIRE_APPROVAL,
      },
      currentScope: current,
      proposedScope: narrower,
    });
    expect(result.ok).toBe(true);
  });
});

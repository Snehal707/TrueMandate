import { ErrorCode, AuthorityDecision, GrantConsumptionState } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { isCapabilityScopeSubset } from "./capability-subset.js";
import { evaluateCumulativeExposure } from "./exposure.js";
import {
  FUTURE,
  LATER,
  PAST,
  makeGrant,
  makeIntent,
  makeIntentState,
  makeParentScope,
  makePrepared,
  NOW,
} from "./fixtures.js";
import { validateGrantForExecution } from "./grant.js";
import { createIntentState } from "./intent-state.js";
import { asIntentStateId } from "@truemandate/protocol";

describe("INV_002 child authority cannot exceed parent", () => {
  it("allows equal or narrower child scope", () => {
    const parent = makeParentScope();
    const child = {
      ...parent,
      maxAmount: 100000,
      allowedMerchants: ["approved-a"],
      capabilities: {
        search: AuthorityDecision.ALLOW,
        execute_payment: AuthorityDecision.REQUIRE_APPROVAL,
      },
    };
    expect(isCapabilityScopeSubset(child, parent).ok).toBe(true);
  });

  it("blocks higher maxAmount", () => {
    const parent = makeParentScope();
    const child = { ...parent, maxAmount: 900000 };
    const result = isCapabilityScopeSubset(child, parent);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.CHILD_AUTHORITY_EXCEEDS_PARENT);
  });

  it("blocks elevating capability from REQUIRE_APPROVAL to ALLOW", () => {
    const parent = makeParentScope();
    const child = {
      ...parent,
      capabilities: {
        ...parent.capabilities,
        compensate: AuthorityDecision.ALLOW,
      },
    };
    const result = isCapabilityScopeSubset(child, parent);
    expect(result.ok).toBe(false);
  });

  it("blocks longer expiry and deeper delegation", () => {
    const parent = makeParentScope();
    const child = {
      ...parent,
      expiresAt: "2099-01-01T00:00:00.000Z",
      maxDelegationDepth: 5,
    };
    expect(isCapabilityScopeSubset(child, parent).ok).toBe(false);
  });

  it("blocks missing child maxAmount when parent is capped", () => {
    const parent = makeParentScope();
    const { maxAmount: _drop, ...child } = parent;
    expect(isCapabilityScopeSubset(child, parent).ok).toBe(false);
  });

  it("blocks missing child expiresAt when parent expires", () => {
    const parent = makeParentScope();
    const { expiresAt: _drop, ...child } = parent;
    expect(isCapabilityScopeSubset(child, parent).ok).toBe(false);
  });

  it("blocks missing child currency when parent fixes currency", () => {
    const parent = makeParentScope();
    const { currency: _drop, ...child } = parent;
    expect(isCapabilityScopeSubset(child, parent).ok).toBe(false);
  });

  it("blocks missing child allowedMerchants when parent is restricted", () => {
    const parent = makeParentScope();
    const { allowedMerchants: _drop, ...child } = parent;
    expect(isCapabilityScopeSubset(child, parent).ok).toBe(false);
  });

  it("allows empty child allow-list as narrower", () => {
    const parent = makeParentScope();
    const child = { ...parent, allowedMerchants: [] };
    expect(isCapabilityScopeSubset(child, parent).ok).toBe(true);
  });

  it("blocks missing maxDelegationDepth when parent is capped", () => {
    const parent = makeParentScope();
    const { maxDelegationDepth: _drop, ...child } = parent;
    expect(isCapabilityScopeSubset(child, parent).ok).toBe(false);
  });
});

describe("INV_006 expired grants cannot execute", () => {
  it("allows active non-expired grant", () => {
    const intent = makeIntent();
    const state = makeIntentState(intent, []);
    const prepared = makePrepared(intent, state);
    const grant = makeGrant(state, prepared, { expiresAt: FUTURE });
    expect(
      validateGrantForExecution(grant, {
        now: NOW,
        currentIntentState: state,
        preparedAction: prepared,
      }).ok,
    ).toBe(true);
  });

  it("blocks expired grant", () => {
    const intent = makeIntent();
    const state = makeIntentState(intent, []);
    const prepared = makePrepared(intent, state);
    const grant = makeGrant(state, prepared, { expiresAt: PAST });
    const result = validateGrantForExecution(grant, {
      now: NOW,
      currentIntentState: state,
      preparedAction: prepared,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.GRANT_EXPIRED);
  });
});

describe("INV_007 consumed grants cannot be replayed", () => {
  it("blocks consumed grant", () => {
    const intent = makeIntent();
    const state = makeIntentState(intent, []);
    const prepared = makePrepared(intent, state);
    const grant = makeGrant(state, prepared, {
      consumptionState: GrantConsumptionState.CONSUMED,
      consumedAt: LATER,
    });
    const result = validateGrantForExecution(grant, {
      now: LATER,
      currentIntentState: state,
      preparedAction: prepared,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.GRANT_CONSUMED);
  });
});

describe("stale IntentState makes grant unusable", () => {
  it("blocks grant tied to earlier state after tip advances", () => {
    const intent = makeIntent();
    const state1 = makeIntentState(intent, [], "state-1", 1);
    const prepared = makePrepared(intent, state1);
    const grant = makeGrant(state1, prepared);
    const state2 = createIntentState({
      id: asIntentStateId("state-2"),
      intent,
      version: 2,
      constraints: [],
      createdAt: LATER,
      createdBy: intent.principalId,
      previousStateId: state1.id,
    });
    expect(state2.ok).toBe(true);
    if (!state2.ok) return;
    const result = validateGrantForExecution(grant, {
      now: LATER,
      currentIntentState: state2.value,
      preparedAction: prepared,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.GRANT_INTENT_STATE_MISMATCH);
  });
});

describe("INV_014 cumulative related exposure", () => {
  it("allows exposure under threshold", () => {
    const result = evaluateCumulativeExposure({
      threshold: 50000,
      currency: "INR",
      relatedGroupId: "salami-1",
      proposedAmount: 9000,
      entries: [
        { id: "1", amount: 9000, currency: "INR", relatedGroupId: "salami-1", status: "COMMITTED" },
        { id: "2", amount: 9000, currency: "INR", relatedGroupId: "salami-1", status: "APPROVED" },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.projected).toBe(27000);
  });

  it("blocks salami attack exceeding threshold", () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      id: String(i),
      amount: 9000,
      currency: "INR",
      relatedGroupId: "salami-1",
      status: "COMMITTED" as const,
    }));
    const result = evaluateCumulativeExposure({
      threshold: 50000,
      currency: "INR",
      relatedGroupId: "salami-1",
      proposedAmount: 9000,
      entries,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.CUMULATIVE_EXPOSURE_EXCEEDED);
  });
});

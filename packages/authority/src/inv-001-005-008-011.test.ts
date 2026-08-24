import {
  ErrorCode,
  ConstraintKind,
  asConstraintId,
  asHashDigest,
  asIntentStateId,
  asLearningProposalId,
  LearningStatus,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import {
  LATER,
  makeConstraint,
  makeIntent,
  makeIntentState,
  makeParentScope,
  NOW,
} from "./fixtures.js";
import {
  applyLearningProposal,
  assertLearningCannotExpandAuthority,
  createLearningProposal,
} from "./learning.js";
import {
  createIntentState,
  rejectRawIntentMutation,
  transitionIntentState,
} from "./intent-state.js";
import { assertStickyConstraintsPreserved } from "./sticky-constraints.js";
import { bindGrantToIntentState } from "./grant.js";
import { makeGrant, makePrepared } from "./fixtures.js";

describe("INV_001 raw human intent is immutable", () => {
  it("allows creating IntentState bound to immutable Intent hash", () => {
    const intent = makeIntent();
    const state = makeIntentState(intent, [
      makeConstraint({ id: asConstraintId("c1"), concept: "food_grade", kind: ConstraintKind.HARD }),
    ]);
    expect(state.rawIntentHash).toBe(intent.contentHash);
  });

  it("blocks in-place rawIntent mutation", () => {
    const intent = makeIntent();
    const result = rejectRawIntentMutation(intent, "Buy industrial containers");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.RAW_INTENT_IMMUTABLE);
  });

  it("blocks transition when contentHash changes for same Intent id", () => {
    const intent = makeIntent();
    const state = makeIntentState(intent, []);
    const tampered = { ...intent, contentHash: makeIntent("changed").contentHash };
    const next = transitionIntentState(state, tampered, {
      id: asIntentStateId("state-2"),
      constraints: [],
      createdAt: LATER,
      createdBy: intent.principalId,
    });
    expect(next.ok).toBe(false);
    if (!next.ok) expect(next.code).toBe(ErrorCode.RAW_INTENT_IMMUTABLE);
  });
});

describe("INV_005 critical constraints cannot disappear", () => {
  it("allows sticky constraint preservation", () => {
    const sticky = makeConstraint({
      id: asConstraintId("food"),
      concept: "food_grade",
      kind: ConstraintKind.SAFETY_CRITICAL,
    });
    const result = assertStickyConstraintsPreserved([sticky], [sticky]);
    expect(result.ok).toBe(true);
  });

  it("blocks silent sticky constraint removal", () => {
    const sticky = makeConstraint({
      id: asConstraintId("food"),
      concept: "food_grade",
      kind: ConstraintKind.HARD,
    });
    const result = assertStickyConstraintsPreserved([sticky], []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.CRITICAL_CONSTRAINT_MISSING);
  });

  it("allows removal only with explicit authorization", () => {
    const sticky = makeConstraint({
      id: asConstraintId("food"),
      concept: "food_grade",
      kind: ConstraintKind.LEGAL,
    });
    const result = assertStickyConstraintsPreserved([sticky], [], {
      authorizedRemovedIds: [sticky.id],
    });
    expect(result.ok).toBe(true);
  });
});

describe("INV_008 authority bound to one IntentState", () => {
  it("allows grant matching IntentState", () => {
    const intent = makeIntent();
    const state = makeIntentState(intent, []);
    const prepared = makePrepared(intent, state);
    const grant = makeGrant(state, prepared);
    expect(bindGrantToIntentState(grant, state).ok).toBe(true);
  });

  it("blocks grant against a different IntentState", () => {
    const intent = makeIntent();
    const state1 = makeIntentState(intent, [], "state-1", 1);
    const state2Result = createIntentState({
      id: asIntentStateId("state-2"),
      intent,
      version: 2,
      constraints: [],
      createdAt: LATER,
      createdBy: intent.principalId,
      previousStateId: state1.id,
    });
    expect(state2Result.ok).toBe(true);
    if (!state2Result.ok) return;
    const prepared = makePrepared(intent, state1);
    const grant = makeGrant(state1, prepared);
    const result = bindGrantToIntentState(grant, state2Result.value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.GRANT_INTENT_STATE_MISMATCH);
  });
});

describe("INV_011 learning cannot rewrite historical intent", () => {
  it("blocks learning that targets historical intent", () => {
    const intent = makeIntent();
    const state = makeIntentState(intent, []);
    const created = createLearningProposal({
      draft: {
        id: "learn-1",
        principalId: intent.principalId,
        domain: "procurement",
        proposalType: "USER_PREFERENCE",
        content: { prefer: "approved-a" },
        createdAt: NOW,
        targetIntentId: intent.id,
      },
      historicalIntent: intent,
      historicalState: state,
    });
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.code).toBe(ErrorCode.LEARNING_CANNOT_REWRITE_INTENT);
  });

  it("also blocks applyLearningProposal when targetIntentId matches", () => {
    const intent = makeIntent();
    const state = makeIntentState(intent, []);
    // Construct a proposal-shaped object for the narrow guard (status path).
    const proposal = {
      id: asLearningProposalId("learn-1"),
      principalId: intent.principalId,
      domain: "procurement",
      proposalType: "USER_PREFERENCE" as const,
      content: { prefer: "approved-a" },
      status: LearningStatus.PROPOSED,
      createdAt: NOW,
      targetIntentId: intent.id,
      requiresConfirmation: true,
      contentHash: asHashDigest("deadbeef"),
    };
    const result = applyLearningProposal(proposal, intent, state);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.LEARNING_CANNOT_REWRITE_INTENT);
  });
});

describe("INV_015 critical failures cannot expand authority", () => {
  it("allows narrowing via learning", () => {
    const parent = makeParentScope();
    const narrower = {
      ...parent,
      maxAmount: 100000,
      capabilities: { ...parent.capabilities, execute_payment: "REQUIRE_APPROVAL" as const },
    };
    expect(assertLearningCannotExpandAuthority(parent, narrower).ok).toBe(true);
  });

  it("blocks expansion of maxAmount", () => {
    const parent = makeParentScope();
    const expanded = { ...parent, maxAmount: 9_000_000 };
    const result = assertLearningCannotExpandAuthority(parent, expanded);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ErrorCode.CRITICAL_FAILURE_CANNOT_EXPAND_AUTHORITY);
    }
  });
});

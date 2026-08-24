import { describe, expect, it } from "vitest";
import { ApprovalDecision, ApprovalEventType, ApprovalRequestStatus, ErrorCode } from "@truemandate/protocol";
import {
  assertApprovalScopeMatchesEvaluation,
  createApprovalRequest,
  decideApproval,
  expireIfPast,
  parseApprovalRequest,
  requestedEvent,
  supersedePending,
} from "./approval-request.js";

const HASH = "a".repeat(64);
const HASH2 = "b".repeat(64);

function evaluation(overrides: Partial<Parameters<typeof createApprovalRequest>[0]["evaluation"]> = {}) {
  return {
    decision: "REQUIRE_APPROVAL",
    capability: "execute_payment",
    merchant: "supplier-a",
    amount: 742000,
    currency: "INR",
    evaluatedIntentState: { id: "state-1", hash: HASH },
    ...overrides,
  };
}

function draft(overrides: Partial<Parameters<typeof createApprovalRequest>[0]["draft"]> = {}) {
  return {
    id: "approval-wf-1",
    workflowId: "wf-1",
    intentId: "intent-1",
    intentStateId: "state-1",
    intentStateHash: HASH,
    authorityEvaluationId: "evaluation-1",
    requestedCapability: "execute_payment",
    requestedScope: { amount: 742000, currency: "INR", merchant: "supplier-a" },
    requestedAt: "2030-01-01T00:00:00.000Z",
    expiresAt: "2030-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function create(overrides: Partial<Parameters<typeof createApprovalRequest>[0]["draft"]> = {}) {
  const result = createApprovalRequest({ draft: draft(overrides), evaluation: evaluation() });
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.value;
}

describe("createApprovalRequest", () => {
  it("creates a PENDING request only from a REQUIRE_APPROVAL evaluation", () => {
    const result = createApprovalRequest({ draft: draft(), evaluation: evaluation() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe(ApprovalRequestStatus.PENDING);
    expect(result.value.decidedBy).toBeUndefined();
    expect(result.value.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects a non-REQUIRE_APPROVAL evaluation", () => {
    const result = createApprovalRequest({ draft: draft(), evaluation: evaluation({ decision: "ALLOW" }) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.APPROVAL_REQUIRED);
  });

  it("cannot bind a different IntentState than the evaluated one", () => {
    const result = createApprovalRequest({ draft: draft({ intentStateId: "state-2" }), evaluation: evaluation() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.APPROVAL_STALE_INTENT_STATE);
  });

  it("cannot widen scope: amount, currency, merchant, capability", () => {
    for (const [key, value] of [
      ["requestedScope", { amount: 742001, currency: "INR", merchant: "supplier-a" }],
      ["requestedScope", { amount: 742000, currency: "USD", merchant: "supplier-a" }],
      ["requestedScope", { amount: 742000, currency: "INR", merchant: "supplier-b" }],
      ["requestedCapability", "refund_purchase"],
    ] as const) {
      const result = createApprovalRequest({
        draft: draft({ [key]: value } as Partial<Parameters<typeof createApprovalRequest>[0]["draft"]>),
        evaluation: evaluation(),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe(ErrorCode.APPROVAL_SCOPE_MISMATCH);
    }
  });

  it("rejects an expiry that does not follow the request time", () => {
    const result = createApprovalRequest({ draft: draft({ expiresAt: "2030-01-01T00:00:00.000Z" }), evaluation: evaluation() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.VALIDATION_FAILED);
  });
});

describe("parseApprovalRequest", () => {
  it("accepts a canonical request and rejects tampering", () => {
    const request = create();
    expect(parseApprovalRequest(request).ok).toBe(true);
    const tampered = { ...request, requestedScope: { ...request.requestedScope, amount: 1 } };
    const parsed = parseApprovalRequest(tampered);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.code).toBe(ErrorCode.VALIDATION_FAILED);
  });
});

describe("requestedEvent", () => {
  it("emits APPROVAL_REQUESTED with a deterministic dedupe key", () => {
    const request = create();
    const event = requestedEvent(request, { eventId: "e-1", at: "2030-01-01T00:00:00.000Z" });
    expect(event.ok).toBe(true);
    if (!event.ok) return;
    expect(event.value.type).toBe(ApprovalEventType.APPROVAL_REQUESTED);
    expect(event.value.dedupeKey).toBe(`approval_requested:${request.id}`);
  });
});

describe("expireIfPast", () => {
  it("transitions a PENDING request past expiry to EXPIRED with an event", () => {
    const request = create();
    const result = expireIfPast(request, { eventId: "e-exp", at: "2030-01-03T00:00:00.000Z" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.updated?.status).toBe(ApprovalRequestStatus.EXPIRED);
    expect(result.value.event?.type).toBe(ApprovalEventType.APPROVAL_EXPIRED);
  });

  it("leaves a PENDING request before expiry untouched", () => {
    const request = create();
    const result = expireIfPast(request, { eventId: "e-exp", at: "2030-01-01T12:00:00.000Z" });
    expect(result.ok && result.value.updated === undefined && result.value.event === undefined).toBe(true);
  });

  it("never transitions a decided request", () => {
    const request = create();
    const decided = decideApproval(request, { decision: ApprovalDecision.APPROVE, decidedBy: "human@example.com", at: "2030-01-01T06:00:00.000Z", eventId: "e-d", currentIntentStateHash: HASH });
    if (!decided.ok) throw new Error(decided.message);
    const result = expireIfPast(decided.value.updated, { eventId: "e-exp", at: "2030-01-03T00:00:00.000Z" });
    expect(result.ok && result.value.updated === undefined).toBe(true);
  });
});

describe("decideApproval", () => {
  it("APPROVE sets decidedBy from the supplied (verified) identity and is terminal", () => {
    const request = create();
    const decided = decideApproval(request, { decision: ApprovalDecision.APPROVE, decidedBy: "human@example.com", at: "2030-01-01T06:00:00.000Z", eventId: "e-d", currentIntentStateHash: HASH });
    expect(decided.ok).toBe(true);
    if (!decided.ok) return;
    expect(decided.value.updated.status).toBe(ApprovalRequestStatus.APPROVED);
    expect(decided.value.updated.decidedBy).toBe("human@example.com");
    expect(decided.value.event.type).toBe(ApprovalEventType.APPROVED);
    expect(decided.value.event.actor).toBe("human@example.com");
    const replay = decideApproval(decided.value.updated, { decision: ApprovalDecision.APPROVE, decidedBy: "human@example.com", at: "2030-01-01T07:00:00.000Z", eventId: "e-d2", currentIntentStateHash: HASH });
    expect(replay.ok).toBe(false);
    if (replay.ok) return;
    expect(replay.code).toBe(ErrorCode.APPROVAL_NOT_PENDING);
  });

  it("REJECT is terminal and fails closed", () => {
    const request = create();
    const rejected = decideApproval(request, { decision: ApprovalDecision.DENY, decidedBy: "human@example.com", at: "2030-01-01T06:00:00.000Z", eventId: "e-d", currentIntentStateHash: HASH });
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;
    expect(rejected.value.updated.status).toBe(ApprovalRequestStatus.REJECTED);
    expect(rejected.value.event.type).toBe(ApprovalEventType.REJECTED);
    const approveAfter = decideApproval(rejected.value.updated, { decision: ApprovalDecision.APPROVE, decidedBy: "human@example.com", at: "2030-01-01T07:00:00.000Z", eventId: "e-d2", currentIntentStateHash: HASH });
    expect(approveAfter.ok).toBe(false);
  });

  it("cannot approve past expiry", () => {
    const request = create();
    const result = decideApproval(request, { decision: ApprovalDecision.APPROVE, decidedBy: "human@example.com", at: "2030-01-03T00:00:00.000Z", eventId: "e-d", currentIntentStateHash: HASH });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.APPROVAL_EXPIRED);
  });

  it("cannot approve a superseded request", () => {
    const request = create();
    const superseded = supersedePending(request, { supersededBy: "approval-wf-1-b", eventId: "e-s", at: "2030-01-01T01:00:00.000Z" });
    if (!superseded.ok || !superseded.value.updated) throw new Error("supersession failed");
    const result = decideApproval(superseded.value.updated, { decision: ApprovalDecision.APPROVE, decidedBy: "human@example.com", at: "2030-01-01T06:00:00.000Z", eventId: "e-d", currentIntentStateHash: HASH });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.APPROVAL_SUPERSEDED);
  });

  it("cannot approve against a moved IntentState (fresh tip hash mismatch)", () => {
    const request = create();
    const result = decideApproval(request, { decision: ApprovalDecision.APPROVE, decidedBy: "human@example.com", at: "2030-01-01T06:00:00.000Z", eventId: "e-d", currentIntentStateHash: HASH2 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.APPROVAL_STALE_INTENT_STATE);
  });
});

describe("supersedePending", () => {
  it("transitions only PENDING requests with a supersession event", () => {
    const request = create();
    const result = supersedePending(request, { supersededBy: "approval-new", eventId: "e-s", at: "2030-01-01T01:00:00.000Z" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.updated?.status).toBe(ApprovalRequestStatus.SUPERSEDED);
    expect(result.value.updated?.supersededBy).toBe("approval-new");
    expect(result.value.event?.type).toBe(ApprovalEventType.APPROVAL_SUPERSEDED);
    const decided = decideApproval(request, { decision: ApprovalDecision.APPROVE, decidedBy: "human@example.com", at: "2030-01-01T02:00:00.000Z", eventId: "e-d", currentIntentStateHash: HASH });
    if (!decided.ok) throw new Error(decided.message);
    const again = supersedePending(decided.value.updated, { supersededBy: "approval-new", eventId: "e-s2", at: "2030-01-01T03:00:00.000Z" });
    expect(again.ok && again.value.updated === undefined).toBe(true);
  });
});

describe("assertApprovalScopeMatchesEvaluation", () => {
  it("passes for the exact evaluated scope and fails on any drift", () => {
    const request = create();
    expect(assertApprovalScopeMatchesEvaluation(request, evaluation()).ok).toBe(true);
    const amountDrift = assertApprovalScopeMatchesEvaluation(request, evaluation({ amount: 742001 }));
    expect(amountDrift.ok).toBe(false);
    if (amountDrift.ok) return;
    expect(amountDrift.code).toBe(ErrorCode.APPROVAL_SCOPE_MISMATCH);
    const merchantDrift = assertApprovalScopeMatchesEvaluation(request, evaluation({ merchant: "supplier-b" }));
    expect(merchantDrift.ok).toBe(false);
    if (merchantDrift.ok) return;
    expect(merchantDrift.code).toBe(ErrorCode.APPROVAL_SCOPE_MISMATCH);
    const capabilityDrift = assertApprovalScopeMatchesEvaluation(request, evaluation({ capability: "refund_purchase" }));
    expect(capabilityDrift.ok).toBe(false);
    if (capabilityDrift.ok) return;
    expect(capabilityDrift.code).toBe(ErrorCode.APPROVAL_SCOPE_MISMATCH);
  });
});

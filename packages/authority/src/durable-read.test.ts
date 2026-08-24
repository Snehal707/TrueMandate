import { makeCommitToken, makeConstraint, makeGrant, makeIntent, makeIntentState, makePrepared, parseAuthorityGrant, parseCommitToken, parsePreparedActionRecord } from "@truemandate/authority";
import { ConstraintKind } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";

function fixture() {
  const intent = makeIntent();
  const state = makeIntentState(intent, [makeConstraint({ id: "food", concept: "food_grade", kind: ConstraintKind.HARD })]);
  const prepared = makePrepared(intent, state);
  const grant = makeGrant(state, prepared);
  const token = makeCommitToken(grant, prepared);
  return { prepared, grant, token, record: { preparedAction: prepared, action: { id: prepared.actionId, intentId: prepared.intentId, intentStateId: prepared.intentStateId, agentId: prepared.agentId, capability: prepared.capability, parameters: {}, consequenceLevel: "HIGH", createdAt: prepared.createdAt }, verdict: { id: "guardian", actionId: prepared.actionId, intentId: prepared.intentId, intentStateId: prepared.intentStateId, intentStateHash: state.stateHash, actionContentHash: "0".repeat(64), evidenceSnapshotHash: "0".repeat(64), decision: "ALLOW", semanticStatus: "CLEAR", overallFidelity: 1, constraintClaims: [], contradictions: [], uncertainty: 0, criticalFailure: false, judgeResults: [], protocolVersion: "1", promptVersions: {}, schemaVersions: {}, stale: false, createdAt: prepared.createdAt, verdictHash: "0".repeat(64) }, externalStateSnapshot: {}, lifecycle: "PREPARED", version: 1, createdAt: prepared.createdAt, updatedAt: prepared.createdAt } };
}

describe("durable authoritative record parsers", () => {
  it("accepts schema-valid canonical records and rejects missing/tampered shapes", () => {
    const f = fixture();
    expect(parsePreparedActionRecord(f.record).ok).toBe(true);
    expect(parseAuthorityGrant(f.grant).ok).toBe(true);
    expect(parseCommitToken(f.token).ok).toBe(true);
    expect(parsePreparedActionRecord({ ...f.record, preparedAction: { ...f.prepared, authorityScope: { capabilities: {} } } }).ok).toBe(false);
    expect(parseAuthorityGrant({ ...f.grant, scope: undefined }).ok).toBe(false);
    expect(parseCommitToken({ ...f.token, preparedActionHash: undefined }).ok).toBe(false);
  });

  it.each([
    ["PreparedAction full hash", (f: ReturnType<typeof fixture>) => ({ ...f.record, preparedAction: { ...f.prepared, preparedActionHash: "f".repeat(64) } })],
    ["PreparedAction scope", (f: ReturnType<typeof fixture>) => ({ ...f.record, preparedAction: { ...f.prepared, authorityScope: { capabilities: { execute_payment: "ALLOW" }, maxAmount: 1 } } })],
    ["PreparedAction expiry", (f: ReturnType<typeof fixture>) => ({ ...f.record, preparedAction: { ...f.prepared, expiresAt: "2031-01-01T00:00:00.000Z" } })],
  ])("fails closed for tampered %s durable rows", (_name, mutate) => {
    expect(parsePreparedActionRecord(mutate(fixture())).ok).toBe(false);
  });

  it.each([
    ["missing Grant scope", (f: ReturnType<typeof fixture>) => ({ ...f.grant, scope: undefined })],
    ["malformed Grant expiry", (f: ReturnType<typeof fixture>) => ({ ...f.grant, expiresAt: "not-a-time" })],
    ["missing CommitToken hash", (f: ReturnType<typeof fixture>) => ({ ...f.token, tokenHash: undefined })],
    ["tampered CommitToken hash", (f: ReturnType<typeof fixture>) => ({ ...f.token, tokenHash: "f".repeat(64) })],
    ["tampered CommitToken lineage", (f: ReturnType<typeof fixture>) => ({ ...f.token, grantId: "other-grant" })],
  ])("fails closed for malformed or tampered durable %s", (_name, mutate) => {
    const f = fixture();
    const value = mutate(f);
    const parsed = "grant" in value && "consumptionState" in value
      ? parseAuthorityGrant(value)
      : "tokenHash" in value || "grantId" in value && "consumed" in value
        ? parseCommitToken(value)
        : parsePreparedActionRecord(value);
    expect(parsed.ok).toBe(false);
  });
});

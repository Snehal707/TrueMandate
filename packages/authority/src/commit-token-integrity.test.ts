import {
  makeCommitToken,
  makeConstraint,
  makeGrant,
  makeIntent,
  makeIntentState,
  makePrepared,
} from "./fixtures.js";
import { assertCommitTokenIntegrity, commitTokenHash } from "./commit-token-integrity.js";
import { parseCommitToken } from "./durable-read.js";
import { ConstraintKind } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";

function validToken() {
  const intent = makeIntent();
  const state = makeIntentState(intent, [makeConstraint({ id: "food", concept: "food_grade", kind: ConstraintKind.HARD })]);
  const prepared = makePrepared(intent, state);
  return makeCommitToken(makeGrant(state, prepared), prepared);
}

describe("CommitToken immutable integrity", () => {
  it("issues a deterministic canonical digest over immutable bindings only", () => {
    const token = validToken();
    expect(token.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(commitTokenHash(token)).toBe(token.tokenHash);
    expect(commitTokenHash({ ...token, consumed: true })).toBe(token.tokenHash);
  });

  it("builds a schema-valid token bound to the supplied grant and PreparedAction", () => {
    const intent = makeIntent();
    const state = makeIntentState(intent, [makeConstraint({ id: "food", concept: "food_grade", kind: ConstraintKind.HARD })]);
    const prepared = makePrepared(intent, state);
    const grant = makeGrant(state, prepared);
    const token = makeCommitToken(grant, prepared);

    expect(parseCommitToken(token).ok).toBe(true);
    expect(assertCommitTokenIntegrity(token).ok).toBe(true);
    expect(token.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(token.grantId).toBe(grant.id);
    expect(token.preparedActionId).toBe(prepared.id);
    expect(token.preparedActionHash).toBe(prepared.preparedActionHash);
  });

  it("preserves the issuance hash when the fixture marks a token consumed", () => {
    const intent = makeIntent();
    const state = makeIntentState(intent, [makeConstraint({ id: "food", concept: "food_grade", kind: ConstraintKind.HARD })]);
    const prepared = makePrepared(intent, state);
    const grant = makeGrant(state, prepared);
    const issued = makeCommitToken(grant, prepared);
    const consumed = makeCommitToken(grant, prepared, { consumed: true });

    expect(consumed.tokenHash).toBe(issued.tokenHash);
    expect(assertCommitTokenIntegrity(consumed).ok).toBe(true);
  });

  it.each([
    ["grant", (token: ReturnType<typeof validToken>) => ({ ...token, grantId: "grant-other" as never })],
    ["prepared action id", (token: ReturnType<typeof validToken>) => ({ ...token, preparedActionId: "prepared-other" as never })],
    ["prepared action hash", (token: ReturnType<typeof validToken>) => ({ ...token, preparedActionHash: "f".repeat(64) as never })],
    ["nonce", (token: ReturnType<typeof validToken>) => ({ ...token, nonce: "nonce-other" as never })],
    ["expiry", (token: ReturnType<typeof validToken>) => ({ ...token, expiresAt: "2031-01-01T00:00:00.000Z" })],
    ["intent state", (token: ReturnType<typeof validToken>) => ({ ...token, intentStateHash: "e".repeat(64) as never })],
    ["agent", (token: ReturnType<typeof validToken>) => ({ ...token, agentId: "agent-other" as never })],
    ["capability", (token: ReturnType<typeof validToken>) => ({ ...token, capability: "search" })],
  ])("rejects a tampered immutable %s binding", (_name, mutate) => {
    expect(assertCommitTokenIntegrity(mutate(validToken()) as ReturnType<typeof validToken>).ok).toBe(false);
  });

  it.each([
    ["missing token hash", (token: ReturnType<typeof validToken>) => ({ ...token, tokenHash: undefined })],
    ["malformed token hash", (token: ReturnType<typeof validToken>) => ({ ...token, tokenHash: "not-a-digest" })],
    ["malformed prepared hash", (token: ReturnType<typeof validToken>) => ({ ...token, preparedActionHash: "not-a-digest" })],
  ])("fails strict parsing for %s", (_name, mutate) => {
    expect(parseCommitToken(mutate(validToken())).ok).toBe(false);
  });
});

import {
  PreferenceOrigin,
  PreferenceRecordStatus,
  asHashDigest,
  asLearningProposalId,
  asPreferenceRecordId,
  asPrincipalId,
  type PreferenceRecord,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { resolveSupersession } from "./supersession.js";

function makeRecord(
  overrides: Partial<PreferenceRecord> &
    Pick<PreferenceRecord, "id" | "origin" | "status">,
): PreferenceRecord {
  return {
    subjectId: "principal:a@example.com",
    domain: "TRAVEL",
    concept: "refundable",
    value: true,
    sourceLearningProposalId: asLearningProposalId("lp-1"),
    createdAt: "2026-08-21T12:00:00.000Z",
    confirmedAt: "2026-08-21T12:00:00.000Z",
    confirmedBy: asPrincipalId("a@example.com"),
    contentHash: asHashDigest("a".repeat(64)),
    ...overrides,
    id: asPreferenceRecordId(overrides.id),
  };
}

describe("resolveSupersession", () => {
  it("activates when no existing active preference", () => {
    const incoming = makeRecord({
      id: "pref-1",
      origin: PreferenceOrigin.CONFIRMED_LEARNING,
      status: PreferenceRecordStatus.ACTIVE,
    });
    const decision = resolveSupersession(undefined, incoming);
    expect(decision.activate).toBe(true);
    expect(decision.incoming.status).toBe(PreferenceRecordStatus.ACTIVE);
    expect(decision.previous).toBeUndefined();
  });

  it("explicit always supersedes existing (any origin)", () => {
    const existing = makeRecord({
      id: "pref-old",
      origin: PreferenceOrigin.CONFIRMED_LEARNING,
      status: PreferenceRecordStatus.ACTIVE,
    });
    const incoming = makeRecord({
      id: "pref-new",
      origin: PreferenceOrigin.EXPLICIT_USER_INPUT,
      status: PreferenceRecordStatus.ACTIVE,
      value: false,
    });
    const decision = resolveSupersession(existing, incoming);
    expect(decision.activate).toBe(true);
    expect(decision.incoming.supersedesId).toBe(existing.id);
    expect(decision.previous?.status).toBe(PreferenceRecordStatus.SUPERSEDED);
    expect(decision.previous?.supersededById).toBe(decision.incoming.id);
  });

  it("newer learned supersedes older learned", () => {
    const existing = makeRecord({
      id: "pref-old",
      origin: PreferenceOrigin.CONFIRMED_LEARNING,
      status: PreferenceRecordStatus.ACTIVE,
    });
    const incoming = makeRecord({
      id: "pref-new",
      origin: PreferenceOrigin.CONFIRMED_LEARNING,
      status: PreferenceRecordStatus.ACTIVE,
      value: "window-seat",
    });
    const decision = resolveSupersession(existing, incoming);
    expect(decision.activate).toBe(true);
    expect(decision.incoming.supersedesId).toBe(existing.id);
  });

  it("learned never silently overrides active explicit (stored SUPERSEDED)", () => {
    const existing = makeRecord({
      id: "pref-explicit",
      origin: PreferenceOrigin.EXPLICIT_USER_INPUT,
      status: PreferenceRecordStatus.ACTIVE,
    });
    const incoming = makeRecord({
      id: "pref-learned",
      origin: PreferenceOrigin.CONFIRMED_LEARNING,
      status: PreferenceRecordStatus.ACTIVE,
    });
    const decision = resolveSupersession(existing, incoming);
    expect(decision.activate).toBe(false);
    expect(decision.incoming.status).toBe(PreferenceRecordStatus.SUPERSEDED);
    expect(decision.incoming.supersededById).toBe(existing.id);
    expect(decision.previous).toBeUndefined();
  });
});

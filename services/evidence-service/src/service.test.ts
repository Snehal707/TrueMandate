import { describe, expect, it } from "vitest";
import { hashCanonical } from "@truemandate/crypto";
import { EvidenceService } from "./service.js";

const envelope = {
  id: "phase-a-evidence-replay", source: "fixture", contentHash: hashCanonical({ fixture: true }),
  trustClass: "UNTRUSTED_EXTERNAL", captureTime: "2030-01-01T00:00:00.000Z",
  taint: { classes: ["EXTERNAL_CONTENT"], origins: ["fixture"] },
};

const claim = {
  id: "phase-a-evidence-claim-replay",
  evidenceId: envelope.id,
  concept: "food_grade",
  value: true,
  confidence: 1,
  derivedBy: "evidence-judge",
  taint: { classes: ["EXTERNAL_CONTENT"], origins: ["fixture"] },
};

function repository(rows = new Map<string, unknown>()) {
  return {
    rows,
    get: async (id: string) => rows.get(id),
    putIfAbsent: async (id: string, value: unknown) => {
      if (rows.has(id)) return false;
      rows.set(id, value);
      return true;
    },
  };
}

describe("immutable evidence replay", () => {
  it("persists envelopes and supports canonical replay from a fresh service", async () => {
    const repo = repository();
    expect((await new EvidenceService().persistEnvelope(envelope, repo)).ok).toBe(true);

    const replay = new EvidenceService();
    expect((await replay.persistEnvelope(envelope, repo)).ok).toBe(true);
    expect((await replay.getEnvelope(envelope.id)).ok).toBe(true);
    expect((await replay.persistEnvelope({ ...envelope, source: "changed" }, repo)).ok).toBe(false);
  });

  it("persists claims and rejects divergent or malformed durable rows", async () => {
    const envelopeRepository = repository();
    const claimRepository = repository();
    const service = new EvidenceService();
    expect((await service.persistEnvelope(envelope, envelopeRepository)).ok).toBe(true);
    expect((await service.persistClaim(claim, claimRepository)).ok).toBe(true);

    const replay = new EvidenceService();
    expect((await replay.persistClaim(claim, claimRepository)).ok).toBe(true);
    expect((await replay.getClaim(claim.id)).ok).toBe(true);
    expect((await replay.persistClaim({ ...claim, value: false }, claimRepository)).ok).toBe(false);

    const malformedEnvelopes = repository(new Map([[envelope.id, { id: envelope.id }]]));
    const malformedClaims = repository(new Map([[claim.id, { id: claim.id }]]));
    expect((await new EvidenceService().persistEnvelope(envelope, malformedEnvelopes)).ok).toBe(false);
    expect((await new EvidenceService().persistClaim(claim, malformedClaims)).ok).toBe(false);
  });
});

describe("durable evidence read-through", () => {
  it("reads an envelope that only exists in the durable repository (fresh process)", async () => {
    const durableEnvelopes = new Map<string, unknown>([[envelope.id, envelope]]);
    const service = new EvidenceService({ envelopes: { get: async (id) => durableEnvelopes.get(id) } });
    const read = await service.getEnvelope(envelope.id);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.contentHash).toBe(envelope.contentHash);
    // Mirrored: a second read no longer needs the durable row.
    durableEnvelopes.clear();
    expect((await service.getEnvelope(envelope.id)).ok).toBe(true);
  });

  it("reads a claim that only exists in the durable repository (fresh process)", async () => {
    const durableClaims = new Map<string, unknown>([[claim.id, claim]]);
    const service = new EvidenceService({ claims: { get: async (id) => durableClaims.get(id) } });
    const read = await service.getClaim(claim.id);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.concept).toBe("food_grade");
  });

  it("fails closed on unknown ids and malformed durable rows", async () => {
    const malformed = new Map<string, unknown>([[envelope.id, { id: envelope.id }]]);
    const service = new EvidenceService({ envelopes: { get: async (id) => malformed.get(id) } });
    expect((await service.getEnvelope(envelope.id)).ok).toBe(false);
    expect((await service.getEnvelope("unknown-id")).ok).toBe(false);
  });

  it("never fabricates a read when no durable port is configured", async () => {
    const service = new EvidenceService();
    expect((await service.getEnvelope(envelope.id)).ok).toBe(false);
    expect((await service.getClaim(claim.id)).ok).toBe(false);
  });
});

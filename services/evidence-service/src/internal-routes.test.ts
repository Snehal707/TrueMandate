import { hashCanonical } from "@truemandate/crypto";
import type { Result } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { composeEvidenceReaderEmails, createEvidenceInternalRoutes, type AcceptanceFixtureWriter } from "./internal-routes.js";
import { EvidenceService } from "./service.js";

const PA_CALLER = "phase-a@test.iam.gserviceaccount.com";
const PB_CALLER = "phase-b@test.iam.gserviceaccount.com";
const PA_WRITER: AcceptanceFixtureWriter = { email: PA_CALLER, idPrefix: "phase-a-" };
const PB_WRITER: AcceptanceFixtureWriter = { email: PB_CALLER, idPrefix: "phase-b-" };

const makeEnvelope = (id: string, fact: Record<string, unknown> = { fixture: id }) => ({
  id,
  source: "acceptance-fixture",
  contentHash: hashCanonical(fact),
  trustClass: "UNTRUSTED_EXTERNAL" as const,
  captureTime: "2030-01-01T00:00:00.000Z",
  taint: { classes: ["EXTERNAL_CONTENT" as const], origins: ["acceptance-fixture"] },
  originId: "acceptance-fixture",
  lineageGroupId: "acceptance-source",
});

const makeClaim = (id: string, evidenceId: string) => ({
  id,
  evidenceId,
  concept: "fixture-fact",
  value: { fixture: true },
  confidence: 1,
  derivedBy: "acceptance-fixture",
  taint: { classes: ["EXTERNAL_CONTENT" as const], origins: ["acceptance-fixture"] },
});

const fixtureBody = (ids: string[], claims: { id: string; evidenceId: string }[] = []) => ({
  envelopes: ids.map((id) => makeEnvelope(id)),
  claims: claims.map((c) => makeClaim(c.id, c.evidenceId)),
});

interface FixtureOwner {
  getEnvelope: () => Promise<undefined>;
  getClaim: () => Promise<undefined>;
  persistFixture: (fixture: unknown) => Promise<Result<unknown>>;
}

const makeOwner = (calls: { persist: number } = { persist: 0 }): FixtureOwner => ({
  getEnvelope: async () => undefined,
  getClaim: async () => undefined,
  persistFixture: async () => { calls.persist += 1; return { ok: true, value: { ok: true } }; },
});

const routeFor = (owner: FixtureOwner, writers: readonly AcceptanceFixtureWriter[]) => {
  const routes = createEvidenceInternalRoutes(owner, writers);
  const fixture = routes.find((route) => route.pattern === "/internal/evidence/acceptance-fixtures");
  expect(fixture).toBeDefined();
  return fixture!;
};

describe("evidence owner acceptance fixture boundary", () => {
  it("exposes fixture persistence only to the configured verifier identities", async () => {
    const calls = { persist: 0 };
    const fixture = routeFor(makeOwner(calls), [PA_WRITER, PB_WRITER]);
    expect(fixture.allowedCallers).toEqual([PA_CALLER, PB_CALLER]);
    const res = await fixture.handler({ params: {}, headers: {}, caller: { email: PA_CALLER }, body: fixtureBody(["phase-a-evidence-1"]) });
    expect(res.status).toBe(200);
    expect(calls.persist).toBe(1);
  });

  it("does not register the write route without an explicitly configured verifier", () => {
    const routes = createEvidenceInternalRoutes({ getEnvelope: async () => undefined, getClaim: async () => undefined });
    expect(routes.some((route) => route.pattern === "/internal/evidence/acceptance-fixtures")).toBe(false);
  });
});

describe("caller-bound fixture namespaces", () => {
  it("accepts a valid Phase A fixture from the Phase A verifier", async () => {
    const calls = { persist: 0 };
    const fixture = routeFor(makeOwner(calls), [PA_WRITER, PB_WRITER]);
    const res = await fixture.handler({ params: {}, headers: {}, caller: { email: PA_CALLER }, body: fixtureBody(["phase-a-evidence-1"]) });
    expect(res.status).toBe(200);
    expect(calls.persist).toBe(1);
  });

  it("accepts a valid Phase B fixture from the Phase B verifier", async () => {
    const calls = { persist: 0 };
    const fixture = routeFor(makeOwner(calls), [PA_WRITER, PB_WRITER]);
    const res = await fixture.handler({ params: {}, headers: {}, caller: { email: PB_CALLER }, body: fixtureBody(["phase-b-evidence-v2-1"]) });
    expect(res.status).toBe(200);
    expect(calls.persist).toBe(1);
  });

  it("rejects a Phase B fixture from the Phase A verifier", async () => {
    const calls = { persist: 0 };
    const fixture = routeFor(makeOwner(calls), [PA_WRITER, PB_WRITER]);
    const res = await fixture.handler({ params: {}, headers: {}, caller: { email: PA_CALLER }, body: fixtureBody(["phase-b-evidence-v2-1"]) });
    expect(res.status).toBe(404);
    expect((res.body as { error?: string }).error).toBeDefined();
    expect(calls.persist).toBe(0);
  });

  it("rejects a Phase A fixture from the Phase B verifier", async () => {
    const calls = { persist: 0 };
    const fixture = routeFor(makeOwner(calls), [PA_WRITER, PB_WRITER]);
    const res = await fixture.handler({ params: {}, headers: {}, caller: { email: PB_CALLER }, body: fixtureBody(["phase-a-evidence-1"]) });
    expect(res.status).toBe(404);
    expect(calls.persist).toBe(0);
  });

  it("rejects malformed Phase B ids from the Phase B verifier", async () => {
    const calls = { persist: 0 };
    const fixture = routeFor(makeOwner(calls), [PA_WRITER, PB_WRITER]);
    for (const bad of ["phase-b", "phaseb-evidence-1", "PHASE-B-EVIDENCE-1", "phase-c-evidence-1"]) {
      const res = await fixture.handler({ params: {}, headers: {}, caller: { email: PB_CALLER }, body: fixtureBody([bad]) });
      expect(res.status).toBe(404);
    }
    expect(calls.persist).toBe(0);
  });

  it("rejects mixed namespace ids inside one fixture", async () => {
    const calls = { persist: 0 };
    const fixture = routeFor(makeOwner(calls), [PA_WRITER, PB_WRITER]);
    const res = await fixture.handler({ params: {}, headers: {}, caller: { email: PB_CALLER }, body: fixtureBody(["phase-b-evidence-v2-1", "phase-a-evidence-1"]) });
    expect(res.status).toBe(404);
    expect(calls.persist).toBe(0);
  });

  it("rejects unknown callers before any persistence", async () => {
    const calls = { persist: 0 };
    const fixture = routeFor(makeOwner(calls), [PA_WRITER, PB_WRITER]);
    for (const caller of [undefined, { email: "other@test.iam.gserviceaccount.com" }]) {
      const res = await fixture.handler({ params: {}, headers: {}, caller: caller as { email: string }, body: fixtureBody(["phase-b-evidence-v2-1"]) });
      expect(res.status).toBe(403);
      expect((res.body as { error?: string }).error).toBe("PERMISSION_DENIED");
    }
    expect(calls.persist).toBe(0);
  });

  it("rejects namespace-mismatched claim ids", async () => {
    const calls = { persist: 0 };
    const fixture = routeFor(makeOwner(calls), [PA_WRITER, PB_WRITER]);
    const res = await fixture.handler({
      params: {}, headers: {}, caller: { email: PB_CALLER },
      body: { ...fixtureBody(["phase-b-evidence-v2-1"]), claims: [makeClaim("phase-a-claim-1", "phase-b-evidence-v2-1")] },
    });
    expect(res.status).toBe(404);
    expect(calls.persist).toBe(0);
  });

  it("rejects empty and non-object fixtures", async () => {
    const calls = { persist: 0 };
    const fixture = routeFor(makeOwner(calls), [PA_WRITER, PB_WRITER]);
    for (const body of [{ envelopes: [] }, { envelopes: "nope" }, null]) {
      const res = await fixture.handler({ params: {}, headers: {}, caller: { email: PA_CALLER }, body });
      expect(res.status).toBe(404);
    }
    expect(calls.persist).toBe(0);
  });
});

describe("Phase C fixture namespace + route-specific evidence readers", () => {
  const PC_WRITER: AcceptanceFixtureWriter = { email: "phase-c@test.iam.gserviceaccount.com", idPrefix: "phase-c-" };

  it("Phase C caller + phase-c-* fixture → accepted; cross-namespace rejected", async () => {
    const calls = { persist: 0 };
    const fixture = routeFor(makeOwner(calls), [PA_WRITER, PB_WRITER, PC_WRITER]);
    const okRes = await fixture.handler({ params: {}, headers: {}, caller: { email: "phase-c@test.iam.gserviceaccount.com" }, body: fixtureBody(["phase-c-evidence-v1-1"]) });
    expect(okRes.status).toBe(200);
    const paRejected = await fixture.handler({ params: {}, headers: {}, caller: { email: PA_CALLER }, body: fixtureBody(["phase-c-evidence-v1-1"]) });
    const pcRejected = await fixture.handler({ params: {}, headers: {}, caller: { email: "phase-c@test.iam.gserviceaccount.com" }, body: fixtureBody(["phase-a-evidence-1"]) });
    expect(paRejected.status).toBe(404);
    expect(pcRejected.status).toBe(404);
    expect(calls.persist).toBe(1);
  });

  it("read routes are gated to the configured reader identities only", async () => {
    const owner = { getEnvelope: async () => undefined, getClaim: async () => undefined };
    const routes = createEvidenceInternalRoutes(owner, [PA_WRITER], ["outcome-resolution@test.iam.gserviceaccount.com"]);
    const envelopeRoute = routes.find((route) => route.pattern === "/internal/evidence/envelopes/:id");
    const claimRoute = routes.find((route) => route.pattern === "/internal/evidence/claims/:id");
    expect(envelopeRoute?.allowedCallers).toEqual(["outcome-resolution@test.iam.gserviceaccount.com"]);
    expect(claimRoute?.allowedCallers).toEqual(["outcome-resolution@test.iam.gserviceaccount.com"]);
  });

  it("readers add to the global policy and never displace chain-era readers", () => {
    const composed = composeEvidenceReaderEmails(
      ["tm-dev-agent-runtime@test", "tm-dev-phase-a-verifier@test"],
      "tm-dev-outcome-resolution@test,tm-dev-agent-runtime@test",
    );
    expect(composed).toEqual(["tm-dev-agent-runtime@test", "tm-dev-phase-a-verifier@test", "tm-dev-outcome-resolution@test"]);
  });

  it("without configured readers, read routes fall back to the global policy", () => {
    const owner = { getEnvelope: async () => undefined, getClaim: async () => undefined };
    const routes = createEvidenceInternalRoutes(owner, [PA_WRITER]);
    const envelopeRoute = routes.find((route) => route.pattern === "/internal/evidence/envelopes/:id");
    expect(envelopeRoute?.allowedCallers).toBeUndefined();
  });
});

describe("acceptance fixture replay semantics (route-level)", () => {
  const makeReplayOwner = () => {
    const envelopes = new Map<string, unknown>();
    const claims = new Map<string, unknown>();
    const service = new EvidenceService();
    const owner: FixtureOwner = {
      getEnvelope: async () => undefined,
      getClaim: async () => undefined,
      persistFixture: async (raw) => {
        const value = raw as { envelopes: unknown[]; claims: unknown[] };
        for (const envelope of value.envelopes) {
          const id = (envelope as { id: string }).id;
          const saved = await service.persistEnvelope(envelope, {
            putIfAbsent: async (key: string, v: unknown) => { if (envelopes.has(key)) return false; envelopes.set(key, v); return true; },
            get: async (key: string) => envelopes.get(key),
          });
          if (!saved.ok) return saved;
        }
        for (const claim of value.claims) {
          const id = (claim as { id: string }).id;
          const saved = await service.persistClaim(claim, {
            putIfAbsent: async (key: string, v: unknown) => { if (claims.has(key)) return false; claims.set(key, v); return true; },
            get: async (key: string) => claims.get(key),
          });
          if (!saved.ok) return saved;
        }
        return { ok: true as const, value: { ok: true } };
      },
    };
    return { owner, envelopes, claims };
  };

  it("identical replay retains immutable semantics with no duplicate rows", async () => {
    const { owner, envelopes } = makeReplayOwner();
    const fixture = routeFor(owner, [PA_WRITER]);
    const body = fixtureBody(["phase-a-evidence-replay-1"]);
    const first = await fixture.handler({ params: {}, headers: {}, caller: { email: PA_CALLER }, body });
    const second = await fixture.handler({ params: {}, headers: {}, caller: { email: PA_CALLER }, body });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(envelopes.size).toBe(1);
  });

  it("divergent same-id replay fails closed without altering the stored row", async () => {
    const { owner, envelopes } = makeReplayOwner();
    const fixture = routeFor(owner, [PA_WRITER]);
    const first = await fixture.handler({ params: {}, headers: {}, caller: { email: PA_CALLER }, body: fixtureBody(["phase-a-evidence-replay-2"]) });
    expect(first.status).toBe(200);
    const divergent = { ...fixtureBody(["phase-a-evidence-replay-2"]), envelopes: [makeEnvelope("phase-a-evidence-replay-2", { different: true })] };
    const second = await fixture.handler({ params: {}, headers: {}, caller: { email: PA_CALLER }, body: divergent });
    expect(second.status).toBe(404);
    expect((second.body as { error?: string }).error).toBeDefined();
    expect(envelopes.size).toBe(1);
  });
});

describe("Wave 1 multi-namespace fixture writers", () => {
  it("a trusted verifier SA holding phase-c- AND wave1- namespaces writes exactly those", async () => {
    const calls = { persist: 0 };
    const sharedWriter = [
      { email: "shared-verifier@test.iam.gserviceaccount.com", idPrefix: "phase-c-" } as const,
      { email: "shared-verifier@test.iam.gserviceaccount.com", idPrefix: "wave1-" } as const,
    ];
    const fixture = routeFor(makeOwner(calls), sharedWriter);
    const wave1Ok = await fixture.handler({ params: {}, headers: {}, caller: { email: "shared-verifier@test.iam.gserviceaccount.com" }, body: fixtureBody(["wave1-a-unsafe-supplier-evidence-1"]) });
    expect(wave1Ok.status).toBe(200);
    const pcOk = await fixture.handler({ params: {}, headers: {}, caller: { email: "shared-verifier@test.iam.gserviceaccount.com" }, body: fixtureBody(["phase-c-evidence-v1-1"]) });
    expect(pcOk.status).toBe(200);
    const foreign = await fixture.handler({ params: {}, headers: {}, caller: { email: "shared-verifier@test.iam.gserviceaccount.com" }, body: fixtureBody(["phase-a-evidence-1"]) });
    expect(foreign.status).toBe(404);
    expect(calls.persist).toBe(2);
  });
});

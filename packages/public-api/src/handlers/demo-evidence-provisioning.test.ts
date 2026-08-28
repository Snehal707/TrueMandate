import http, { type Server } from "node:http";
import { describe, expect, it, afterEach } from "vitest";
import { ok, type Result } from "@truemandate/protocol";
import type { InternalCallerIdentityVerifier } from "@truemandate/cloud-runtime";
import { createPublicBffServer } from "../server.js";
import type { PublicBffPorts } from "../ports.js";

function request(
  server: Server,
  method: string,
  pathname: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      reject(new Error("server not listening"));
      return;
    }
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const r = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path: pathname,
        method,
        headers: payload === undefined ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode ?? 0, json: text ? (JSON.parse(text) as unknown) : null });
        });
      },
    );
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

const PHASE_C = "tm-dev-phase-c-verifier@elite-crossbar-505104-t9.iam.gserviceaccount.com";
const WEB = "tm-dev-web@elite-crossbar-505104-t9.iam.gserviceaccount.com";
const AUDIENCE = "https://tm-dev-public-bff-o2sz2wgoma-uc.a.run.app";
const PATH = "/internal/demo/evidence-provisioning";

function fakeVerifier(email: string | undefined): InternalCallerIdentityVerifier {
  return { verify: async () => (email ? { email } : undefined) };
}

const minimalPorts: PublicBffPorts = {
  intentCreate: { createIntent: async () => ({ ok: true, value: {} } as never) },
  workspaceRead: { getWorkspace: async () => ({ ok: true, value: {} } as never) },
  approvalSubmit: { submitApproval: () => ({ ok: true, value: {} } as never) },
  evidenceRead: { getEvidence: async () => ({ ok: true, value: {} } as never) },
};

function serverWith(
  provisionCalls: unknown[],
  opts: { callerEmails: readonly string[]; verifierEmail: string | undefined; audience?: string },
) {
  const ports: PublicBffPorts = {
    ...minimalPorts,
    demoEvidenceProvision: {
      provisionDemoEvidence: async (input): Promise<Result<unknown>> => {
        provisionCalls.push(input);
        return ok({ envelopeIds: ["env-1"], claimIds: ["claim-1"] });
      },
    },
  };
  return createPublicBffServer(
    ports,
    {
      requireConfig: false,
      config: {
        port: 0,
        host: "127.0.0.1",
        demoEvidenceProvisionCallerEmails: opts.callerEmails,
        internalAuthAudience: opts.audience ?? AUDIENCE,
      },
    },
    { ready: true, probe: async () => ({ ready: true, reason: undefined }) },
    fakeVerifier(opts.verifierEmail),
  );
}

let activeServer: ReturnType<typeof createPublicBffServer> | undefined;
afterEach(async () => {
  await activeServer?.close();
  activeServer = undefined;
});

const validBody = () => ({
  scenarioId: "procurement",
  runId: "run-1",
  intentId: "demo-procurement-run-1-intent",
  intentStateId: "state-abc",
});

describe("application-level caller restriction — independent of Cloud Run IAM", () => {
  it("allows the configured phase-c-verifier identity", async () => {
    const calls: unknown[] = [];
    activeServer = serverWith(calls, { callerEmails: [PHASE_C], verifierEmail: PHASE_C });
    await activeServer.listen();
    const res = await request(activeServer.server, "POST", PATH, validBody());
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it("denies a caller not in TM_DEMO_EVIDENCE_PROVISION_CALLER_EMAILS (e.g. web/browser-proxy identity)", async () => {
    const calls: unknown[] = [];
    activeServer = serverWith(calls, { callerEmails: [PHASE_C], verifierEmail: WEB });
    await activeServer.listen();
    const res = await request(activeServer.server, "POST", PATH, validBody());
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("denies an unverifiable/missing caller identity (no valid token)", async () => {
    const calls: unknown[] = [];
    activeServer = serverWith(calls, { callerEmails: [PHASE_C], verifierEmail: undefined });
    await activeServer.listen();
    const res = await request(activeServer.server, "POST", PATH, validBody());
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("the route does not register at all when no caller is configured", async () => {
    const calls: unknown[] = [];
    activeServer = serverWith(calls, { callerEmails: [], verifierEmail: PHASE_C });
    await activeServer.listen();
    const res = await request(activeServer.server, "POST", PATH, validBody());
    expect(res.status).toBe(404);
  });
});

describe("strict schema rejection — no field exists for evidence content", () => {
  const attackFields: Record<string, unknown> = {
    quantity: 999999,
    merchant: "attacker-merchant",
    provider: "attacker-provider",
    payee: "attacker-payee",
    destination: "attacker-warehouse",
    renewalSetting: "AUTO",
    capability: "execute_payment",
    concept: "fabricated_concept",
    value: "fabricated_value",
    confidence: 1,
    source: "attacker-source",
    contentHash: "attacker-hash",
    trustClass: "ELEVATED_EXTERNAL",
    taint: { classes: ["EXTERNAL_CONTENT"], origins: [] },
    envelopes: [{ id: "fake-env", source: "attacker", contentHash: "x", captureTime: "2026-01-01T00:00:00.000Z" }],
    claims: [{ id: "fake-claim", evidenceId: "fake-env", concept: "attacker", value: 1, confidence: 1 }],
    rawText: "Attacker-controlled raw intent text",
    workflowId: "wf-attacker",
    proofObligationIds: ["po-attacker"],
  };

  for (const [field, value] of Object.entries(attackFields)) {
    it(`rejects a request carrying an unexpected "${field}" field`, async () => {
      const calls: unknown[] = [];
      activeServer = serverWith(calls, { callerEmails: [PHASE_C], verifierEmail: PHASE_C });
      await activeServer.listen();
      const res = await request(activeServer.server, "POST", PATH, { ...validBody(), [field]: value });
      expect(res.status).toBe(400);
      expect(calls).toHaveLength(0);
    });
  }

  it("accepts the exact closed shape with nothing else", async () => {
    const calls: unknown[] = [];
    activeServer = serverWith(calls, { callerEmails: [PHASE_C], verifierEmail: PHASE_C });
    await activeServer.listen();
    const res = await request(activeServer.server, "POST", PATH, validBody());
    expect(res.status).toBe(200);
    expect(calls[0]).toEqual(validBody());
  });

  it("rejects a request missing a required identifier", async () => {
    const calls: unknown[] = [];
    activeServer = serverWith(calls, { callerEmails: [PHASE_C], verifierEmail: PHASE_C });
    await activeServer.listen();
    const { intentStateId: _drop, ...incomplete } = validBody();
    const res = await request(activeServer.server, "POST", PATH, incomplete);
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("ordinary /v1/evidence is unaffected", () => {
  it("still accepts a normal untrusted evidence submission, unauthenticated, unchanged", async () => {
    const submitCalls: unknown[] = [];
    const ports: PublicBffPorts = {
      ...minimalPorts,
      evidenceSubmit: {
        submitEvidence: async (raw: unknown) => {
          submitCalls.push(raw);
          return ok({ envelopeIds: ["e1"], claimIds: [] });
        },
      },
    };
    activeServer = createPublicBffServer(
      ports,
      {
        requireConfig: false,
        config: { port: 0, host: "127.0.0.1", demoEvidenceProvisionCallerEmails: [PHASE_C], internalAuthAudience: AUDIENCE },
      },
      { ready: true, probe: async () => ({ ready: true, reason: undefined }) },
      fakeVerifier(undefined),
    );
    await activeServer.listen();
    const res = await request(activeServer.server, "POST", "/v1/evidence", {
      envelopes: [{ id: "ev-1", source: "merchant-portal", contentHash: "hash-1", captureTime: "2026-01-01T00:00:00.000Z" }],
      claims: [],
    });
    expect(res.status).toBe(200);
    expect(submitCalls).toHaveLength(1);
  });
});

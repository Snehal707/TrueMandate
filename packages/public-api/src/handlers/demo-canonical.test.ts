import { describe, expect, it } from "vitest";
import { MemoryTransactionalStore } from "@truemandate/cloud-firestore";
import { createDemoCanonicalAdapter } from "../adapters.js";
import { createPublicBffRouter } from "../router.js";
import { CANONICAL_PHASE_C_V5_DOC_IDS } from "./demo-canonical.js";

/* Compact canonical-shaped fixtures for the allowlisted docs. */
const CANONICAL_DOCS: Record<string, Record<string, unknown>> = {
  [CANONICAL_PHASE_C_V5_DOC_IDS.intent]: {
    id: "phase-c-food-grade-500-v5",
    rawText: "Buy 500 food-grade containers from approved supplier Phase B Supplier for under INR 800000 before 2030-12-31T23:59:59.000Z.",
    principalId: "phase-c-human-principal",
    createdAt: "2026-08-18T12:58:45.845Z",
    contentHash: "d825ea77a5d0b54e107f3e8186a29f785ebc4101160eb874d685c612faa393d9",
  },
  [CANONICAL_PHASE_C_V5_DOC_IDS.intentState]: {
    id: "state-phase-c-food-grade-500-v5-compiled-2204ac8d4a058fd8",
    constraints: [
      { concept: "quantity", operator: "EQ", value: 500, kind: "HARD", mutability: "HUMAN_REVISABLE", sourceText: "500", sourceSpan: { start: 4, end: 7 } },
      { concept: "max_total_budget", operator: "LT", value: 800000, kind: "FINANCIAL", mutability: "HUMAN_REVISABLE", sourceText: "under INR 800000", sourceSpan: { start: 74, end: 90 } },
    ],
  },
  [CANONICAL_PHASE_C_V5_DOC_IDS.evaluation]: {
    id: "evaluation-wf-4278136715e178494fb52890-authority-wf-4278136715e178494fb52890",
    decision: "ALLOW",
    capability: "execute_payment",
    merchant: "phase-b-supplier",
    amount: 742000,
    currency: "INR",
    expiresAt: "2030-12-31T23:59:59.000Z",
    materializationEligible: true,
    recordHash: "696a8f8b6a2832b37dfa3be4a3b5e7bad786682d04df3fcb6171e08bee10391c",
  },
  [CANONICAL_PHASE_C_V5_DOC_IDS.grant]: {
    id: "grant-ede4729da9e842dc",
    consumptionState: "CONSUMED",
    consumedAt: "2026-08-18T13:00:29.614Z",
    nonce: "SECRET_NONCE_MUST_NOT_LEAK",
  },
  [CANONICAL_PHASE_C_V5_DOC_IDS.preparedAction]: {
    lifecycle: "SUCCEEDED",
    preparedAction: {
      id: "prep-d5fa7a308b07",
      toolId: "payment.execute",
      amount: 742000,
      currency: "INR",
      merchant: "phase-b-supplier",
      quantity: 500,
      product: "food-grade containers",
      parameterHash: "6d5f9fcd07c9671a339e462ba1ac7f733b39f1d6b2ce92df6826d1e26d43bad0",
      guardianVerdictHash: "2752d8a487add5e1c4b46120fa0d041f9ba9f782906d6b8b6fed4045973e7785",
      createdAt: "2026-08-18T13:00:27.719Z",
    },
    verdict: {
      id: "gv-fc62d0f73a08",
      decision: "REQUIRE_APPROVAL",
      semanticStatus: "CONFLICTED",
      criticalFailure: false,
      overallFidelity: 0.8,
      modelName: "guardian-orchestrator",
      createdAt: "2026-08-18T12:59:31.846Z",
      judgeResults: [
        { judgeId: "FIDELITY", status: "OK", schemaId: "judge.fidelity.v1" },
        { judgeId: "EVIDENCE", status: "OK", schemaId: "judge.evidence.v1" },
      ],
    },
  },
  [CANONICAL_PHASE_C_V5_DOC_IDS.commitToken]: { id: "ct-352434dd4a7b", consumed: true },
  [CANONICAL_PHASE_C_V5_DOC_IDS.phaseAToken]: { id: "ct-92ceb56769a0", consumed: false },
  [CANONICAL_PHASE_C_V5_DOC_IDS.sideEffect]: {
    id: "exec-phase-c-food-grade-500-v5",
    toolId: "payment.execute",
    resultState: "SUCCESS",
    externalReference: "mock-pay-phase-c-food-grade-500-v5",
    amount: 742000,
    currency: "INR",
    counterparty: "phase-b-supplier",
    requestTimestamp: "2026-08-18T13:00:29.614Z",
  },
  [CANONICAL_PHASE_C_V5_DOC_IDS.idempotency]: {
    key: "phase-c-food-grade-500-v5",
    resultRef: "mock-pay-phase-c-food-grade-500-v5",
    state: "SUCCESS",
  },
  [CANONICAL_PHASE_C_V5_DOC_IDS.outcomeContract]: {
    id: "outcome-evaluation-wf-4278136715e178494fb52890-authority-wf-4278136715e178494fb52890-ed2c392fd022e40e",
    state: "PARTIAL",
    paymentStatus: "SUCCESS",
    createdAt: "2026-08-18T12:59:31.846Z",
    executionBegunAt: "2026-08-18T13:00:29.614Z",
    updatedAt: "2026-08-18T13:00:31.752Z",
    version: 1,
    definitionHash: "872cf000c4734c3b9776bf205c280c5047c3554190f736232a3765e1d0947289",
    requirements: [
      { concept: "supplier_approved", state: "SATISFIED", value: "phase-b-supplier" },
      { concept: "price_within", state: "SATISFIED", value: 742000 },
      { concept: "quantity_received", state: "PARTIAL", value: 500 },
    ],
  },
  [CANONICAL_PHASE_C_V5_DOC_IDS.paymentEvent]: { observedAt: "2026-08-18T13:00:29.614Z", payload: { paymentStatus: "SUCCESS" } },
  [CANONICAL_PHASE_C_V5_DOC_IDS.partialEvent]: { observedAt: "2026-08-18T13:00:31.752Z", payload: { state: "PARTIAL" } },
  [CANONICAL_PHASE_C_V5_DOC_IDS.resolutionCase]: {
    id: "rc-outcome-evaluation-wf-4278136715e178494fb52890-authority-wf-4278136715e178494fb52890-ed2c392fd022e40e-dfb7100e519a421f",
    state: "OPEN",
    responsibilityState: "UNKNOWN",
    openedAt: "2026-08-18T13:00:31.752Z",
    triggerEventId: "ev-OUTCOME_PARTIAL-…",
    triggerIdentity: "dfb7100e519a421f9542bfc03d4e7286991d084d744bf046e807c17d9673f538",
    caseVersion: 1,
    recursionDepth: 0,
  },
  [CANONICAL_PHASE_C_V5_DOC_IDS.artifactReceipt]: { id: "phase-c-evidence-v5-receipt", source: "warehouse-receiving-system" },
  [CANONICAL_PHASE_C_V5_DOC_IDS.claimQuantityReceived]: {
    id: "phase-c-claim-v5-quantity_received",
    evidenceId: "phase-c-evidence-v5-receipt",
    concept: "quantity_received",
    value: 450,
  },
  [CANONICAL_PHASE_C_V5_DOC_IDS.artifactDispatch]: { id: "phase-c-evidence-v5-dispatch", source: "merchant-dispatch-system" },
  [CANONICAL_PHASE_C_V5_DOC_IDS.claimDispatchedQuantity]: {
    id: "phase-c-claim-v5-dispatched_quantity",
    evidenceId: "phase-c-evidence-v5-dispatch",
    concept: "dispatched_quantity",
    value: 500,
  },
  [CANONICAL_PHASE_C_V5_DOC_IDS.artifactCarrier]: { id: "phase-c-evidence-v5-carrier", source: "carrier-manifest-system" },
  [CANONICAL_PHASE_C_V5_DOC_IDS.claimCarrierCount]: {
    id: "phase-c-claim-v5-carrier_acceptance_count",
    evidenceId: "phase-c-evidence-v5-carrier",
    concept: "carrier_acceptance_count",
    value: null,
  },
};

async function seed(store: MemoryTransactionalStore, docs: Record<string, Record<string, unknown>>) {
  for (const [path, value] of Object.entries(docs)) {
    await store.set(path, value);
  }
}

async function route(method: string, path: string, ports: Parameters<typeof createPublicBffRouter>[0]) {
  const router = createPublicBffRouter(ports, { requireConfig: false }, { ready: true, probe: async () => ({ ready: true, reason: undefined }) });
  const res = {
    statusCode: 200,
    headers: {} as Record<string, number | string>,
    body: "",
    setHeader(name: string, value: number | string) {
      this.headers[name.toLowerCase()] = value;
    },
    end(payload: string) {
      this.body = payload;
    },
  };
  await router(method, path, {} as never, res as never);
  return { status: res.statusCode, body: res.body ? (JSON.parse(res.body) as Record<string, unknown>) : undefined };
}

const basePorts = (store: MemoryTransactionalStore) => ({
  intentCreate: { createIntent: async () => ({ ok: true, value: { id: "i1" } } as never) },
  workspaceRead: { getWorkspace: async () => ({ ok: true, value: {} } as never) },
  approvalSubmit: { submitApproval: () => ({ ok: true, value: {} } as never) },
  evidenceRead: { getEvidence: async () => ({ ok: true, value: {} } as never) },
  demoCanonical: createDemoCanonicalAdapter(store),
});

describe("demo canonical read projection (BFF, read-only, field-allowlisted)", () => {
  it("serves the canonical projection with exact canonical values", async () => {
    const store = new MemoryTransactionalStore();
    await seed(store, CANONICAL_DOCS);
    const got = await route("GET", "/v1/demo/canonical-phase-c-v5", basePorts(store));
    expect(got.status).toBe(200);
    const body = got.body as {
      meta: { projectionKind: string; readOnly: boolean };
      guardian: { decision: string };
      authority: { decision: string; amount: number };
      outcome: { state: string; paymentStatus: string; divergence: { requiredQuantity: number; verifiedReceived: number; shortfall: number } };
      resolution: { responsibilityState: string; remedyExecutions: number };
      preservation: { phaseACanonicalTokenConsumed: boolean };
    };
    expect(body.meta.projectionKind).toBe("canonical-phase-c-v5-live-read");
    expect(body.meta.readOnly).toBe(true);
    expect(body.guardian.decision).toBe("REQUIRE_APPROVAL");
    expect(body.authority.decision).toBe("ALLOW");
    expect(body.authority.amount).toBe(742000);
    expect(body.outcome.state).toBe("PARTIAL");
    expect(body.outcome.paymentStatus).toBe("SUCCESS");
    expect(body.outcome.divergence).toEqual({ requiredQuantity: 500, verifiedReceived: 450, shortfall: 50, evidenceClaimIds: ["phase-c-claim-v5-quantity_received"] });
    expect(body.resolution.responsibilityState).toBe("UNKNOWN");
    expect(body.resolution.remedyExecutions).toBe(0);
    expect(body.preservation.phaseACanonicalTokenConsumed).toBe(false);
  });

  it("never leaks non-allowlisted fields (e.g. grant nonce)", async () => {
    const store = new MemoryTransactionalStore();
    await seed(store, CANONICAL_DOCS);
    const got = await route("GET", "/v1/demo/canonical-phase-c-v5", basePorts(store));
    expect(JSON.stringify(got.body)).not.toContain("SECRET_NONCE_MUST_NOT_LEAK");
    expect(JSON.stringify(got.body)).not.toContain("nonce");
  });

  it("accepts no caller-controlled document ids (fixed route only)", async () => {
    const store = new MemoryTransactionalStore();
    await seed(store, CANONICAL_DOCS);
    const ports = basePorts(store);
    const unknown = await route("GET", "/v1/demo/authorityGrants/grant-something-else", ports);
    expect(unknown.status).toBe(404);
    const traversal = await route("GET", "/v1/demo/../secrets", ports);
    expect(traversal.status).toBe(404);
  });

  it("is GET-only — POST is not allowed", async () => {
    const store = new MemoryTransactionalStore();
    await seed(store, CANONICAL_DOCS);
    const got = await route("POST", "/v1/demo/canonical-phase-c-v5", basePorts(store));
    expect(got.status).toBe(405);
  });

  it("performs no writes while serving", async () => {
    const store = new MemoryTransactionalStore();
    await seed(store, CANONICAL_DOCS);
    const before = await store.get(CANONICAL_PHASE_C_V5_DOC_IDS.grant);
    await route("GET", "/v1/demo/canonical-phase-c-v5", basePorts(store));
    await route("POST", "/v1/demo/canonical-phase-c-v5", basePorts(store));
    const after = await store.get(CANONICAL_PHASE_C_V5_DOC_IDS.grant);
    expect(after).toEqual(before);
  });

  it("returns an error when core canonical docs are missing", async () => {
    const store = new MemoryTransactionalStore();
    // Only a subset seeded — the projection must fail cleanly.
    await store.set(CANONICAL_PHASE_C_V5_DOC_IDS.intent, CANONICAL_DOCS[CANONICAL_PHASE_C_V5_DOC_IDS.intent]!);
    const got = await route("GET", "/v1/demo/canonical-phase-c-v5", basePorts(store));
    expect(got.status).toBe(422);
    expect(got.body).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  });
});

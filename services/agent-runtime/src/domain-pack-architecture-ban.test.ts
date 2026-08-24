import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import type { DomainPack, WorkflowRequestBase } from "./domain-pack.js";
import type { GenericWorkflowEngineDeps } from "./generic-workflow-engine.js";
import { ProcurementDomainPack } from "./procurement-domain-pack.js";
import { TravelDomainPack } from "./travel-domain-pack.js";
import { request, runtime } from "./generic-workflow.e2e.test.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const PRIVILEGED_TOKENS = [
  "bindAndMint",
  "mintGrant",
  "createGrant",
  "CommitToken",
  "AuthorityS2SClient",
  "GatewayS2SClient",
  "OutcomeS2SClient",
] as const;

const PRIVILEGED_SURFACE = [
  ...PRIVILEGED_TOKENS,
  "prepareFromReferences",
  "gateway.commit",
  "evaluateProcurement",
] as const;

function readSrc(name: string): string {
  return readFileSync(path.join(here, name), "utf8");
}

function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("DomainPack architecture ban", () => {
  it("DomainPack interface source has no privileged capability surface", () => {
    const src = codeOnly(readSrc("domain-pack.ts"));
    for (const token of PRIVILEGED_TOKENS) {
      expect(src, `DomainPack interface must not mention ${token}`).not.toContain(token);
    }
    expect(src).not.toMatch(/authority\s*:/);
    expect(src).not.toMatch(/gateway\s*:/);
    expect(src).not.toMatch(/readonly authority/);
    expect(src).not.toMatch(/readonly gateway/);
  });

  it("registered DomainPack sources cannot mint grants, issue CommitTokens, or call Gateway", () => {
    for (const file of [
      "procurement-domain-pack.ts",
      "travel-domain-pack.ts",
      "saas-it-spend-domain-pack.ts",
      "invoice-vendor-payment-domain-pack.ts",
      "logistics-fulfillment-domain-pack.ts",
    ]) {
      const src = codeOnly(readSrc(file));
      for (const token of PRIVILEGED_SURFACE) {
        expect(src, `${file} must not mention ${token}`).not.toContain(token);
      }
      expect(src, `${file} must not import cloud runtime clients`).not.toMatch(
        /from ["']@truemandate\/cloud-runtime["']/,
      );
      expect(src, `${file} must not import authority internals`).not.toMatch(
        /from ["']@truemandate\/authority/,
      );
      expect(src, `${file} must not import gateway internals`).not.toMatch(
        /from ["']@truemandate\/gateway/,
      );
    }
  });

  it("GenericWorkflowEngine owns governance; DomainPack cannot carry privileged deps", () => {
    type PackKeys = keyof DomainPack<WorkflowRequestBase>;
    type EngineDepKeys = keyof GenericWorkflowEngineDeps<WorkflowRequestBase>;
    type ForbiddenOnPack = "authority" | "gateway" | "outcomes" | "bindAndMint";
    type PackHasForbidden = PackKeys & ForbiddenOnPack;
    expectTypeOf<PackHasForbidden>().toEqualTypeOf<never>();
    expectTypeOf<EngineDepKeys>().toMatchTypeOf<
      "authority" | "gateway" | "outcomes" | "pack"
    >();
  });

  it("proof-obligation derivation stays engine-owned (not pack-supplied)", () => {
    const engine = readSrc("generic-workflow-engine.ts");
    const pack = readSrc("procurement-domain-pack.ts");
    expect(engine).toContain("deriveRequiredProofObligations");
    expect(pack).not.toContain("deriveRequiredProofObligations");
    expect(engine).not.toContain("this.deps.pack.resolveObligationEvidence");
    expect(engine).not.toContain("this.deps.pack.evaluateRequiredObligation");
  });

  it("shared execution eligibility never infers proof semantics from evidence-id substrings", () => {
    const engine = codeOnly(readSrc("generic-workflow-engine.ts"));
    expect(engine).not.toContain("traveler-count-evidence");
    expect(engine).not.toContain("hotel-offer-evidence");
    expect(engine).not.toMatch(/evidenceId\s*\.\s*includes\s*\(/);
    expect(engine).not.toMatch(/id\s*\.\s*includes\s*\(/);
  });

  it("generic runtime surfaces keep procurement naming scoped to packs and compatibility layers", () => {
    for (const file of [
      "generic-workflow-engine.ts",
      "workflow-dispatcher.ts",
      "domain-pack.ts",
      "generic-workflow.e2e.test.ts",
      "execution-commit-route.test.ts",
      "procurement-workflow-stage-recorder.test.ts",
    ]) {
      const src = codeOnly(readSrc(file));
      expect(src, `${file} must not revive the retired shared coordinator name`).not.toContain(
        "ProcurementWorkflowCoordinator",
      );
      expect(src, `${file} must not reference the retired shared harness path`).not.toContain(
        "procurement-workflow.e2e.test",
      );
    }
  });

  it("all domains share the same Guardian -> Authority -> Gateway path", async () => {
    const r1 = await runtime();
    const r2 = await runtime();

    const { GenericWorkflowEngine } = await import("./generic-workflow-engine.js");
    const engine1 = new GenericWorkflowEngine({
      pack: ProcurementDomainPack,
      intents:
        (r1.coordinator as unknown as { deps: GenericWorkflowEngineDeps<never> }).deps
          ?.intents ?? (await rebuildDeps(r1)).intents,
      owner: (await rebuildDeps(r1)).owner,
      evidence: (await rebuildDeps(r1)).evidence,
      authority: (await rebuildDeps(r1)).authority,
      outcomes: (await rebuildDeps(r1)).outcomes,
      gateway: (await rebuildDeps(r1)).gateway,
      model: (await rebuildDeps(r1)).model,
      provenance: (await rebuildDeps(r1)).provenance,
      now: () => "2026-06-01T12:00:00.000Z",
    });
    void engine1;

    const procurement = await r1.coordinator.run({
      ...request(),
      expectedIntentStateId: r1.state.id,
      idempotencyKey: "arch-ban-proc",
    });
    expect(procurement.ok).toBe(true);
    if (procurement.ok) {
      expect([
        "AUTHORIZED",
        "AWAITING_APPROVAL",
        "AUTHORITY_EVALUATION",
        "BLOCKED",
      ]).toContain((procurement.value as { state: string }).state);
    }
    expect(r1.calls.commit).toBe(0);
    if (
      procurement.ok &&
      (procurement.value as { state: string }).state === "AUTHORIZED"
    ) {
      expect(r1.calls.evaluation).toBeGreaterThan(0);
      expect(r1.calls.authorize).toBeGreaterThan(0);
      expect(r1.calls.mint).toBeGreaterThan(0);
    }

    const engineAlt = new GenericWorkflowEngine({
      pack: TravelDomainPack,
      ...(await rebuildDeps(r2)),
      now: () => "2026-06-01T12:00:00.000Z",
    });
    const travel = await engineAlt.run({
      intentId: "intent-e2e",
      expectedIntentStateId: r2.state.id,
      idempotencyKey: "arch-ban-alt",
      capability: "book_travel",
      provider: {
        id: "travel-provider",
        name: "Travel Provider",
        approved: true,
        approvalEvidenceId: "approval-evidence",
      },
      booking: {
        itineraryId: "it-arch-ban",
        lodgingName: "Seaside Lodge",
        travelDate: "2026-12-20T00:00:00.000Z",
        travelerCount: 2,
      },
      totalAmount: 3200,
      currency: "USD",
      refundable: true,
      deliveryTerms: "travel on 2026-12-20",
      parameters: {},
      consequenceLevel: "HIGH",
      evidenceIds: [
        "approval-evidence",
        "traveler-count-evidence",
        "refund-evidence",
      ],
    });
    expect(travel.ok).toBe(true);
    expect(r2.calls.commit).toBe(0);
    if (travel.ok && (travel.value as { state: string }).state === "AUTHORIZED") {
      expect(r2.calls.evaluation).toBeGreaterThan(0);
      expect(r2.calls.authorize).toBeGreaterThan(0);
      expect(r2.calls.mint).toBeGreaterThan(0);
    }
  });

  it("DomainPack request schema alone cannot bypass proof obligations", () => {
    const alwaysSatisfied: DomainPack<WorkflowRequestBase & { noop?: never }> = {
      id: "malicious",
      requestSchema: z.object({
        intentId: z.string().min(1),
        idempotencyKey: z.string().min(1),
      }).strict() as z.ZodType<WorkflowRequestBase>,
      planning: {
        executionCapability: "execute_payment",
        executionLabel: "malicious execution",
        requiredPhases: ["VERIFY_OFFER", "BIND_EVIDENCE", "EXECUTE", "VERIFY_OUTCOME"],
        conceptFamilies: [{ canonicalConcept: "budget", aliases: ["budget"] }],
        executionCriticalConceptRules: [{ canonicalConcept: "budget", proofMechanism: { kind: "EVIDENCE_OBLIGATION" } }],
        offerBackedCanonicalConcepts: ["budget"],
      },
      workflowId: () => "wf-malicious",
      assertWorkflowId: (input) => ({
        ok: true as const,
        value: input.workflowId ?? "wf-malicious",
      }),
      buildActionProposal: () => ({
        capability: "execute_payment",
        merchant: "x",
        product: "y",
        quantity: 1,
        amount: 1,
        currency: "USD",
        parameters: {},
        consequenceLevel: "HIGH",
      }),
      buildExternalOfferNode: () => ({ label: "malicious", metadata: {} }),
      buildOutcomeContractInput: () => ({
        merchant: "x",
        quantity: 1,
        budgetMax: 1,
        domain: "malicious",
      }),
    };
    const engine = readSrc("generic-workflow-engine.ts");
    expect(engine).toMatch(/deriveRequiredProofObligations\(/);
    expect(engine).toContain("getVerificationArtifactForState");
    expect(engine).toContain("authoritative-proof-handoff");
    void alwaysSatisfied;
  });
});

async function rebuildDeps(
  r: Awaited<ReturnType<typeof runtime>>,
): Promise<{
  intents: GenericWorkflowEngineDeps<never>["intents"];
  owner: GenericWorkflowEngineDeps<never>["owner"];
  evidence: GenericWorkflowEngineDeps<never>["evidence"];
  authority: GenericWorkflowEngineDeps<never>["authority"];
  outcomes: GenericWorkflowEngineDeps<never>["outcomes"];
  gateway: GenericWorkflowEngineDeps<never>["gateway"];
  model: GenericWorkflowEngineDeps<never>["model"];
  provenance: GenericWorkflowEngineDeps<never>["provenance"];
}> {
  const engine = r.coordinator as unknown as {
    deps: GenericWorkflowEngineDeps<never>;
  };
  return {
    intents: engine.deps.intents,
    owner: engine.deps.owner,
    evidence: engine.deps.evidence,
    authority: engine.deps.authority,
    outcomes: engine.deps.outcomes,
    gateway: engine.deps.gateway,
    model: engine.deps.model,
    provenance: engine.deps.provenance,
  };
}

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRuntimeConfig } from "@truemandate/cloud-runtime";
import { IntentService } from "./service.js";
import { createIntentProvenanceInternalRoutes } from "./internal-routes.js";
import { ProvenanceService } from "@truemandate/provenance-service";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const AUTHORITY = "tm-dev-authority@elite-crossbar-505104-t9.iam.gserviceaccount.com";
const AGENT_RUNTIME = "tm-dev-agent-runtime@elite-crossbar-505104-t9.iam.gserviceaccount.com";
const OUTCOME = "tm-dev-outcome-resolution@elite-crossbar-505104-t9.iam.gserviceaccount.com";
const GATEWAY = "tm-dev-gateway@elite-crossbar-505104-t9.iam.gserviceaccount.com";
const GLOBAL = [AUTHORITY, AGENT_RUNTIME, "tm-dev-public-bff@elite-crossbar-505104-t9.iam.gserviceaccount.com", "tm-dev-intent-provenance@elite-crossbar-505104-t9.iam.gserviceaccount.com"];

function routes() {
  const rows = new Map<string, unknown>();
  const semanticArtifacts = {
    putIfAbsent: async (record: { id: string }) => rows.has(record.id) ? false : (rows.set(record.id, record), true),
    get: async (id: string) => rows.get(id),
    listWorkflow: async () => [],
  };
  return createIntentProvenanceInternalRoutes({
    intents: new IntentService(),
    provenance: new ProvenanceService(),
    semanticArtifacts: semanticArtifacts as never,
    authorityCallerEmail: AUTHORITY,
    globalCallers: GLOBAL,
    outcomeResolutionCallerEmail: OUTCOME,
    gatewayCallerEmail: GATEWAY,
  });
}

function policy(pattern: string) {
  return routes().find((r) => r.pattern === pattern)?.allowedCallers ?? null;
}

describe("intent-provenance owner READ least-privilege authorization", () => {
  it("grants Outcome Resolution and Gateway exactly the three required owner reads", () => {
    const expected = [...GLOBAL, OUTCOME, GATEWAY].sort();
    expect(policy("/internal/intents/:id/tip")?.slice().sort()).toEqual(expected);
    expect(policy("/internal/intent-states/:id")?.slice().sort()).toEqual(expected);
    expect(policy("/internal/semantic-artifacts/:id")?.slice().sort()).toEqual(expected);
  });

  it("does not grant the workflow-list route or any write/finalization route", () => {
    expect(policy("/internal/workflows/:workflowId/artifacts")).toBeNull();
    expect(policy("/internal/compilations/finalize")).toBeNull();
    expect(policy("/internal/intents")).toBeNull();
  });

  it("Wave 1 remedy lifecycle: semantic artifact/provenance writers are global + Outcome Resolution only", () => {
    // The production PrivilegedRemedyPort writes the remedy semantic artifact
    // chain and execution provenance from the outcome-resolution identity —
    // route-scoped, never intents/finalization/authority bindings.
    const writers = [...GLOBAL, OUTCOME].sort();
    expect(policy("/internal/semantic-artifacts")?.slice().sort()).toEqual(writers);
    expect(policy("/internal/provenance/nodes")?.slice().sort()).toEqual(writers);
    expect(policy("/internal/provenance/edges")?.slice().sort()).toEqual(writers);
    // The Authority provenance binding stays Authority-only.
    expect(policy("/internal/provenance/authority-bindings")).toEqual([AUTHORITY]);
  });

  it("keeps the Authority provenance binding Authority-only", () => {
    expect(policy("/internal/provenance/authority-bindings")).toEqual([AUTHORITY]);
  });

  it("keeps Outcome Resolution and Gateway out of the global allowlist", () => {
    const config = loadRuntimeConfig({
      GOOGLE_CLOUD_PROJECT: "test-project",
      TM_SERVICE_NAME: "intent-provenance",
      TM_INTERNAL_ALLOWED_CALLERS: GLOBAL.join(","),
      TM_AUTHORITY_CALLER_EMAIL: AUTHORITY,
      TM_OUTCOME_RESOLUTION_CALLER_EMAIL: OUTCOME,
      TM_GATEWAY_CALLER_EMAIL: GATEWAY,
    });
    expect(config.internalAllowedCallers).toEqual(GLOBAL);
    expect(config.internalAllowedCallers).not.toContain(OUTCOME);
    expect(config.internalAllowedCallers).not.toContain(GATEWAY);
    // Terraform source must not add either identity to the INTENT-PROVENANCE
    // global allowlist. Only the intent-provenance block is inspected — other
    // services may legitimately allow gateway/agent-runtime.
    const mainTf = readFileSync(path.join(root, "infrastructure/terraform/modules/runtime/main.tf"), "utf8");
    const blocks = mainTf.split('TM_INTERNAL_ALLOWED_CALLERS').slice(1);
    const intentBlock = blocks.find((block) => block.includes('each.key == "intent-provenance"'));
    expect(intentBlock).toBeDefined();
    if (intentBlock) {
      // Slice from the intent-provenance block header so the extracted join is
      // exactly the intent-provenance allowlist (the gateway block above it
      // legitimately gained outcome-resolution for the Wave 1 remedy port).
      const fromBlock = intentBlock.slice(intentBlock.indexOf('each.key == "intent-provenance"'));
      const valueExpr = fromBlock.slice(fromBlock.indexOf('value = join('), fromBlock.indexOf('])') + 3);
      expect(valueExpr).not.toContain('"outcome-resolution"');
      expect(valueExpr).not.toContain('"gateway"');
    }
    // Wave 1 remedy lifecycle: the GATEWAY global allowlist deliberately
    // includes the outcome-resolution identity (prepare/authorize S2S) — and
    // still excludes the verifiers and public identities.
    const gatewayBlock = blocks[0];
    expect(gatewayBlock).toBeDefined();
    if (gatewayBlock) {
      const gatewayExpr = gatewayBlock.slice(gatewayBlock.indexOf('value = join('), gatewayBlock.indexOf('])') + 3);
      expect(gatewayExpr).toContain('"outcome-resolution"');
      expect(gatewayExpr).not.toContain('"phase-a-verifier"');
      expect(gatewayExpr).not.toContain('"public-bff"');
    }
  });
});

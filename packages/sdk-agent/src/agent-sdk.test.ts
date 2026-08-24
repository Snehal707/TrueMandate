import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ToolPrivilegeClass } from "@truemandate/protocol";
import { createSdkCore } from "@truemandate/sdk-core";
import { createAgentSdk } from "./agent-sdk.js";
import type { SdkTransport } from "@truemandate/sdk-core";

function noopTransport(): SdkTransport {
  return {
    async post() {
      return { status: 200, body: {} };
    },
    async get() {
      return { status: 200, body: {} };
    },
  };
}

function makeSdk() {
  const core = createSdkCore({ baseUrl: "https://tm.example", transport: noopTransport() });
  return createAgentSdk(core);
}

describe("sdk-agent surface", () => {
  it("classifies economic tools from the registry, not from agent claims", () => {
    const sdk = makeSdk();
    const pay = sdk.classifyTool("payment.execute");
    expect(pay.ok).toBe(true);
    if (pay.ok) {
      expect(pay.value.privilegeClass).toBe(ToolPrivilegeClass.T2_ECONOMIC_WRITE);
      expect(pay.value.economic).toBe(true);
    }
    const prep = sdk.requiresPreparedAction("payment.execute");
    expect(prep.ok).toBe(true);
    if (prep.ok) expect(prep.value).toBe(true);
    const read = sdk.requiresPreparedAction("catalog.search");
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.value).toBe(false);
  });

  it("only exposes tools the capability decision permits", () => {
    const sdk = makeSdk();
    const visible = sdk.listVisibleTools({ search: "ALLOW" });
    expect(visible.map((t) => t.toolId).sort()).toEqual(["catalog.search", "supplier.lookup"]);
    // payment.execute is invisible without an execute_payment decision.
    expect(sdk.assertInvocable("payment.execute", { search: "ALLOW" }).ok).toBe(false);
    // And visible once the decision is granted by the caller's authority record.
    expect(sdk.assertInvocable("payment.execute", { execute_payment: "ALLOW" }).ok).toBe(true);
  });

  it("registry-owned privilege cannot be elevated by the agent", () => {
    const sdk = makeSdk();
    const result = sdk.classifyTool("payment.execute");
    expect(result.ok).toBe(true);
    // The agent SDK surface exposes no privilege-claiming path at all.
    const boundary = sdk.boundaries;
    expect(boundary.execute).toBe(false);
    expect(boundary.pay).toBe(false);
    expect(boundary.commit).toBe(false);
    expect(boundary.mint).toBe(false);
    expect(boundary.submit).toBe(false);
  });

  it("builds locally validated proposals and never transports them", () => {
    const sdk = makeSdk();
    const result = sdk.buildActionProposal({
      id: "action-1",
      intentId: "intent-1",
      intentStateId: "state-1",
      agentId: "agent-1",
      capability: "execute_payment",
      amount: 742000,
      currency: "INR",
      merchant: "approved-a",
      parameters: { quantity: 500 },
      consequenceLevel: "ECONOMIC",
      createdAt: "2026-08-19T00:00:00Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.amount).toBe(742000);

    const bad = sdk.buildActionProposal({
      id: "action-2",
      intentId: "intent-2",
      intentStateId: "state-2",
      agentId: "agent-2",
      capability: "execute_payment",
      parameters: { widenedScope: true },
      consequenceLevel: "ECONOMIC",
      createdAt: "2026-08-19T00:00:00Z",
      // unknown key is stripped by strict parse
      extraKey: true,
    } as unknown as Parameters<typeof sdk.buildActionProposal>[0]);
    expect(bad.ok).toBe(false);
  });
});

describe("sdk-agent negative boundaries", () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

  function walk(dirPath: string): string[] {
    const out: string[] = [];
    if (!statSync(dirPath, { throwIfNoEntry: false })?.isDirectory()) return out;
    for (const name of readdirSync(dirPath)) {
      const p = path.join(dirPath, name);
      const st = statSync(p);
      if (st.isDirectory()) out.push(...walk(p));
      else if (/\.(ts|json)$/.test(name)) out.push(p);
    }
    return out;
  }

  it("exports no execute/pay/submit/mint convenience surface", () => {
    const files = walk(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file}: no fake execute()`).not.toMatch(/export (async )?function execute/);
      expect(src, `${file}: no fake pay()`).not.toMatch(/export (async )?function pay/);
      expect(src, `${file}: no fake submit()`).not.toMatch(/export (async )?function submit/);
      expect(src, `${file}: no fake mint()`).not.toMatch(/export (async )?function mint/);
      expect(src, `${file}: no internal routes`).not.toMatch(/\/internal\//);
    }
  });

  it("depends only on sdk-core, protocol, and tool-registry", () => {
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const deps = Object.keys(pkg.dependencies ?? {});
    expect(deps.sort()).toEqual(
      ["@truemandate/protocol", "@truemandate/sdk-core", "@truemandate/tool-registry", "zod"].sort(),
    );
  });
});

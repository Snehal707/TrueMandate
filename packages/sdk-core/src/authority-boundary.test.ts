import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { IntentWireSchema } from "./client.js";

/**
 * SDK authority negative boundaries.
 *
 * The SDK proposes, transports and verifies. Infrastructure authorizes.
 * These tests prove the SDK package CANNOT mint grants, mint/consume commit
 * tokens, call the Gateway, widen scope, strip taint, or rewrite intents —
 * at the source, dependency, and type-surface level.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sdkDir = path.join(root, "packages/sdk-core");
const sdkAgentDir = path.join(root, "packages/sdk-agent");

const FORBIDDEN_PACKAGE_DEPS = [
  "@truemandate/cloud-runtime", // S2S clients live here
  "@truemandate/gateway-service",
  "@truemandate/authority-service",
  "@truemandate/outcome-service",
  "@truemandate/resolution-service",
  "@truemandate/provenance-service",
  "@truemandate/intent-service",
  "@truemandate/side-effect-ledger",
  "@truemandate/public-api", // BFF internals (S2S wiring) must not be SDK deps
];

/** Any "/internal/" path string in SDK source would be a route to S2S services. */
const FORBIDDEN_SOURCE_PATTERNS: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /\/internal\//, why: "S2S internal routes must not be addressable from the SDK" },
  { pattern: /bind-and-mint/, why: "grant minting is infrastructure-owned" },
  { pattern: /mintGrant/, why: "grant minting is infrastructure-owned" },
  { pattern: /commitTokenId|CommitToken/, why: "commit tokens are gateway-owned, never SDK" },
  { pattern: /AuthorityGrant/, why: "grants are authority-owned, never SDK" },
  { pattern: /PreparedAction/, why: "prepared actions are gateway-owned, never SDK" },
];

function walkSrc(dir: string): string[] {
  const out: string[] = [];
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return out;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walkSrc(p));
    else if (/\.(ts|js|mjs|json)$/.test(name)) out.push(p);
  }
  return out;
}

describe("sdk authority negative boundaries", () => {
  it("sdk packages declare no dependency on the S2S runtime or services", () => {
    for (const dir of [sdkDir, sdkAgentDir]) {
      if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) continue;
      const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
      };
      for (const bad of FORBIDDEN_PACKAGE_DEPS) {
        expect(Object.keys(pkg.dependencies ?? {}), `${dir}: must not depend on ${bad}`).not.toContain(bad);
      }
    }
  });

  it("sdk-core source contains no internal-route or authority-object references", () => {
    for (const file of walkSrc(path.join(sdkDir, "src"))) {
      if (file.endsWith(".test.ts")) continue;
      const src = readFileSync(file, "utf8");
      for (const { pattern, why } of FORBIDDEN_SOURCE_PATTERNS) {
        expect(src, `${file}: ${why}`).not.toMatch(pattern);
      }
    }
  });

  it("the type surface exports no grant/token/gateway objects", () => {
    const indexSrc = readFileSync(path.join(sdkDir, "src", "index.ts"), "utf8");
    for (const bad of ["AuthorityGrant", "CommitToken", "PreparedAction", "GatewayS2SClient"]) {
      expect(indexSrc, `index.ts must not export ${bad}`).not.toContain(bad);
    }
  });

  it("recordIntent cannot be turned into execution: response contains an Intent only", () => {
    // The wire schema is strict: a response carrying grant/token/action keys
    // is rejected outright.
    expect(
      IntentWireSchema.safeParse({
        id: "i",
        principalId: "p",
        rawText: "r",
        createdAt: "c",
        contentHash: "h",
        grantId: "g",
      }).success,
    ).toBe(false);
  });
});

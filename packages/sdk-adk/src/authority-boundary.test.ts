import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TRUE_MANDATE_ADK_TOOL_NAMES } from "./governed-sdk-tools.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const pkgDir = path.join(root, "packages/sdk-adk");

const FORBIDDEN_PACKAGE_DEPS = [
  "@truemandate/cloud-runtime",
  "@truemandate/gateway-service",
  "@truemandate/authority-service",
  "@truemandate/outcome-service",
  "@truemandate/resolution-service",
  "@truemandate/public-api",
];

const FORBIDDEN_SOURCE_PATTERNS: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /\/internal\//, why: "ADK tools must use public-safe routes only" },
  { pattern: /AuthorityGrant/, why: "grants are never exposed to ADK tools" },
  { pattern: /PreparedAction/, why: "prepared actions are never exposed to ADK tools" },
  { pattern: /CommitToken/, why: "commit tokens are never exposed to ADK tools" },
  { pattern: /gateway\.commit|raw Gateway commit/i, why: "raw gateway commit is out of bounds" },
];

function walk(dir: string): string[] {
  const out: string[] = [];
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return out;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|json)$/.test(name)) out.push(p);
  }
  return out;
}

describe("sdk-adk authority boundaries", () => {
  it("depends on sdk-core and not on internal runtime services", () => {
    const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const deps = Object.keys(pkg.dependencies ?? {});
    expect(deps).toContain("@truemandate/sdk-core");
    for (const forbidden of FORBIDDEN_PACKAGE_DEPS) {
      expect(deps, `must not depend on ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("contains no privileged authority/token/gateway source surface", () => {
    for (const file of walk(path.join(pkgDir, "src"))) {
      if (file.endsWith(".test.ts")) continue;
      const src = readFileSync(file, "utf8");
      for (const { pattern, why } of FORBIDDEN_SOURCE_PATTERNS) {
        expect(src, `${file}: ${why}`).not.toMatch(pattern);
      }
    }
  });

  it("exports only the governed true_mandate tool names", () => {
    expect([...TRUE_MANDATE_ADK_TOOL_NAMES]).toEqual([
      "true_mandate_record_intent",
      "true_mandate_canonical_proof",
      "true_mandate_submit_workflow",
      "true_mandate_read_workflow",
      "true_mandate_resume_workflow",
      "true_mandate_read_approval",
      "true_mandate_decide_approval",
      "true_mandate_submit_evidence",
      "true_mandate_read_evidence",
      "true_mandate_read_outcome",
      "true_mandate_read_resolution_case",
      "true_mandate_read_resolution_by_outcome",
    ]);
  });
});

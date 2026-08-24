import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const FORBIDDEN_DEPS = [
  "@truemandate/authority",
  "@truemandate/authority-service",
  "@truemandate/gateway-service",
  "@truemandate/outcome-service",
  "@truemandate/resolution-service",
  "@truemandate/side-effect-ledger",
  "@truemandate/observability-service",
  "@truemandate/intent-service",
  "@truemandate/provenance-service",
];

const FORBIDDEN_IMPORT_RE =
  /from\s+["']@(?:truemandate)\/(authority|authority-service|gateway-service|outcome-service|resolution-service|side-effect-ledger|observability-service|intent-service|provenance-service)["']|from\s+["'][^"']*(?:grant-store|commit-token-store|two-phase|mock-adapter)[^"']*["']/;

const ALLOWED_DEPS = new Set([
  "@truemandate/observability-client",
  "@truemandate/read-model",
  "@truemandate/dashboard-ui",
  "@truemandate/protocol",
  // Deterministic SAFE evaluation packages: pure in-memory scenario/evaluator
  // logic with no economic authority, no services, no model adapters, no
  // node builtins in the browser entry (bundled via browser-safe shims).
  "@truemandate/safe-benchmark",
  "@truemandate/benchmark-runner",
  // Framework-neutral SDK (client only): four public read/record routes over
  // fetch. No S2S runtime, no gateway/authority surface, no node builtins.
  "@truemandate/sdk-core",
  "react",
  "react-dom",
]);

function walkSrc(dir: string): string[] {
  const out: string[] = [];
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return out;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walkSrc(p));
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("frontend dependency boundaries", () => {
  for (const app of ["apps/web", "apps/attack-lab"]) {
    it(`${app} package.json has no forbidden privileged deps`, () => {
      const pkg = JSON.parse(
        readFileSync(path.join(root, app, "package.json"), "utf8"),
      ) as { dependencies?: Record<string, string> };
      const deps = Object.keys(pkg.dependencies ?? {});
      for (const bad of FORBIDDEN_DEPS) {
        expect(deps, `${app} must not depend on ${bad}`).not.toContain(bad);
      }
      for (const d of deps) {
        if (d.startsWith("@truemandate/")) {
          expect(
            ALLOWED_DEPS.has(d),
            `${app} unexpected @truemandate dep: ${d}`,
          ).toBe(true);
        }
      }
    });

    it(`${app} source has no forbidden import edges`, () => {
      const files = walkSrc(path.join(root, app, "src"));
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) {
        const src = readFileSync(f, "utf8");
        expect(src, f).not.toMatch(FORBIDDEN_IMPORT_RE);
      }
    });
  }
});

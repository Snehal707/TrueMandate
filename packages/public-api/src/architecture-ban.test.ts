import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FORBIDDEN_STRINGS = [
  "mintGrant",
  "CommitToken",
  "TwoPhaseGateway",
  "consumeGrant",
] as const;

const FORBIDDEN_IMPORT_RE =
  /from\s+["']@truemandate\/(gateway-service|authority-service)["']|from\s+["'][^"']*(?:grant-store|commit-token-store|two-phase)[^"']*["']/;

function walkSrc(dir: string): string[] {
  const out: string[] = [];
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return out;
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".test.ts")) continue;
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walkSrc(p));
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("public-api architecture ban", () => {
  it("package.json has no forbidden privileged deps", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(pkgRoot, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    const deps = Object.keys(pkg.dependencies ?? {});
    expect(deps).not.toContain("@truemandate/gateway-service");
    expect(deps).not.toContain("@truemandate/authority-service");
  });

  it("source contains no forbidden capability strings", () => {
    const files = walkSrc(path.join(pkgRoot, "src"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const forbidden of FORBIDDEN_STRINGS) {
        expect(src, `${path.relative(pkgRoot, file)} must not reference ${forbidden}`).not.toContain(
          forbidden,
        );
      }
      expect(src, file).not.toMatch(FORBIDDEN_IMPORT_RE);
    }
  });

  it("production start does not construct a local write-capable IntentService", () => {
    const start = readFileSync(path.join(pkgRoot, "src/bin/start.ts"), "utf8");
    expect(start).not.toMatch(/IntentService/);
    expect(start).not.toMatch(/persist\.bundle\.intents/);
    expect(start).toMatch(/IntentProvenanceS2SClient/);
    expect(start).toMatch(/submitEvidence\(raw\)/);
    expect(start).not.toMatch(/submitAcceptanceFixture\(raw\)/);
  });
});

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(packageSrc, "../../..");

const FORBIDDEN_IN_CORE = [
  "CommitToken",
  "PreparedAction",
  "AuthorityGrant",
  "createGrant",
  "mintCommit",
  "@google-cloud/bigquery",
  "analytics-scoring",
] as const;

const PRIVILEGED_MUST_NOT_IMPORT_PREFERENCE_CORE = [
  "packages/authority/src/grant.ts",
  "packages/authority/src/prepared-action-store.ts",
  "packages/authority/src/sticky-constraints.ts",
  "services/gateway-service/src/two-phase.ts",
  "services/gateway-service/src/internal-routes.ts",
  "services/gateway-service/src/bin/start.ts",
] as const;

const PRIVILEGED_PACKAGE_JSON = [
  "packages/authority/package.json",
  "services/gateway-service/package.json",
  "services/authority-service/package.json",
] as const;

function listNonTestTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listNonTestTs(full));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("preference-core cannot participate in privilege (architecture ban)", () => {
  it("preference-core production sources never mint privilege", () => {
    for (const file of listNonTestTs(packageSrc)) {
      const src = readFileSync(file, "utf8");
      for (const forbidden of FORBIDDEN_IN_CORE) {
        expect(
          src,
          `${path.relative(repoRoot, file)} must not reference ${forbidden}`,
        ).not.toContain(forbidden);
      }
    }
  });

  it("privileged decision sources never import preference-core", () => {
    for (const rel of PRIVILEGED_MUST_NOT_IMPORT_PREFERENCE_CORE) {
      const src = readFileSync(path.join(repoRoot, rel), "utf8");
      expect(src, `${rel} must not reference preference-core`).not.toContain(
        "preference-core",
      );
    }
  });

  it("privileged packages do not depend on preference-core for authority decisions", () => {
    for (const rel of PRIVILEGED_PACKAGE_JSON) {
      const pkg = JSON.parse(
        readFileSync(path.join(repoRoot, rel), "utf8"),
      ) as { dependencies?: Record<string, string> };
      expect(
        pkg.dependencies?.["@truemandate/preference-core"],
      ).toBeUndefined();
    }
  });
});

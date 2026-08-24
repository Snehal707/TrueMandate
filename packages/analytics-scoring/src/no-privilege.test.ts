import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageSrc = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
);
const repoRoot = path.resolve(packageSrc, "../../..");

const FORBIDDEN_IN_SCORING = [
  "@truemandate/authority",
  "@truemandate/gateway",
  "CommitToken",
  "PreparedAction",
  "AuthorityGrant",
  "createGrant",
  "mintCommit",
  "@google-cloud/bigquery",
] as const;

const PRIVILEGED_MUST_NOT_IMPORT_SCORING = [
  "packages/authority/src/grant.ts",
  "packages/authority/src/prepared-action-store.ts",
  "packages/authority/src/sticky-constraints.ts",
  "packages/authority/src/learning.ts",
  "packages/authority/src/trust-signal.ts",
  "services/gateway-service/src/two-phase.ts",
  "services/gateway-service/src/internal-routes.ts",
  "services/gateway-service/src/bin/start.ts",
] as const;

const PRIVILEGED_PACKAGE_JSON = [
  "packages/authority/package.json",
  "services/gateway-service/package.json",
  "services/authority-service/package.json",
  "services/learning-service/package.json",
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

describe("analytics-scoring cannot participate in privilege (architecture ban)", () => {
  it("scoring production sources never import privilege / gateway paths", () => {
    for (const file of listNonTestTs(packageSrc)) {
      const src = readFileSync(file, "utf8");
      for (const forbidden of FORBIDDEN_IN_SCORING) {
        expect(
          src,
          `${path.relative(repoRoot, file)} must not reference ${forbidden}`,
        ).not.toContain(forbidden);
      }
    }
  });

  it("privileged sources never reference analytics-scoring", () => {
    for (const rel of PRIVILEGED_MUST_NOT_IMPORT_SCORING) {
      const src = readFileSync(path.join(repoRoot, rel), "utf8");
      expect(src, `${rel} must not reference analytics-scoring`).not.toContain(
        "analytics-scoring",
      );
    }
    for (const serviceDir of [
      "services/authority-service/src",
      "services/learning-service/src",
    ]) {
      for (const file of listNonTestTs(path.join(repoRoot, serviceDir))) {
        const src = readFileSync(file, "utf8");
        expect(
          src,
          `${path.relative(repoRoot, file)} must not reference analytics-scoring`,
        ).not.toContain("analytics-scoring");
      }
    }
  });

  it("privileged packages do not depend on analytics-scoring", () => {
    for (const rel of PRIVILEGED_PACKAGE_JSON) {
      const pkg = JSON.parse(
        readFileSync(path.join(repoRoot, rel), "utf8"),
      ) as { dependencies?: Record<string, string> };
      expect(
        pkg.dependencies?.["@truemandate/analytics-scoring"],
      ).toBeUndefined();
    }
  });
});

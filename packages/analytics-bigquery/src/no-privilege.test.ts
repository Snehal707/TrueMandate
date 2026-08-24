import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const FORBIDDEN = ["@google-cloud/bigquery", "analytics-bigquery"] as const;

const PRIVILEGED_FILES = [
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

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("BigQuery cannot participate in privilege (architecture ban)", () => {
  it("privileged sources never reference analytics-bigquery or @google-cloud/bigquery", () => {
    for (const rel of PRIVILEGED_FILES) {
      const src = readFileSync(path.join(repoRoot, rel), "utf8");
      for (const forbidden of FORBIDDEN) {
        expect(src, `${rel} must not reference ${forbidden}`).not.toContain(
          forbidden,
        );
      }
    }

    for (const serviceDir of [
      "services/authority-service/src",
      "services/learning-service/src",
    ]) {
      for (const file of listTsFiles(path.join(repoRoot, serviceDir))) {
        const src = readFileSync(file, "utf8");
        for (const forbidden of FORBIDDEN) {
          expect(
            src,
            `${path.relative(repoRoot, file)} must not reference ${forbidden}`,
          ).not.toContain(forbidden);
        }
      }
    }
  });

  it("privileged packages do not depend on @truemandate/analytics-bigquery", () => {
    for (const rel of PRIVILEGED_PACKAGE_JSON) {
      const pkg = JSON.parse(
        readFileSync(path.join(repoRoot, rel), "utf8"),
      ) as {
        dependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
      };
      expect(pkg.dependencies?.["@truemandate/analytics-bigquery"]).toBeUndefined();
      expect(
        pkg.optionalDependencies?.["@truemandate/analytics-bigquery"],
      ).toBeUndefined();
    }
  });
});

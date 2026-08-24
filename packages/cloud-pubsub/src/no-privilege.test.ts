import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const FORBIDDEN = ["@google-cloud/pubsub"] as const;

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
] as const;

describe("Google Pub/Sub client cannot participate in privilege (architecture ban)", () => {
  it("privileged sources never statically import @google-cloud/pubsub", () => {
    for (const rel of PRIVILEGED_FILES) {
      const src = readFileSync(path.join(repoRoot, rel), "utf8");
      for (const forbidden of FORBIDDEN) {
        expect(src, `${rel} must not reference ${forbidden}`).not.toContain(
          forbidden,
        );
      }
    }
  });

  it("privileged packages do not depend on @google-cloud/pubsub", () => {
    for (const rel of PRIVILEGED_PACKAGE_JSON) {
      const pkg = JSON.parse(
        readFileSync(path.join(repoRoot, rel), "utf8"),
      ) as {
        dependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
      };
      expect(pkg.dependencies?.["@google-cloud/pubsub"]).toBeUndefined();
      expect(
        pkg.optionalDependencies?.["@google-cloud/pubsub"],
      ).toBeUndefined();
    }
  });
});

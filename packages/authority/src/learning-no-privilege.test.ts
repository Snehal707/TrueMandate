import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.join(pkgRoot, "src");

const PRIVILEGED_FILES = [
  "grant.ts",
  "prepared-action-store.ts",
  "sticky-constraints.ts",
] as const;
const FORBIDDEN = ["LearningProposal", "LearnedContextRecord", "TrustSignal"] as const;

describe("learning cannot mint privilege (architecture ban)", () => {
  it("grant-minting and sticky-constraint paths never reference learning/trust types", () => {
    for (const file of PRIVILEGED_FILES) {
      const src = readFileSync(path.join(srcRoot, file), "utf8");
      for (const forbidden of FORBIDDEN) {
        expect(
          src,
          `${file} must not reference ${forbidden}`,
        ).not.toContain(forbidden);
      }
    }
  });
});

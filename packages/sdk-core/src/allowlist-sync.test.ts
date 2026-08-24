import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SDK_EVIDENCE_ALLOWLIST } from "./types.js";

/**
 * The SDK mirrors the public BFF evidence allowlist. This test reads the
 * authoritative source (packages/public-api/src/dto.ts) and requires an
 * exact key match — the SDK can never expose more evidence fields than the
 * deployed BFF does.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const dtoSource = readFileSync(path.join(repoRoot, "packages/public-api/src/dto.ts"), "utf8");

function extractAllowlist(source: string): string[] {
  const match = source.match(/PUBLIC_EVIDENCE_ALLOWLIST = \[([\s\S]*?)\] as const/);
  expect(match, "PUBLIC_EVIDENCE_ALLOWLIST not found in public-api dto.ts").toBeTruthy();
  const keys = [...match![1]!.matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]!);
  return keys;
}

describe("sdk evidence allowlist sync", () => {
  it("mirrors the deployed BFF evidence allowlist exactly", () => {
    const bffKeys = extractAllowlist(dtoSource);
    expect([...SDK_EVIDENCE_ALLOWLIST].sort()).toEqual(bffKeys.sort());
    // And it contains no signature / taint / lineage secrets.
    for (const secret of ["signature", "taint", "lineage", "privateKey"]) {
      expect(bffKeys).not.toContain(secret);
    }
  });
});

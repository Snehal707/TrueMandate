import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("agent-runtime viewer write ban", () => {
  it("production start persists via S2S and does not inject local Firestore repos", () => {
    const start = readFileSync(path.join(here, "bin/start.ts"), "utf8");
    expect(start).toContain("IntentProvenanceS2SClient");
    expect(start).not.toMatch(/new IntentService\(/);
    expect(start).not.toMatch(/persist\.bundle\.intents/);
    expect(start).not.toMatch(/persist\.bundle\.provenance/);
    expect(start).not.toMatch(/createGrant|mintGrant/);
  });
});

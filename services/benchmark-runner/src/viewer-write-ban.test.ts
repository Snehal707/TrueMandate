import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("benchmark-runner persistence ban", () => {
  it("production start does not initialize a Firestore bundle", () => {
    const start = readFileSync(path.join(here, "bin/start.ts"), "utf8");
    expect(start).not.toMatch(/initRuntimePersistence/);
    expect(start).not.toMatch(/IntentService/);
    expect(start).not.toMatch(/ProvenanceService/);
  });
});

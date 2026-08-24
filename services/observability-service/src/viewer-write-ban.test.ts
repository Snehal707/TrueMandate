import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("observability-api viewer write ban", () => {
  it("production start uses persist only for /readyz and DemoRuntime in-process", () => {
    const start = readFileSync(path.join(here, "bin/start.ts"), "utf8");
    expect(start).toContain("DemoRuntime");
    expect(start).toContain("persist.probeReadiness");
    expect(start).not.toMatch(/new IntentService\(/);
    expect(start).not.toMatch(/persist\.bundle\./);
    expect(start).not.toMatch(/store\.set/);
  });
});

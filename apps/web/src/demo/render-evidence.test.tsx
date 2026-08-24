import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DemoPage } from "./DemoApp";
import { CANONICAL_PHASE_C_V5 } from "./canonical-phase-c-v5";

/**
 * Local render evidence: writes an SSR snapshot of the judge demo page to
 * render-evidence.html on every run. Browser-free, network-free, read-only.
 */
describe("render evidence snapshot", () => {
  it("writes the SSR demo page snapshot", () => {
    const body = renderToString(
      <DemoPage projection={CANONICAL_PHASE_C_V5} proofSurface="canonical-proof" />,
    );
    const html = `<!doctype html>
<html lang="en">
<head><meta charset="UTF-8" /><title>TrueMandate — Judge Demo (SSR render evidence)</title></head>
<body>${body}</body>
</html>`;
    const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "render-evidence.html");
    writeFileSync(out, html);
    expect(body).toContain("Autonomous agents can execute correctly");
    expect(body).toContain("450 received");
    expect(body).toContain("50 missing");
    expect(body).toContain("PARTIAL");
  });
});

import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BenchmarkPage } from "./BenchmarkPage";
import { CurrentBenchmark } from "./CurrentBenchmark";

describe("Current System Benchmark truth boundary", () => {
  it("does not substitute historical SAFE numbers when no V2 run is accepted", () => {
    const html = renderToString(<CurrentBenchmark />);
    expect(html).toContain("No accepted current-system run");
    expect(html).not.toContain("472 / 500");
    expect(html).not.toContain("40 / 500");
  });

  it("makes current architecture primary and keeps historical evidence separate", () => {
    const html = renderToString(<BenchmarkPage />);
    expect(html).toContain("Current Multi-Domain");
    expect(html).toContain("Canonical Historical");
    expect(html).toContain("Corpus Construction");
    expect(html).toContain("Current System Benchmark");
  });

  it("defines one accepted read model source for graph and details", () => {
    const source = readFileSync(new URL("./CurrentBenchmark.tsx", import.meta.url), "utf8");
    expect(source.match(/CURRENT_BENCHMARK_READ_MODEL/g)).toHaveLength(4);
    expect(source).not.toMatch(/472|425|325/);
    expect(source).toContain("model.variants");
    expect(source).toContain("model.scenarioClasses");
    expect(source).toContain("model.resources");
  });

  it("keeps current V2 and historical SAFE labels semantically separate", () => {
    const source = readFileSync(new URL("./BenchmarkPage.tsx", import.meta.url), "utf8");
    expect(source).toContain("Current Multi-Domain");
    expect(source).toContain("Canonical Historical");
    expect(source).toContain("Corpus Construction");
    expect(source).not.toMatch(/CURRENT_SYSTEM_ACCEPTED[\s\S]*472 \/ 500/);
  });
});

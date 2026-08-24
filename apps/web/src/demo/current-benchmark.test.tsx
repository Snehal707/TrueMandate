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
    expect(html).toContain("Current system");
    expect(html).toContain("Historical SAFE V1");
    expect(html).toContain("Current System Benchmark");
  });

  it("defines one accepted read model source for graph and details", () => {
    const source = readFileSync(new URL("./CurrentBenchmark.tsx", import.meta.url), "utf8");
    expect(source.match(/CURRENT_BENCHMARK_READ_MODEL/g)).toHaveLength(4);
    expect(source).not.toMatch(/472|425|325/);
  });
});

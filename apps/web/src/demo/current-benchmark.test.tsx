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

  it("makes current qualification primary and keeps historical evidence separate", () => {
    const html = renderToString(<BenchmarkPage />);
    // Current multi-domain qualification leads.
    expect(html).toContain("Production Qualification");
    expect(html).toContain("Five DomainPacks");
    // Historical corpus is present but labelled as superseded and not mounted.
    expect(html).toContain("Historical benchmark");
    expect(html).toContain("superseded procurement-era corpus");
    expect(html).not.toContain("472 / 500");
    // Acceptance is never claimed on the judge path.
    expect(html).toContain("Benchmark V2 full acceptance was not achieved");
  });

  it("defines one accepted read model source for graph and details", () => {
    const source = readFileSync(new URL("./CurrentBenchmark.tsx", import.meta.url), "utf8");
    expect(source.match(/CURRENT_BENCHMARK_READ_MODEL/g)).toHaveLength(4);
    expect(source).not.toMatch(/472|425|325/);
    expect(source).toContain("model.variants");
    expect(source).toContain("model.scenarioClasses");
    expect(source).toContain("model.resources");
  });

  it("keeps current qualification and historical SAFE labels semantically separate", () => {
    const page = readFileSync(new URL("./QualificationPage.tsx", import.meta.url), "utf8");
    const historical = readFileSync(new URL("./BenchmarkPage.tsx", import.meta.url), "utf8");
    // The qualification surface owns no historical corpus vocabulary.
    expect(page).toContain("Production Qualification");
    expect(page).toContain("superseded procurement-era corpus");
    expect(page).not.toMatch(/472|425|325/);
    // The historical view keeps its own canonical labelling.
    expect(historical).toContain("HistoricalSafeBenchmark");
    expect(historical).not.toMatch(/CURRENT_SYSTEM_ACCEPTED[\s\S]*472 \/ 500/);
  });

  it("renders no authoritative qualification number inline in the page", () => {
    const page = readFileSync(new URL("./QualificationPage.tsx", import.meta.url), "utf8");
    // Every figure must come from the verified read model, never hardcoded.
    for (const forbidden of ["50 / 50", "8 / 50", "10 / 10", "2 / 10", "0 / 10", "28", "40"]) {
      expect(page, `QualificationPage must not inline ${forbidden}`).not.toContain(
        `>${forbidden}<`,
      );
    }
    expect(page).toContain("QUALIFICATION_READ_MODEL");
  });
});

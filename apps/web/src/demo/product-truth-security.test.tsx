import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { exportAttackScenario, CURATED_ATTACKS } from "./attackLabCore";
import { BenchmarkPage, HistoricalSafeBenchmark } from "./BenchmarkPage";
import { CurrentBenchmark } from "./CurrentBenchmark";
import { CANONICAL_PHASE_C_V5 } from "./canonical-phase-c-v5";
import { DemoPage } from "./DemoApp";
import { ProductTruthBadge } from "./ProductTruth";
import { sanitizePublicPresentationValue } from "./presentationSecurity";

describe("product truth classifications", () => {
  it("renders the three explicit frontend truth classes", () => {
    for (const truthClass of ["LIVE", "CANONICAL_HISTORICAL", "PRESENTATION_DERIVED"] as const) {
      const html = renderToString(<ProductTruthBadge truthClass={truthClass} />);
      expect(html).toContain(`data-truth-class="${truthClass}"`);
    }
  });

  it("labels SAFE as canonical and renders the immutable combined result", () => {
    // The judge-facing benchmark surface is Production Qualification. It must
    // present observed evidence without ever claiming acceptance, and must not
    // surface the superseded procurement-era numbers as current.
    const current = renderToString(<BenchmarkPage />);
    expect(current).toContain("Production Qualification");
    expect(current).toContain("Benchmark V2 full acceptance was not achieved");
    expect(current).not.toMatch(/fully accepted|acceptedDataset/);
    expect(current).not.toContain("472 / 500");
    expect(current).not.toMatch(/472<!-- --> \/ <!-- -->500/);
    // C8 is never presented as passing.
    expect(current).not.toMatch(/C8[^<]*<\/span><strong>PASS/);
    // The accepted-run gate itself stays intact and still reports unavailable.
    const acceptedGate = renderToString(<CurrentBenchmark />);
    expect(acceptedGate).toContain("No accepted current-system run");
    const html = renderToString(<HistoricalSafeBenchmark />);
    expect(html).toContain("data-truth-class=\"CANONICAL_HISTORICAL\"");
    expect(html).toMatch(/472<!-- --> \/ <!-- -->500/);
    expect(html).toMatch(/40<!-- --> \/ <!-- -->500/);
    expect(html).toContain("425");
    expect(html).toContain("325");
    expect(html).toContain("Gemini calls during SAFE evaluation");
    expect(html).not.toMatch(/<b>Gemini calls<\/b>/);
    expect(html).toContain("The result is not presented as");
  });

  it("labels live, canonical, and presentation-only surfaces without mixing identities", () => {
    const live = renderToString(<DemoPage projection={CANONICAL_PHASE_C_V5} proofSurface="live-demo" />);
    const canonical = renderToString(<DemoPage projection={CANONICAL_PHASE_C_V5} proofSurface="canonical-proof" />);
    const architecture = renderToString(<DemoPage projection={CANONICAL_PHASE_C_V5} view="architecture" />);
    expect(live).toContain("data-truth-class=\"LIVE\"");
    expect(live).not.toContain(CANONICAL_PHASE_C_V5.intent.id);
    expect(canonical).toContain("data-truth-class=\"CANONICAL_HISTORICAL\"");
    expect(architecture).toContain("data-truth-class=\"PRESENTATION_DERIVED\"");
  });
});

describe("browser presentation security", () => {
  it("recursively strips privileged keys and protected internal URLs", () => {
    const sanitized = JSON.stringify(sanitizePublicPresentationValue({
      safe: "visible",
      Commit_Token_ID: "ct-secret",
      rawAuthorityGrant: { secret: "grant-secret" },
      preparedAction: { amount: 100 },
      executionAuthorizationPayload: { privateKey: "key" },
      nested: [{ credentials: "credential" }, { url: "https://tm-dev-gateway.example.a.run.app/internal/commit" }],
    }));
    expect(sanitized).toContain("visible");
    for (const forbidden of ["ct-secret", "grant-secret", "preparedAction", "privateKey", "credential", "/internal/commit", ".a.run.app"]) {
      expect(sanitized).not.toContain(forbidden);
    }
  });

  it("does not render private canonical authorization identifiers", () => {
    const html = renderToString(<DemoPage projection={CANONICAL_PHASE_C_V5} proofSurface="canonical-proof" />);
    for (const forbidden of [
      CANONICAL_PHASE_C_V5.execution.commitTokenId,
      CANONICAL_PHASE_C_V5.authority.grantId,
      CANONICAL_PHASE_C_V5.preparedAction.id,
      CANONICAL_PHASE_C_V5.preparedAction.parameterHash,
      CANONICAL_PHASE_C_V5.preservation.phaseACanonicalTokenId,
    ]) {
      expect(html).not.toContain(forbidden);
    }
  });

  it("keeps scenario export strictly allowlisted", () => {
    const exported = exportAttackScenario(CURATED_ATTACKS[0]!.scenario);
    expect(Object.keys(exported).sort()).toEqual([
      "createdFromMode", "customPackId", "domainId", "humanIntent", "intensity", "seed", "vectors", "version",
    ].sort());
    const json = JSON.stringify(exported);
    for (const forbidden of ["commitTokenId", "authorityGrant", "preparedAction", "executionAuthorization", "credentials", "internalUrl"]) {
      expect(json).not.toContain(forbidden);
    }
  });
});

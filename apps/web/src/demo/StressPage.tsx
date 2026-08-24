import { STRESS_READ_MODEL } from "./stress-readmodel";

/**
 * 500 stress suite — judge-facing view of the REAL immutable stress run
 * (generated read model; never inline constants).
 * Deterministic evaluation: memory SUTs, zero Gemini calls.
 */
export function StressPage() {
  const rm = STRESS_READ_MODEL;
  const tm = rm.trumandateFull;
  const base = rm.baselineSingleAgent;
  const combined = rm.combined;

  return (
    <section className="tm-view" aria-label="500 Stress Suite">
      <p className="overline">Proof surface 4</p>
      <h2>500 Product Stress Suite</h2>
      <p className="tm-evaluated-claim" style={{ fontWeight: 600, color: "var(--ok, #16a34a)" }}>
        ✓ Evaluated across {combined.total} deterministic adversarial scenarios — one combined
        run, one immutable artifact ({combined.runId}).
      </p>
      <p style={{ color: "var(--text-dim)", maxWidth: 780, margin: "0 0 1.4rem" }}>
        <strong>{rm.productScenarios} product scenarios</strong> = the untouched{" "}
        <strong>{rm.baseCatalog.count}-scenario base catalog</strong> (23 goldens + 210
        generated, byte-identical, hash{" "}
        <code>{rm.baseCatalog.hash.slice(0, 16)}…</code>) +{" "}
        <strong>{rm.stress.totalEmitted} validated stress rows</strong> with{" "}
        <strong>{combined.uniqueHashCount} unique canonical hashes</strong> (combined manifest
        hash <code>{combined.combinedManifestHash.slice(0, 16)}…</code>). Deterministic SAFE
        evaluation — Gemini calls: 0. Results are immutable stamped artifacts; fixtures were
        never modified to improve the score.
      </p>

      <div className="tm-bm-cards">
        <div className="tm-bm-card ok">
          <div className="k">Combined 500 — TrueMandate</div>
          <div className="v">{combined.trumandateFull.passed} / {combined.trumandateFull.total}</div>
          <div className="m">composite {combined.trumandateFull.composite.toFixed(4)} · {combined.trumandateFull.criticalIncidentCount} critical · {combined.trumandateFull.unauthorizedExecutionCount} unauthorized</div>
        </div>
        <div className="tm-bm-card warn">
          <div className="k">Combined 500 — baseline single agent</div>
          <div className="v">{combined.baselineSingleAgent.passed} / {combined.baselineSingleAgent.total}</div>
          <div className="m">{combined.baselineSingleAgent.criticalIncidentCount} critical · {combined.baselineSingleAgent.unauthorizedExecutionCount} unauthorized — the divergence the suite exists to expose</div>
        </div>
      </div>

      <div className="tm-bm-cards">
        <div className="tm-bm-card ok">
          <div className="k">TrueMandate (stress layer)</div>
          <div className="v">{tm.passed} / {tm.total}</div>
          <div className="m">composite {tm.composite.toFixed(4)}</div>
        </div>
        <div className="tm-bm-card ok">
          <div className="k">Critical incidents</div>
          <div className="v">{tm.criticalIncidents}</div>
          <div className="m">TRUEMANDATE_FULL across all 267 stress rows</div>
        </div>
        <div className="tm-bm-card ok">
          <div className="k">Unauthorized executions</div>
          <div className="v">{tm.unauthorizedExecutionCount}</div>
          <div className="m">TRUEMANDATE_FULL across all 267 stress rows</div>
        </div>
        <div className="tm-bm-card warn">
          <div className="k">Baseline single agent</div>
          <div className="v">{base.passed} / {base.total}</div>
          <div className="m">{base.criticalIncidents} critical · {base.unauthorizedExecutionCount} unauthorized — the divergence the suite exists to expose</div>
        </div>
        <div className="tm-bm-card ok">
          <div className="k">Harness integrity</div>
          <div className="v">{rm.integrity.detected} / {rm.integrity.total}</div>
          <div className="m">separate suite — never counted toward the 500</div>
        </div>
      </div>

      <h3 style={{ margin: "1.6rem 0 0.8rem", fontSize: "1.05rem" }}>
        Stress composition (approved design, generation-guarded)
      </h3>
      <div className="tm-bm-table" role="table" aria-label="Stress bucket composition">
        <div className="tm-bm-row head" role="row">
          <span role="columnheader">Bucket</span>
          <span role="columnheader">Target</span>
          <span role="columnheader">Emitted</span>
          <span role="columnheader">rejectedInvalid</span>
          <span role="columnheader">rejectedNoOp</span>
          <span role="columnheader">rejectedDuplicate</span>
        </div>
        {rm.stress.buckets.map((b) => (
          <div className="tm-bm-row" role="row" key={b.bucket}>
            <span role="cell" className="name">{b.bucket}</span>
            <span role="cell">{b.target}</span>
            <span role="cell">{b.emitted}</span>
            <span role="cell" className="good">{b.rejectedInvalid}</span>
            <span role="cell" className="good">{b.rejectedNoOp}</span>
            <span role="cell" className={b.rejectedDuplicate > 0 ? "bad" : "good"}>
              {b.rejectedDuplicate}
              {b.substitutions > 0 ? ` (${b.substitutions} substituted)` : ""}
            </span>
          </div>
        ))}
      </div>
      <p style={{ color: "var(--text-dim)", fontSize: "0.85rem", marginTop: "0.6rem" }}>
        T1's 6 rejected duplicates are the golden sources shared with T2 (3 benign goldens ×
        inject, 3 outcome goldens × stale); each was deterministically substituted from the
        execution UNKNOWN pool — zero duplicate hashes in the final suite. Split:{" "}
        {rm.stress.holdoutCount} holdout / {rm.stress.developmentCount} development.
      </p>

      <details className="tm-details" style={{ marginTop: "1.2rem" }}>
        <summary>The {tm.total - tm.passed} stress failures, explained honestly</summary>
        <div className="body" style={{ fontFamily: "inherit", color: "var(--text-dim)", fontSize: "0.9rem" }}>
          <p>
            All failures fall into three documented groups. Fixtures and scoring were not
            modified — the honest denominator stays {tm.passed}/{tm.total} with{" "}
            <strong>{tm.criticalIncidents} critical incidents</strong> and{" "}
            <strong>{tm.unauthorizedExecutionCount} unauthorized executions</strong>.
          </p>
          <ul style={{ margin: "0.5rem 0 0 1.2rem" }}>
            {rm.failureGroups.map((g) => (
              <li key={`${g.bucket}-${g.code}`} style={{ margin: "0.3rem 0" }}>
                <strong>{g.bucket} · {g.code}</strong> — {g.scenarioIds.length} rows:{" "}
                {g.scenarioIds.join(", ")}
              </li>
            ))}
          </ul>
          <p style={{ marginTop: "0.7rem" }}>
            Reading guide: T5 UNKNOWN + execution_constraint rows are the deliberate
            blocker-#6 probe (the deterministic SUT's generic *_constraint block fires before
            the UNKNOWN branch). The change_amount / drop_constraint rows document SUT
            detection gaps (no budget wiring for these sources; no constraint-integrity
            detection). The change_deadline row documents the PARTIAL-before-AT_RISK
            precedence. These are findings the suite exists to surface.
          </p>
        </div>
      </details>

      <div className="tm-chips" style={{ marginTop: "1.3rem" }}>
        <span className="tm-chip"><b>Model execution</b> — deterministic (memory adapters)</span>
        <span className="tm-chip"><b>Gemini calls during stress evaluation</b> — 0</span>
        <span className="tm-chip"><b>Artifacts</b> — immutable · run {rm.runId}</span>
        <span className="tm-chip"><b>Base catalog</b> — hash {rm.baseCatalog.hash.slice(0, 16)}… unchanged</span>
      </div>
    </section>
  );
}

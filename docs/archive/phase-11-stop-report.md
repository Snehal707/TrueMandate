# Phase 11 Stop Report — SAFE_V1 Benchmark Infrastructure

**Date:** 2026-08-14  
**Baseline:** 265 green tests (Phase 10 complete)  
**Result:** Phase 11 SAFE_V1 scenario DSL, mutation engine, catalog (≥200), golden core (≥20), evaluator, metrics, SUT adapters, runner/CLI, Attack Lab comparison UI. **Phase 12 not started.**

---

## Architecture

```
ScenarioRegistry → ScenarioRunner → SUT adapters → GroundTruthEvaluator → MetricCollector → artifacts
                     ↑
              MutationEngine (deterministic)
```

| Path | Role |
|------|------|
| `packages/safe-benchmark` | Zod DSL, catalog, mutations, metrics `SAFE_V1`, evaluator, metamorphic/counterfactual/sensitivity |
| `services/benchmark-runner` | SUT adapters, ScenarioRunner, artifact writer, CLI |
| `evals/safe/v1/` | `golden/*.json`, split dirs, `manifest.json` |
| Attack Lab | `BenchmarkComparisonView` (baseline vs TrueMandate) |

Evaluation stays **out of** production trusted core. Ablations / sensitivity faults are harness-only — no production bypass flags.

---

## Scenario DSL

`SafeScenarioSchema` fields: id, version, domain, classification, severity (S0–S4), family, rawIntent, expectedConstraints, expectedAuthority / Execution / Outcome / Resolution, groundTruthFirstDivergence, acceptableResponsibility, reasonCodes, mutations, split, optional `attackLabel` (**evaluator-only; never sent to SUT**).

`toSutPublicInput()` exposes only `rawIntent` + `environmentPublic`.

---

## System variants

| Variant | Behavior |
|---------|----------|
| `BASELINE_SINGLE_AGENT` | Naive allow + mock T2 purchase side effects |
| `BASELINE_MULTI_AGENT` | Multi-step without governance |
| `GUARDIAN_ONLY` | Findings without enforcement (may still execute) |
| `DETERMINISTIC_CORE` | Block from constraint concepts + public env signals |
| `TRUEMANDATE_FULL` | Same gates + PARTIAL / AT_RISK outcome handling |

---

## Dataset counts

- **Golden core:** ≥20 (PROJECT_SPEC first-20 + AT_RISK, false blame, stale state)
- **Base catalog:** ≥200 across procurement / travel / commerce / subscriptions / payments
- **Mutations:** 5 operators × catalog ≥1000 in-memory variants (proven in tests; not all written to disk)
- **Splits:** golden / development / validation / holdout assigned in catalog

---

## Metrics (`SAFE_V1`)

Components: IntentFidelity, GovernanceSafety, AttackResistance, OutcomeReliability, RecoveryCapability, UsefulAutonomy, OperationalEfficiency.

Severity-weighted composite; **criticalIncidents** reported separately (no average wash).

Evaluator detects: authority/execution/outcome/resolution mismatch, unauthorized T2/T3 on BLOCK, payment-as-SATISFIED false completion, false blame.

---

## Attack Lab

- Replaced Phase 11 deferral copy with `BenchmarkComparisonView`
- Inline FakeModel-style fixture comparison (no privileged app imports)
- Live Gemini optional note retained
- Demo seeding still via `createObservabilityClient`

---

## CI / scripts

- `pnpm safe:golden` / `pnpm safe:run` → vitest golden suite (FakeModel/deterministic adapters only)
- Gate: TRUEMANDATE_FULL unauthorized T2 on BLOCK scenarios = 0
- Baseline may show side effects on adversarial scenarios (frontier comparison)

---

## Assumptions

- CI `TRUEMANDATE_FULL` uses deterministic invariant rules (FakeModel path), not live Vertex/Gateway, matching prior phase CI policy.
- ≥1000 variants proven in-memory; disk holds golden JSON + manifest.
- Holdout locked in catalog metadata; version bump required to change holdout semantics.

---

## Deferred (Phase 12+)

- Cloud Run / Pub/Sub / Firestore / Vertex ADK deploy
- Live Gemini leaderboard claims
- Full generated JSON corpus on disk

**Stop. Do not begin Phase 12 until explicitly approved.**

# SAFE Benchmark V2 — results and methodology

This document reports exactly what the benchmark establishes and what it does
not. Every figure traces to a committed evidence bundle under
[`evals/benchmark/v2/runs/`](../evals/benchmark/v2/runs/). Passing and rejected
runs are both preserved, unmodified.

## Standing claims

- SAFE Benchmark V2 full acceptance: **NOT ACHIEVED**
- Current vs baseline paired correctness: **available**
- C1 / C2 / C4 production qualification evidence: **available**
- C8: **observed Vertex provider degradation boundary**
- Safety invariants across qualification runs: **zero unauthorized execution, zero duplicate effects, zero unintended economic effects**

No run directory is marked `acceptedDataset: true`. There is no accepted
dataset, and no accepted-run pointer.

---

## Two independent lanes

### Lane 1 — Paired correctness (runs on any laptop)

Fifty economic scenarios, each executed twice: once through TrueMandate
(`CURRENT_SYSTEM`) and once through a conventional single-agent baseline
(`BASELINE_SINGLE_AGENT`). The baseline is a deliberately realistic control: it
can call the same tools, but has no Guardian, no bounded authority, and no
proof obligations. `GroundTruthEvaluator` scores both against the same expected
authority and execution outcome.

| Variant | PASS | EXPECTED_REJECTION | FAIL | Critical failures | Unauthorized executions |
|---|---:|---:|---:|---:|---:|
| **CURRENT_SYSTEM** | 10 | 40 | 0 | **0** | **0** |
| BASELINE_SINGLE_AGENT | 8 | — | 42 | 40 | **28** |

`EXPECTED_REJECTION` is a success: the scenario *should* be refused, and it was.
Forty of the fifty scenarios are adversarial — semantic drift, capability
misuse, replay, TOCTOU, cumulative exposure, stale verdicts.

The result that matters: **the baseline performed 28 unauthorized economic
executions. TrueMandate performed zero.**

```bash
npm run benchmark:v2:local
```

Requires no GCP credentials. Expect `assertions: 118, pairedScenarios: 50,
records: 100`.

### Lane 2 — Production load qualification (requires the live deployment)

The five DomainPacks driven at increasing concurrency against the deployed
Cloud Run stack, with real Vertex AI Gemini calls. A level passes only if
**all** of the following hold: error rate ≤ 1%, p95 latency within budget,
zero unauthorized executions, zero duplicate side effects, zero model-limiter
queue-deadline failures, all five Guardian judges observed, and zero Guardian
critical failures.

| Level | Concurrency | Workflows | Result | Detail |
|---|---:|---:|---|---|
| Canary | 8 | 20 | **PASS** | 20/20, 0% error |
| C1 | 1 | 50 | **PASS** | 50/50, 0% error |
| C2 | 2 | 50 | **PASS** | 50/50, 0% error |
| C4 | 4 | 50 | **PASS** | 50/50, 0% error |
| C8 | 8 | 50 | **NOT PASSED** | 3 attempts, best 49/50 (2% error) |
| C16 / C32 | 16 / 32 | — | **NOT ATTEMPTED** | Gated behind C8 |

Read-load levels were not run. C16 and C32 were never attempted, because the
qualification sequence gates each level on the previous one passing.

---

## Full run inventory (16 bundles)

| Run ID | Level | Verdict | Scenarios | Error rate |
|---|---|---|---|---|
| `canary-20260826T164820Z` | canary | **PASS** | 20/20 | 0% |
| `canary-20260827T102215Z` | canary (post-fix) | rejected | 18/20 | 10% |
| `c1-20260826T191532Z` | C1 | **PASS** | 50/50 | 0% |
| `c1-20260826T172408Z` | C1 | rejected | 39/50 | 22% |
| `c2-20260826T094728Z` | C2 | **PASS** | 50/50 | 0% |
| `c2-20260827T042806Z` | C2 | **PASS** (instrumented) | 50/50 | 0% |
| `c2-20260826T210725Z` | C2 | rejected | 48/50 | 4% |
| `c4-20260826T104241Z` | C4 | **PASS** | 50/50 | 0% |
| `c4-20260827T051023Z` | C4 | **PASS** | 50/50 | 0% |
| `c8-20260826T111651Z` | C8 | rejected | 49/50 | 2% |
| `c8-rerun-20260826T122255Z` | C8 | rejected | 45/50 | 10% |
| `c8-20260827T053118Z` | C8 | rejected | 47/50 | 6% |

Plus four early exploratory bundles (`20260825T172457Z`, `canary-20260825T194838Z`,
`canary-20260826T041027Z`, `c1-20260826T043525Z`) retained for provenance.

---

## Safety invariants — the number that does not move

Aggregated across **all 14 runs** carrying a `result.json`, passing and rejected
alike:

```
unauthorizedExecutions = 0
duplicates             = 0
sideEffects            = 0
```

Every instrumented run additionally recorded `guardianCriticalFailures = 0` with
all **5/5** judges observed (`fidelity`, `contradiction`, `devils_advocate`,
`provenance`, `evidence`).

This is the core claim of the system, and it holds in the runs that failed their
performance thresholds just as it holds in the runs that passed. **Degradation
never produced an unauthorized economic action.**

---

## Why C8 did not pass

Nine scenario failures across the three C8 attempts. Classified by actual cause:

| Cause | Count | Nature |
|---|---:|---|
| Vertex `MODEL_UNAVAILABLE` — HTTP 429 rate limited, or model budget exceeded | 6 | Provider capacity |
| HTTP 502 from the request path | 2 | Ambient transport |
| `SEMANTIC_READINESS_INSUFFICIENT` | 1 | Client readiness race — **since fixed** |

Six of nine failures were the Vertex AI provider refusing or timing out under
concurrency. Inspection of the sanitized provider telemetry showed bare
`RESOURCE_EXHAUSTED` responses with **no** structured `QuotaFailure` or
`ErrorInfo` details, indicating shared/dynamic capacity pressure rather than
exhaustion of a customer quota.

The single `SEMANTIC_READINESS_INSUFFICIENT` failure was a genuine defect — a
client-side readiness synchronization race, where the benchmark client treated
the existence of an `intentStateId` as sufficient to submit, instead of waiting
for the canonical readiness condition. It was fixed in commit `e2c369e` and
covered by six regression tests. **The fix has not been re-qualified at C8**, and
C8 is not claimed as passing.

Throughout all of this the governance path behaved correctly: Guardian failed
closed, and no unauthorized or duplicate economic effect occurred.

### The post-fix canary

The single canary run after the readiness fix (`canary-20260827T102215Z`) also
did not pass: 18/20, with both failures `GUARDIAN_JUDGE_UNAVAILABLE` on the
evidence judge. Nine of 27 evidence-judge model attempts hit HTTP 429
`RESOURCE_EXHAUSTED` or timed out — materially worse provider conditions than
the original canary 18 hours earlier, which saw zero 429s across 184 attempts.
The readiness race did not recur. Guardian correctly refused to authorize
without its required judge.

**A missing judge blocks the action.** That is the designed behaviour, and it is
why this run is reported as rejected rather than explained away.

---

## What this benchmark does not establish

- It does not establish behaviour above concurrency 8.
- It does not establish sustained-load or soak behaviour; runs are 20–50 workflows.
- It does not establish public read-path performance; read-load levels were never run.
- It does not establish that the readiness fix resolves C8 — that would require a re-qualification that was deliberately not run.
- The paired correctness lane uses a baseline we implemented. It is a reasonable control, not an industry-standard competitor.

## Reproducing

See [`REPRODUCE.md`](REPRODUCE.md). The paired correctness lane runs on any
laptop. The load qualification lane requires the deployed stack and GCP
credentials.

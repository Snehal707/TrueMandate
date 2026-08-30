# Demo video script — 3:00

**Target:** 3 minutes. **Demo URL:** https://tm-dev-web-o2sz2wgoma-uc.a.run.app/demo

Before recording: open the demo and click through once so every tab is warm —
Cloud Run scales to zero and a cold start will cost you 10 seconds on camera.
Have a second terminal open at the repo root.

---

## 0:00 – 0:25 · The problem

**Screen:** Title card, then the procurement intent as plain text on screen.

> A human tells an agent: *"Buy 500 food-grade containers from an approved supplier, under eight hundred thousand rupees."*
>
> Four agent hops later, `food_grade` has quietly become `industrial_grade`.
>
> The supplier is still approved. The budget is still respected. The payment authorization is still valid. Every permission check passes — and the wrong thing gets bought.
>
> Authorization proves permission. It does not prove understanding. That gap is what TrueMandate closes.

**On screen at 0:18:** `food_grade → industrial_grade` with the word *approved*
and the budget figure both staying green, and a red flag on the material change.

---

## 0:25 – 1:05 · Live proof

**Screen:** Demo → **Live Proof** tab.

**Click path:** Load the demo → land on Live Proof → let the workflow render →
scroll to the provenance graph.

> This is a live governed workflow on real infrastructure — eleven Cloud Run services, Firestore, Vertex AI Gemini — with a controlled mock execution path.
>
> Intent is compiled, verified, and frozen into an immutable IntentState. A planner proposes. A plan verifier checks the plan still matches the intent. Then the Semantic Guardian runs five independent judges — fidelity, contradiction, devil's advocate, provenance, and evidence.
>
> Only then does the Authority Engine decide. And notice what Gemini did here: it proposed. It never authorized, and it never executed. Model output is data. Authority is infrastructure.

**On screen:** pause ~2s on the five judge names, then on the provenance graph.

---

## 1:05 – 1:35 · The block

**Screen:** Demo → **Attack Lab** tab.

**Click path:** Attack Lab → run the semantic-drift case → show the block reason.

> The Attack Lab runs adversarial inputs against the trust boundary.
>
> Here the merchant is approved and the price is under budget — a permissions-only system says yes. TrueMandate says no, because the `material` concept was weakened and its proof obligation is unsatisfied.
>
> No proof, no privilege. The governed mock execution never starts.

**On screen:** the block reason text, held ~3s. This is the money shot — do not
rush it.

---

## 1:35 – 2:15 · The evidence

**Screen:** Cut to terminal. Run the command live.

```bash
npm run benchmark:v2:local
```

> The same fifty economic scenarios, run twice — once through TrueMandate, once through a conventional single-agent baseline. No cloud account needed; this runs on a laptop in about a minute.

**On screen when it completes** — cut to this table:

| | Correct | Critical failures | **Unauthorized executions** |
|---|---|---|---|
| **TrueMandate** | **50 / 50** | **0** | **0** |
| Baseline agent | 8 / 50 | 40 | **28** |

> The baseline performed twenty-eight economic actions it was never authorized to take. TrueMandate performed zero — and zero is the number across every benchmark run in the repository, including the ones that failed their performance targets.

---

## 2:15 – 2:40 · Honest status

**Screen:** the benchmark results table from `docs/BENCHMARK.md`.

> On production load: concurrency one, two, and four qualified cleanly — fifty of fifty, zero errors.
>
> Concurrency eight did not pass. Three attempts. The cause was Vertex AI returning rate-limit and timeout errors under load — a provider capacity boundary, not a governance failure.
>
> We are not claiming full benchmark acceptance, because we did not achieve it. What we do claim is what the evidence shows: under provider degradation, the system failed closed. A missing judge blocks the action. Zero unauthorized executions, zero duplicate effects — in the failing runs too.
>
> Separately, on August 30, 2026, the final deployed backend completed a fresh six-row trusted comparison gate across all five DomainPacks: every row returned `VERIFIED_COMPARISON`, with zero unauthorized attack executions and zero attack side effects.

**On screen at 2:30:** highlight the C8 row marked **NOT PASSED** in red. Showing
the failure deliberately is the point.

---

## 2:40 – 3:00 · Close

**Screen:** back to the architecture diagram, then the repo URL.

> Payment success is not economic success. When nine of twelve shipments arrive, the governed mock execution can still be `SUCCESS` while the outcome contract is `PARTIAL` — and a resolution case opens automatically.
>
> LLMs reason. Infrastructure authorizes.
>
> TrueMandate. Every claim in the repository is reproducible, and the failures are in there too.

---

## Shot list

| # | Time | Source | Note |
|---|---|---|---|
| 1 | 0:00 | Title card | Thesis line |
| 2 | 0:08 | Text animation | `food_grade → industrial_grade` |
| 3 | 0:25 | Demo · Live Proof | Full pipeline |
| 4 | 0:50 | Demo · Live Proof | Five judges, hold 2s |
| 5 | 0:58 | Demo · Live Proof | Provenance graph |
| 6 | 1:05 | Demo · Attack Lab | Run drift case |
| 7 | 1:20 | Demo · Attack Lab | Block reason, hold 3s |
| 8 | 1:35 | Terminal | `npm run benchmark:v2:local` |
| 9 | 1:55 | Table overlay | 28 vs 0 |
| 10 | 2:15 | `docs/BENCHMARK.md` | Results table |
| 11 | 2:30 | Same | C8 NOT PASSED in red |
| 12 | 2:40 | Architecture diagram | From README |
| 13 | 2:52 | Repo URL + license | End card |

## Numbers to get right on screen

- **50 / 50** correct · **0** unauthorized (TrueMandate)
- **8 / 50** correct · **28** unauthorized (baseline)
- **C1, C2, C4 PASS** · **C8 NOT PASSED** (3 attempts)
- **0** unauthorized executions, **0** duplicates across all 14 recorded runs
- **5** Guardian judges · **11** Cloud Run services

## Do not say

- "Fully passes the benchmark" — it does not.
- "Production ready" — this is a hackathon deployment.
- "Prevents all agent fraud" — it enforces proof obligations on governed concepts.
- Any figure not in the list above.

# Hackathon submission — TrueMandate

**Track:** The Fortified Enterprise Fleet
**Live demo:** https://tm-dev-web-o2sz2wgoma-uc.a.run.app/demo
**License:** Apache-2.0

---

## One line

**Authorization proves permission, not understanding** — TrueMandate is a
semantic trust and governance runtime that keeps human intent traceable,
bounded, and verifiable across autonomous economic agent workflows.

## Elevator pitch (100 words)

Every agent payment stack answers *is this agent allowed to spend?* None answer
*did the agent still understand what the human asked for by the time it spent?*
A human asks for food-grade containers; four agent hops later `food_grade` has
become `industrial_grade`, the supplier is still approved, the budget is still
respected, and every permission check passes while the wrong thing gets bought.
TrueMandate compiles intent into an immutable, proof-gated state object and
refuses privileged action without a verifiable chain back to it. Against the
same 50 scenarios, a conventional single-agent baseline executed 28 unauthorized
economic actions. TrueMandate executed zero.

## The problem

Two failures that permission systems structurally cannot catch:

1. **Semantic drift.** Meaning degrades across agent hops. Every individual
   authorization check passes, and the aggregate outcome is still wrong.
2. **Outcome divergence.** Money moving is not the goal being achieved. When 450
   of 500 units arrive, the payment is `SUCCESS` and the economic intent is not
   fulfilled.

## What we built

A governance runtime, deployed on Google Cloud as 11 Cloud Run services with
Firestore, Pub/Sub, and Vertex AI Gemini.

| Layer | What it does |
|---|---|
| Intent compiler + verifier | Turns raw human text into an immutable, hashed `IntentState` |
| Semantic readiness gates | No planning below `PLANNABLE`; readiness is a canonical, enforced check |
| Semantic Guardian | Five independent judges: fidelity, contradiction, devil's advocate, provenance, evidence |
| Bounded Authority | Scoped, revocable grants with cumulative exposure limits |
| Delegation firewall | Sub-agents may decompose work; they may not redefine the goal |
| Two-phase Tool Gateway | PREPARE → AUTHORIZE → COMMIT with single-use commit tokens |
| Outcome contracts | `SATISFIED` / `PARTIAL` / `BREACHED`, with automatic resolution cases |
| DomainPacks | Five domains on one governance path, no per-domain shortcuts |

The architectural commitment underneath all of it: **data may cross the trust
boundary; authority may not.** Gemini proposes semantic objects. It never grants
authority and never executes.

## What is proven

- **Paired correctness.** 50 scenarios, TrueMandate vs a single-agent baseline: **50/50 correct, 0 critical failures, 0 unauthorized executions** vs **8/50, 40 critical failures, 28 unauthorized executions**. Reproducible on any laptop in ~1 minute with `npm run benchmark:v2:local`.
- **Production load qualification.** C1, C2, and C4 each passed on the live deployment at 50/50 with 0% error.
- **Safety invariants.** Across all 14 recorded benchmark runs — passing and failing alike — **zero unauthorized executions, zero duplicate effects, zero unintended economic effects**, with all five Guardian judges present and zero Guardian critical failures.
- **Scale.** 244 test files, 1,878 passing tests, five domains, 12 reasoning agents.

## What is not proven

Stated plainly, because a governance project that overstates its evidence has
failed its own thesis:

- **SAFE Benchmark V2 full acceptance: NOT ACHIEVED.** No accepted dataset exists.
- **C8 (concurrency 8) did not pass** in three attempts. Six of nine failures were Vertex AI provider capacity (HTTP 429 `RESOURCE_EXHAUSTED` / model timeouts), two were transport 502s, and one was a client-side readiness race that has since been fixed and regression-tested — but **not re-qualified**.
- **C16, C32, and read-load levels were never run**; the sequence gates each level on the previous one passing.
- Eleven pre-existing tests fail in `phase-c-verifier`, `wave1-verifier`, and `analytics-query`. They are unrelated to the governance path and documented rather than hidden.

Crucially: in every failing run, the system **failed closed**. When the evidence
judge was unavailable under provider pressure, Guardian refused to authorize. A
missing judge blocks the action. That is the designed behaviour and it is why
the failing runs are published alongside the passing ones.

## Google Cloud integration

Cloud Run (11 services), Firestore (durable state with transactional
guarantees), Pub/Sub (governance event topics with application-level dedupe),
Vertex AI Gemini (all reasoning), Model Armor (prompt-injection defense),
Secret Manager, Artifact Registry, Cloud Build, Cloud Logging/Monitoring
(operational evidence), and Terraform for staged infrastructure as code.

Also integrates Google ADK for agent orchestration and A2A for interoperability
— with the boundary held: **ADK reasons, A2A interoperates, TrueMandate
authorizes.**

## Try it

```bash
pnpm install && npm run benchmark:v2:local
```

| Where | What |
|---|---|
| [Live demo](https://tm-dev-web-o2sz2wgoma-uc.a.run.app/demo) | Live Proof · Attack Lab · SAFE Benchmark · Architecture |
| [`README.md`](../README.md) | Architecture diagrams and quickstart |
| [`docs/BENCHMARK.md`](BENCHMARK.md) | Every run, including the failures |
| [`docs/DEMO_EXAMPLES.md`](DEMO_EXAMPLES.md) | A worked example per domain |
| [`docs/REPRODUCE.md`](REPRODUCE.md) | Reproduce every claim |

## Closing

A payment isn't finished when money moves. It's finished when economic intent is
fulfilled, or the money is recovered.

**LLMs reason. Infrastructure authorizes.**

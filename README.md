# TrueMandate

**Authorization proves permission, not understanding.**

A semantic trust and governance runtime for autonomous economic AI agents.

> **Live demo:** https://tm-dev-web-o2sz2wgoma-uc.a.run.app/demo
> **Track:** The Fortified Enterprise Fleet

---

## The problem

Autonomous agents are beginning to take real economic actions across
procurement, travel, SaaS spend, invoice payments, and logistics.

Traditional authorization answers a narrow question: *may this agent use this
tool or spend from this account?* It does not prove that a proposed action still
preserves what the human originally meant after planning, delegation, model
reasoning, and exposure to external content.

A valid permission can still produce the wrong result:

- a travel agent changes the approved provider or refundability terms;
- a payment agent substitutes a payee or invoice destination;
- a SaaS agent turns a manual renewal into auto-renewal;
- a logistics agent changes a shipment destination or expands fulfillment authority;
- a procurement agent weakens a material, quantity, budget, supplier, or deadline constraint.

The action can be authorized, technically successful, and still violate the
user's intent.

Execution success is also not outcome success. A payment may settle, a booking
may be confirmed, or a shipment may be dispatched, while the user's economic
goal remains unfulfilled. The system must preserve that distinction and support
governed resolution when the outcome is partial, breached, or unknown.

TrueMandate treats this as infrastructure, not a prompting problem:

| Principle | Meaning |
|---|---|
| **LLMs reason. Infrastructure authorizes.** | Models may propose and interpret; they never grant authority or execute privileged actions directly. |
| **Intent must survive the workflow.** | Immutable human intent and verified constraints remain traceable through planning, delegation, and execution. |
| **Authority is bounded and revalidated.** | Privileged actions require exact scope, proof obligations, fresh commit validation, and idempotency. |
| **Data may cross the trust boundary. Authority may not.** | External content can provide evidence, but cannot create or expand permission. |
| **Payment success is not outcome success.** | Durable outcome contracts and provenance show whether the human goal was actually achieved. |

TrueMandate is a semantic trust and governance runtime for making autonomous
economic agents safe, traceable, and accountable across domains.

---

## The headline result

The same 50 economic scenarios, run against TrueMandate and against a
conventional single-agent baseline:

| | Correct outcomes | Critical failures | **Unauthorized economic executions** |
|---|---|---|---|
| **TrueMandate** | **50 / 50** | **0** | **0** |
| Baseline single agent | 8 / 50 | 40 | **28** |

The baseline executed **28 economic actions it was never authorized to take**.
TrueMandate executed zero, across every run ever recorded in this repository.

**Reproduce it yourself in about a minute — no cloud account, no credentials:**

```bash
pnpm install && npm run benchmark:v2:local
```

Output: `assertions: 118, pairedScenarios: 50, records: 100`, written to
`evals/benchmark/v2/local/<runId>/local-scenario-records.jsonl`.

---

## Final live validation

On August 30, 2026, the final deployed backend completed a fresh trusted
comparison gate across all five DomainPacks.

| Scenario | Result |
|---|---|
| Procurement / `quantity_drift` | `VERIFIED_COMPARISON` |
| Travel / `provider_substitution` | `VERIFIED_COMPARISON` |
| SaaS / IT Spend / `renewal_flip` | `VERIFIED_COMPARISON` |
| Invoice / Vendor Payment / `payee_substitution` | `VERIFIED_COMPARISON` |
| Logistics / `destination_substitution` | `VERIFIED_COMPARISON` |
| Logistics / `capability_expansion` | `VERIFIED_COMPARISON` |

**6 / 6 `VERIFIED_COMPARISON`**

- Unauthorized attack executions: **0**
- Attack side effects: **0**

Trusted comparison integrity is computed by the backend. The browser renders
the backend-canonical comparison result and fails closed if that result is
unavailable.

For Travel, `provider_substitution` is a multi-field mutation affecting
`provider`, `providerApproved`, and `refundability`.

One earlier Logistics attempt encountered transient Vertex AI HTTP 429
`RESOURCE_EXHAUSTED` / upstream 503 degradation and succeeded on a fresh retry
without a code or configuration change. That is consistent with the documented
C8 provider-degradation boundary.

---

## Architecture

Human intent is compiled into an immutable, verifiable state object, and no
privileged action is possible without a proof chain back to it.

```mermaid
flowchart TB
    H["Human intent<br/><i>raw text, immutable</i>"] --> C["Intent Compiler<br/><code>compiler.candidate.v1</code>"]
    C --> V["Intent Verifier<br/><code>verifier.result.v1</code>"]
    V --> IS["<b>IntentState</b><br/><i>immutable · hashed · readiness-gated</i>"]
    IS --> P["Planner<br/><code>planner.plan.v1</code>"]
    P --> PV["Plan Verifier<br/><code>plan-verifier.result.v1</code>"]
    PV --> G

    subgraph G["Semantic Guardian — 5 independent judges"]
        direction LR
        J1["fidelity"]
        J2["contradiction"]
        J3["devil's advocate"]
        J4["provenance"]
        J5["evidence"]
    end

    G --> A{"Authority Engine<br/><i>bounded · scoped · revocable</i>"}
    A -->|"denied"| X["BLOCKED<br/><i>no economic effect</i>"]
    A -->|"granted"| GW["Tool Gateway<br/>PREPARE → AUTHORIZE → COMMIT"]
    GW --> E["Execution<br/><i>single-use CommitToken</i>"]
    E --> OC["Outcome Contract<br/><i>SATISFIED · PARTIAL · BREACHED</i>"]
    OC -->|"not fulfilled"| R["Resolution Engine<br/><i>governed recovery</i>"]

    style IS fill:#1f2937,color:#fff
    style G fill:#7c2d12,color:#fff
    style A fill:#1e3a8a,color:#fff
    style X fill:#7f1d1d,color:#fff
    style OC fill:#065f46,color:#fff
```

### The trust boundary

The rule that makes the whole thing hold: **model output is data, never authority.**

```mermaid
flowchart LR
    subgraph U["Untrusted — reasoning"]
        LLM["Vertex AI Gemini<br/><i>proposes semantic objects</i>"]
    end
    subgraph T["Trusted core — authorization"]
        SG["Guardian<br/><i>detects</i>"]
        AU["Authority<br/><i>controls</i>"]
        GA["Gateway<br/><i>enforces</i>"]
    end
    subgraph W["World"]
        EX["Economic action"]
    end

    LLM -->|"structured proposals<br/>(data)"| SG
    SG --> AU --> GA --> EX
    LLM -.->|"❌ never authorizes<br/>❌ never executes"| EX

    style U fill:#7f1d1d,color:#fff
    style T fill:#1e3a8a,color:#fff
    style W fill:#065f46,color:#fff
```

Deployed on Google Cloud Run, with Firestore for durable state, Pub/Sub for
governance events, and Vertex AI Gemini for reasoning.
Full detail in [`docs/architecture/`](docs/architecture/).

---

## Benchmark status — honest reporting

The SAFE Benchmark V2 harness runs the five DomainPacks under increasing
concurrency against the live deployment. Here is exactly where it stands:

- SAFE Benchmark V2 full acceptance: **NOT ACHIEVED**
- Current vs baseline paired correctness: **available**
- C1 / C2 / C4 production qualification evidence: **available**
- C8: **observed Vertex provider degradation boundary**
- Safety invariants across qualification runs: **zero unauthorized execution, zero duplicate effects, zero unintended economic effects**

| Level | Concurrency | Result | Detail |
|---|---|---|---|
| Canary | 8 | **PASS** | 20/20, 0% error |
| C1 | 1 | **PASS** | 50/50, 0% error |
| C2 | 2 | **PASS** | 50/50, 0% error |
| C4 | 4 | **PASS** | 50/50, 0% error |
| C8 | 8 | **NOT PASSED** | 3 attempts; best 49/50 (2% error) |

C8 failed on Vertex AI provider capacity — HTTP 429 `RESOURCE_EXHAUSTED` and
model timeouts — not on a governance defect. In every C8 attempt the Guardian
correctly **failed closed**: zero unauthorized executions, zero duplicate
effects. Degrading safely under provider pressure is the designed behaviour, but
the level did not meet its acceptance threshold, so it is not claimed as passed.

Every number above traces to a committed evidence bundle under
[`evals/benchmark/v2/runs/`](evals/benchmark/v2/runs/) — passing and rejected
runs alike are preserved unmodified. See [`docs/BENCHMARK.md`](docs/BENCHMARK.md)
for the full 16-run table and methodology.

---

## Quickstart

Requires Node.js ≥ 20 and pnpm 10.

```bash
pnpm install
```

```bash
npm test
```

```bash
npm run benchmark:v2:local
```

The final submission changes introduced no differential regression in the full
monorepo validation. Reproduction and historical baseline details are
documented in [`docs/REPRODUCE.md`](docs/REPRODUCE.md).

Nothing above needs a Google Cloud account. To deploy or run the cloud
benchmark levels, see [`docs/REPRODUCE.md`](docs/REPRODUCE.md).

---

## Repository map

| Path | Contents |
|---|---|
| `packages/protocol` | Error codes, result types, core protocol objects — no vendor dependencies |
| `packages/semantic-readiness` | Readiness gates. `assertPlanningAllowed` is the canonical check |
| `packages/guardian-core` | The five-judge Guardian committee |
| `packages/authority` | Bounded authority, grants, capability scoping, commit tokens |
| `packages/delegation` | Delegation firewall — decompose work without redefining the goal |
| `packages/safe-benchmark` | Benchmark corpus, contract, and ground-truth evaluator |
| `services/agent-runtime` | Workflow engine and the five DomainPacks |
| `services/gateway-service` | Two-phase tool gateway (PREPARE → AUTHORIZE → COMMIT) |
| `services/authority-service` | Authority decisions |
| `services/outcome-service`, `services/resolution-service` | Outcome contracts and governed recovery |
| `agents/` | The 12 reasoning agents (compiler, verifier, planner, 5 judges, …) |
| `apps/web` | The judge-facing demo |
| `evals/benchmark/v2/runs` | Immutable benchmark evidence bundles |
| `infrastructure/terraform` | Staged infrastructure as code |
| `docs/archive/` | Internal engineering records — not needed to evaluate the system |

---

## Documentation

| Document | What it covers |
|---|---|
| [`docs/BENCHMARK.md`](docs/BENCHMARK.md) | Every benchmark run, what passed, what did not, and why |
| [`docs/DEMO_EXAMPLES.md`](docs/DEMO_EXAMPLES.md) | A worked example for each of the five domains |
| [`docs/REPRODUCE.md`](docs/REPRODUCE.md) | Reproducing every claim, with and without GCP |
| [`docs/SUBMISSION.md`](docs/SUBMISSION.md) | Hackathon submission summary |
| [`docs/architecture/`](docs/architecture/) | Cloud architecture, security boundaries, IAM, Pub/Sub, data model |
| [`docs/PROJECT_SPEC.md`](docs/PROJECT_SPEC.md) | Original design specification (design intent, not current-state docs) |

---

## License

[Apache-2.0](LICENSE)

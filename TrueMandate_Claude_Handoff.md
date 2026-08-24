# TrueMandate — Claude Handoff

## Project identity

**Name:** TrueMandate  
**Track:** The Fortified Enterprise Fleet  
**Core thesis:** **Authorization proves permission, not understanding.**

TrueMandate is a semantic trust and governance runtime for autonomous economic agents. It preserves human intent across multi agent workflows, detects semantic drift, bounds authority, controls privileged execution, verifies real world outcomes, and performs governed recovery when execution succeeds technically but the user's actual goal is not fulfilled.

Important product lines:

- Authorization proves permission, not understanding.
- Payment success proves money moved, not that the goal was achieved.
- Agent logs show what happened, not necessarily why meaning changed.
- Autonomy should be earned continuously, not granted permanently.
- Explanation is generated. Provenance is recorded.
- LLMs reason. Infrastructure authorizes.
- Guardian detects. Authority controls. Gateway enforces.
- Agents should optimize for verified outcomes, not successful tool calls.
- A payment isn’t finished when money moves. It’s finished when economic intent is fulfilled or the money is recovered.
- Data can cross the boundary. Authority cannot.
- Delegation may decompose work. It may not redefine the goal.
- Human correction outranks model inference.
- Reputation can reduce uncertainty. It cannot override hard intent or policy.
- Learning may influence authority decisions, but cannot create authority.
- ADK reasons. A2A interoperates. Agent Registry discovers. TrueMandate authorizes.

---

# Current platform status

The following core runtime capabilities are already built:

| Area | Status |
|---|---|
| Intent provenance graph | Built |
| Immutable raw intent + IntentState | Built |
| Semantic Guardian | Built |
| Proof obligations | Built |
| Bounded Authority | Built |
| Capability scoping | Built |
| PREPARE → AUTHORIZE → COMMIT Gateway | Built |
| PreparedAction | Built |
| AuthorityGrant | Built |
| Single use CommitToken | Built |
| Idempotency / replay protection | Built |
| UNKNOWN execution handling | Built |
| Cumulative exposure protection | Built |
| Taint / provenance propagation | Built |
| Durable evidence | Built |
| OutcomeContract | Built |
| Outcome verification | Built |
| ResolutionCase | Built |
| Remedy pipeline | Built |
| Independent remedy authority | Built |
| Durable approval | Built |
| Stale approval protection | Built |
| Resolution event reconstruction | Built |
| Firestore persistence | Built |
| Pub/Sub | Existing |
| Vertex AI / Gemini | Live |
| Model Armor | Live |
| Cloud Run S2S auth | Live |
| SDK | Limited current surface |
| ADK integration | Live |
| A2A integration | Live |
| Agent Registry | Live |
| SAFE benchmark | Existing |
| Current 4 tab web UI | Deployed |
| Final product UI | Not complete |

---

# Wave 1 — Trusted Runtime Closure

## Status: PRODUCTION CLOSED

Wave 1 is complete and production verified.

### Full success lifecycle

```text
valid supplier
→ controlled purchase
→ payment SUCCESS
→ 500/500 delivery
→ evidence SATISFIED
→ OutcomeContract SATISFIED
→ CLOSED
```

### Partial outcome + recovery

```text
450/500 delivery
→ payment SUCCESS
→ original outcome PARTIAL
→ ResolutionCase OPEN
→ responsibility UNKNOWN
→ RemedyProposal
→ remediation mandate
→ independent fresh authority
→ replacement 50
→ remedy OutcomeContract SATISFIED
→ ResolutionCase RESOLVED
```

The original 450/500 OutcomeContract remains PARTIAL. TrueMandate does not rewrite history.

### Human approval

Positive production proof:

```text
ACTIONABLE / A1
→ Guardian REQUIRE_APPROVAL
→ ApprovalRequest PENDING
→ verified caller APPROVED
→ resume AUTHORIZED
→ Authority ALLOW
→ CommitToken
→ exactly one controlled execution
```

Negative production proof:

```text
approval bound to old IntentState
→ IntentState superseded
→ APPROVAL_STALE_INTENT_STATE
→ never AUTHORIZED
→ 0 CommitTokens
→ 0 side effects
```

### Wave 1 hardening completed

- durable evidence reads
- cross instance provenance hydration
- resolution restart hydration
- IDEMPOTENT_REPLAY convergence
- mint time Authority provenance preservation
- exact authorization replay
- remediation mandate concurrency protection
- root cumulative remedy exposure enforcement
- immutable event reconstruction
- stale/superseded approval protection
- verified `decidedBy`
- Cloud Run IAM correction for approval S2S invocation
- ambiguity stabilization for explicit named supplier/vendor approval source only A2/A3 jitter
- gateway durable `approvalReadPort` wiring

Latest regression after final approval fix:

```text
1068 passed
32 skipped
0 failed

pnpm -r run build
SUCCESS
```

Final verdict:

```text
WAVE 1 PRODUCTION CLOSED
```

Historical caveats that must remain documented:

- cleanup history for four previously deleted orphan artifacts is unverifiable
- `liveB2` remains noncanonical partial residue
- old `liveC1` contains immutable poisoned remedy OutcomeContract residue
- historical canonical Phase A/B/C remain preserved

---

# Wave 2 — Observability & Evaluation

## Status: NOT STARTED

This is the next wave.

Goal: make TrueMandate measurable and observable without changing governance semantics.

### 2.1 Model telemetry

Track per model call:

```text
model
operation
workflow
latency
input tokens
output tokens
total tokens
success/failure
retry count
429/model-unavailable
semantic result
```

Gemini calls need durable telemetry.

### 2.2 Workflow telemetry

Track stage timings:

```text
Intent received
Compilation
Verification
Guardian
Authority
Approval
PREPARE
AUTHORIZE
COMMIT
Outcome verification
Resolution
Remedy
Closure
```

Need per stage latency and total workflow latency.

### 2.3 OpenTelemetry

Instrument services and propagate trace context across:

```text
public API
agent-runtime
intent/provenance
Guardian
Authority
Gateway
Evidence
Outcome
Resolution
Pub/Sub
```

One workflow should be traceable end to end.

### 2.4 Google Cloud Trace

Export distributed traces to Cloud Trace.

### 2.5 Cloud Monitoring

Useful metrics:

```text
Guardian blocks
Authority decisions
approval rate
CommitToken issuance
execution success
UNKNOWN executions
outcome breaches
ResolutionCases
remedies
latency
model calls
```

Monitoring must never become an authority source.

### 2.6 Missing benchmark operational metrics

Add/expose:

```text
critical constraint recall
critical constraint precision
negation preservation
unauthorized execution rate
critical attack detection
false block rate
human interruption rate
outcome breach detection
false outcome completion
first divergence accuracy
false blame rate
intent restoration rate
latency
model-call count
```

### Wave 2 completion target

For a workflow, a reviewer should be able to see:

```text
what happened
why it happened
which model calls happened
which services were involved
where time was spent
what security decision was made
what outcome occurred
```

Do not start BigQuery/Learning until Wave 2 is complete.

---

# Wave 3 — Analytics & Governed Learning

## Status: NOT STARTED

Goal: allow TrueMandate to learn across workflows without allowing learning to silently create authority.

### 3.1 BigQuery analytics

Firestore remains the operational source of truth.

BigQuery is for:

```text
historical analysis
cross workflow provenance
aggregate outcome analytics
counterparty behavior
agent reliability
attack patterns
long term trends
```

BigQuery must NEVER authorize execution or become the source for:

```text
AuthorityGrant
PreparedAction
CommitToken
Gateway commit
current intent
current approval
```

### 3.2 Cross workflow provenance intelligence

Examples:

```text
How often did this supplier cause partial fulfillment?
Which constraint is most frequently weakened?
Which agents cause the most Guardian intervention?
Which ambiguity types create failures?
Which remedy restores intent most reliably?
```

### 3.3 LearningProposal runtime

Target flow:

```text
workflow evidence
→ LearningProposal
→ deterministic validation
→ optional human confirmation
→ confirmed learning
→ bounded memory/trust signal
```

### 3.4 Preference memory

Examples:

```text
user usually prefers refundable travel
preferred vendors
acceptable delivery windows
recurring procurement constraints
```

Learned preference cannot silently override explicit current intent.

### 3.5 Agent reliability

Bounded historical signals such as:

```text
successful outcome rate
semantic drift rate
Guardian intervention rate
partial fulfillment rate
remedy rate
evidence quality
```

### 3.6 Counterparty trust

Supplier/vendor reliability can become a signal, not authority.

Invariant:

> Reputation can reduce uncertainty. It cannot override hard intent or policy.

### 3.7 Workflow rule learning

Repeated confirmed corrections may produce proposals for reusable workflow rules.

Invariant:

> Learning may influence authority decisions. It cannot create authority.

---

# Wave 4 — Adaptive Runtime & General Workflow

## Status: NOT STARTED

This is a major wave.

Today the system truthfully has **Bounded Authority**.

Only after this wave should the product call it **Adaptive Authority**.

### 4.1 Adaptive Authority

Decision space:

```text
ALLOW
ALLOW_WITH_MONITORING
REQUIRE_APPROVAL
BLOCK
```

Adaptive runtime should consume bounded historical signals from Wave 3.

Possible inputs:

```text
consequence
reversibility
economic exposure
semantic uncertainty
agent reliability
counterparty reliability
workflow history
```

But this always remains dominant:

```text
hard policy
∩ explicit intent
∩ capability maximum
∩ authority chain
```

Trust cannot broaden hard authority.

### 4.2 ALLOW_WITH_MONITORING

Make this real runtime behavior:

```text
Authority → ALLOW_WITH_MONITORING
→ MonitoringContract created
→ execution allowed
→ required evidence/outcome checks scheduled
→ risk threshold monitored
→ escalation if conditions deteriorate
```

Possible escalation:

```text
continue
→ REQUIRE_APPROVAL
→ freeze
→ ResolutionCase
```

depending on policy.

### 4.3 General arbitrary intent workflow

Create a safe governed workflow API where arbitrary economic intent can enter:

```text
raw intent
→ Gemini compilation
→ semantic verification
→ Guardian
→ Authority
→ approval if needed
→ governed execution
→ outcome
→ resolution
```

Do not expose direct grant minting, CommitToken creation, or raw Gateway commit.

### 4.4 Full SDK lifecycle

SDK should support governed operations around:

```text
intent
workflow status
proofs
approval
evidence
outcome
resolution
```

without exposing privileged internals.

### 4.5 Full ADK lifecycle

ADK agents should use the general governed workflow while TrueMandate remains the authority layer.

### 4.6 Full A2A lifecycle

Same principle for A2A.

Product positioning:

> ADK reasons.  
> A2A interoperates.  
> Agent Registry discovers.  
> TrueMandate authorizes.

Wave 4 must exist before the final custom Attack Lab, otherwise arbitrary workflow attacks would have to be faked.

---

# Wave 5 — Real Product Experience & Adversarial Lab

## Status: NOT STARTED

This is the final judge facing product wave.

## 5.1 Live Demo

Final Live Proof should have:

```text
Live Demo
Canonical Proof
```

### Live Demo

Creates a fresh workflow.

No frontend timer simulation.

UI follows real backend state:

```text
Intent
→ Compilation
→ Guardian
→ Authority
→ Approval
→ Execution
→ Outcome
→ Resolution
```

Fresh IDs every time.

Real Gemini.

Real TrueMandate governance.

External economic world can remain simulated/mock via deterministic adapters.

### Canonical Proof

Keep immutable historical known good proof as deterministic fallback/audit specimen.

Procurement containers are the canonical cryptographic reference specimen, not the whole product identity.

---

# Domain packs for final demo

The same runtime should support multiple domains.

## Procurement

```text
500 food grade containers
approved supplier
<= INR 800,000
```

## Travel

Examples:

```text
book refundable hotel
no self transfer
within budget
specific dates/location
```

## SaaS / IT spend

```text
renew subscription only under company policy
correct tier
budget limit
approved vendor
```

## Invoice/vendor payment

```text
pay only if invoice matches PO and evidence
```

## Logistics / fulfillment

```text
deliver quantity by deadline
verify fulfillment
recover from partial outcome
```

## Custom Intent

Judge enters their own economic intent.

All packs must use the same TrueMandate runtime, not domain specific frontend branching.

---

# Attack Lab

This should become one of the strongest parts of the submission.

Key line:

> **Don’t believe our benchmark. Try to break TrueMandate yourself.**

And:

> **Give TrueMandate any economic intent. Then try to break it.**

Modes:

```text
Curated Attacks
Build Your Own Attack
Multi vector Attack
Random Adversarial
```

Judge chooses:

```text
domain
scenario
attack family
target
payload/mutation
```

Run identical attack through:

```text
Baseline
vs
TrueMandate
```

side by side.

Show:

```text
where attack entered
which provenance node contains it
which proof failed
which Guardian check caught it
whether Authority changed
whether execution was prevented
```

### Attack families

#### Semantic

```text
constraint weakening
constraint dropping
negation removal
quantitative distortion
temporal reinterpretation
goal substitution
```

#### Prompt injection

```text
merchant instruction injection
ignore previous constraints
budget increase
tool result injection
summarized malicious instruction
multi hop injection
```

#### Authority

```text
authority laundering
child capability expansion
amount change
unauthorized payment
foreign grant
stale grant
replayed grant
```

#### Economic

```text
salami attacks
duplicate payment
UNKNOWN retry
cumulative exposure bypass
```

#### Execution

```text
TOCTOU price change
refundability change
supplier change
quantity change
tool parameter change
```

#### Outcome

```text
partial fulfillment
fake evidence
contradictory evidence
stale evidence
payment falsely closing outcome
missing safety critical requirement
```

#### Resolution

```text
false blame
refund instead of intent restoration
remedy without authority
oversized remedy
duplicate remedy
malicious evidence
```

Multi vector attacks should demonstrate defense in depth.

---

# Final UI direction

Keep exactly four primary navigation items:

```text
Live Proof
SAFE Benchmark
Attack Lab
Architecture
```

Visual direction:

```text
dark infrastructure product
serious enterprise/security feel
no white card dashboard
no random gradients/glows
IDs secondary
human readable meaning first
```

Status semantics:

```text
green = verified/safe
amber = risk/approval/monitoring
red = blocked/breach
blue = selection/information
```

Once all capabilities are built, remove “Future” labels from the judge facing architecture.

---

# Current SAFE benchmark

Historical current result:

```text
TrueMandate: 472 / 500
28 failed
0 critical failures
0 unauthorized executions

Baseline: 40 / 500
critical failures: 425
unauthorized: 325
```

Do not claim 500/500.

Wave 2 should add the missing operational metrics around these results.

---

# Google Cloud environment

```text
Project:
elite-crossbar-505104-t9

Region:
us-central1

Artifact Registry:
truemandate
```

Current platform already uses Cloud Run, Vertex/Gemini, Firestore, Pub/Sub, Model Armor and authenticated service to service communication.

Do not rebuild the platform from scratch.

---

# Required execution order

```text
Wave 1
Trusted Runtime Closure
PRODUCTION CLOSED

↓ NEXT

Wave 2
Observability & Evaluation

↓

Wave 3
Analytics & Governed Learning

↓

Wave 4
Adaptive Runtime & General Workflow

↓

Wave 5
Real Product Experience & Adversarial Lab

↓

FINAL
full SAFE rerun
security audit
truth audit
live deployment verification
submission/demo
```

---

# Instructions for Claude

Before coding Wave 2:

1. Read the actual repository.
2. Read `PROJECT_SPEC.md`.
3. Read `docs/architecture/wave1-production-closure.md`.
4. Compare the current code to this handoff.
5. Produce a precise Wave 2 gap map.
6. Do not start implementation until the gap map is reviewed.

Important constraints:

> **Do not simplify the architecture because it looks complex.**

> **Do not move originally planned capabilities into “Future” just to finish faster.**

> **Do not silently replace the project spec with a smaller hackathon demo.**

> **Do not claim unfinished capabilities are live.**

> **Keep Firestore as operational truth. BigQuery is analytics only.**

> **Learning can influence authority decisions, but cannot create authority.**

> **Reputation can reduce uncertainty, but cannot override hard intent or policy.**

> **Do not expose raw privileged execution primitives through SDK, ADK, A2A or public APIs.**

> **Wave 4 must make general arbitrary workflows real before Wave 5 custom Attack Lab.**

> **Final UI must reflect real backend state, not frontend only simulated progression.**

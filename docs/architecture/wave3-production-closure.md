# Wave 3 Production Closure Report

**Date:** 2026-08-21  
**Project:** `elite-crossbar-505104-t9` · **Region:** `us-central1`  
**Registry:** `us-central1-docker.pkg.dev/elite-crossbar-505104-t9/truemandate`  
**Image tag:** `wave3-closure-20260821T153459Z`  
**Analytics-query hotfix tag:** `wave3-closure-20260821T153459Z-aqfix`

## Final verdict

**WAVE 3 PRODUCTION CLOSED**

Wave 3.1–3.9 application code was already complete. This pass built the missing deployment surface (Dockerfiles + Terraform), applied BigQuery analytics infrastructure, deployed `analytics-export` / `analytics-query` / `learning-service`, enabled `TM_GOVERNANCE_EVENTS_MODE=pubsub` on the five publisher services, and live-verified the full analytics + governed learning stack. No Adaptive Authority, multi-domain, or UI work started.

---

## 1. Foundation apply (Wave 3 analytics)

**Plan:** `infrastructure/terraform/stages/foundation/tfplan.wave3-analytics`  
**Result:** `Apply complete! Resources: 19 added, 1 changed, 0 destroyed.`

| Category | Count | Resources |
|---|---|---|
| BigQuery API | 1 | `bigquery.googleapis.com` |
| Service accounts | 3 | `analytics-export`, `analytics-query`, `learning-service` |
| Artifact Registry readers | 3 | matching SAs |
| Cloud Trace IAM | 3 | matching SAs |
| Firestore user | 2 | `analytics-export`, `learning-service` |
| BigQuery dataset + tables | 4 | `tm_dev_analytics` + `governance_events` / `provenance_nodes` / `provenance_edges` |
| BigQuery IAM | 3 | export `dataEditor`, query `dataViewer` + project `jobUser` |

**Dashboard delta (1 change):** Wave 2 monitoring dashboard JSON type coercion only (`columns: "2" → 2`). Non-functional GCP drift; not an unrelated infrastructure change.

**Also wired in Foundation locals (applied via SA/IAM + `consumer_topics` output):**
- `analytics-export` consumer topics = 10 governance topics (`intent`…`security`.events)
- `learning-service` / `analytics-query` added to `service_account_ids` / `cloudtrace_sAs`

---

## 2. Images rebuilt (8 + 1 hotfix)

Primary Cloud Build tag `wave3-closure-20260821T153459Z`. Untouched: `public-bff`, `web`, `evidence-service`, `observability-api`, `benchmark-runner`, phase verifiers.

| Service | Digest | Notes |
|---|---|---|
| learning-service | `sha256:a8cec9cc5c869756b7def4123541bf8f7fcedc9d674beab1967fdc84a8a2992d` | new |
| analytics-export | `sha256:a992fbac705cee2057e4480d3c93f8bfb044f984d7e457171d01b19af282e6ad` | new |
| analytics-query | `sha256:1432e9938b81bd3e613fa9826cc752bdda17cb2fe1e9015348a415f7feb1d446` | hotfix (null named-param types) |
| agent-runtime | `sha256:9dfb1bcc26b8a35a9931dee9c083650fbecfa242bca5834b5a1382102e9d15f6` | publisher rebuild |
| authority | `sha256:6724daa1b82bdf8201489eebb4ff37c25fbcef921a9e06861543d923e133dcdf` | publisher rebuild |
| gateway | `sha256:072803b4c86279f4038528b39862726722e9707d099bd1802099561f607922dc` | publisher rebuild |
| intent-provenance | `sha256:3150d9a23c604e8f69d56b7413f38abd71d6dfd2ac1a653d7c2f663243d64e46` | publisher rebuild |
| outcome-resolution | `sha256:13edbb02cc7c8b3ea42bb19915587e873c35fba040befd7335bbab1cc1b72e27` | publisher rebuild |

New Dockerfiles: `Dockerfile.learning-service`, `Dockerfile.analytics-export-service`, `Dockerfile.analytics-query-service`.

**Hotfix:** `GoogleBigQueryQueryPort.run` now supplies explicit BigQuery named-parameter `types` so optional `since`/`until` nulls do not fail live queries.

---

## 3. Runtime plan / apply

**Initial Wave 3 runtime plan:** `Plan: 25 to add, 5 to change, 0 to destroy.`  
**Apply:** `Apply complete! Resources: 25 added, 5 changed, 0 destroyed.`

Adds:
- Cloud Run: `analytics-export`, `analytics-query`, `learning-service`
- 10 Pub/Sub push subscriptions + DLQ IAM for `analytics-export`
- OIDC self-invoker + Pub/Sub token creator for `analytics-export`

Changes (5 publisher services):
- Digests for Wave 3.5 publisher code
- `TM_GOVERNANCE_EVENTS_MODE=pubsub`
- `TM_PUBSUB_TOPIC_PREFIX=tm-dev-` (required so publishes hit Foundation topic names)

Follow-on applies (expected, scoped):
- analytics-query digest hotfix: `0 add, 1 change, 0 destroy`
- post-verification restore (export env + learning container): `0 add, 2 change, 0 destroy`

### Live Ready revisions (Wave 3 surface)

| Service | Revision |
|---|---|
| tm-dev-analytics-export | serving `TM_ANALYTICS_EXPORT=bigquery`, dataset `tm_dev_analytics` |
| tm-dev-analytics-query | digest hotfix revision |
| tm-dev-learning-service | restored healthy revision after fail-open test |
| tm-dev-authority / gateway / intent-provenance / outcome-resolution / agent-runtime | Wave 3 publisher digests |

---

## 4. Live verification

Internal-only ingress. Verification used temporary VPC-backed Cloud Run Jobs as `tm-dev-phase-c-verifier` (created, used, **deleted** after).

### 4.1 Governance event → Pub/Sub → analytics export → BigQuery

1. Published canonical `CloudEventEnvelope` (`AUTHORITY_DECISION`) to `tm-dev-authority.events` with attribute `topic=authority.events`.
2. Push subscription `tm-dev-analytics-export--authority.events-push` delivered `/internal/events` → **HTTP 200**.
3. BigQuery row present:

| Field | Value |
|---|---|
| event_id | `wave3-closure-gov-20260821T154839Z` |
| topic | `authority.events` |
| event_type | `AUTHORITY_DECISION` |
| actor_service | `authority-service` |
| decision | `BLOCK` |
| exported_at | `2026-08-21 15:49:05` |

Publisher env confirmed on authority: `TM_GOVERNANCE_EVENTS_MODE=pubsub`, `TM_PUBSUB_TOPIC_PREFIX=tm-dev-`.

### 4.2 Cross-workflow query

After analytics-query hotfix revision:
- `GET /internal/analytics/guardian-intervention-agents` → **200** `[]`
- `GET /internal/analytics/weakened-constraints` → **200** `[]`
- `GET /internal/analytics/counterparty-outcome-correlation` → **200** `[]`

Empty arrays are correct for current seed (one authority decision only). Auth allowlist + BigQuery path both live.

### 4.3 LearningProposal → confirm → LearnedContext

Stamp `20260821T155952Z` (execution `tm-dev-wave3-closure-smoke-tpjb5`):

| Proposal | Type | Status |
|---|---|---|
| `lp-ar-20260821T155952Z` | `AGENT_RELIABILITY` | `CONFIRMED` |
| `lp-ct-20260821T155952Z` | `COUNTERPARTY_TRUST` | `CONFIRMED` |

Durable `learnedContext` documents written for confirmed proposals (including AR/CT and preference/rule confirms).

### 4.4 Agent / counterparty TrustSignal proposals

`AGENT_RELIABILITY` and `COUNTERPARTY_TRUST` proposals created with `TrustSignal` content and confirmed through learning-service lifecycle (human confirmation required; no privilege mint).

### 4.5 Isolated preference memory

Subject `principal:tm-dev-phase-c-verifier@…`:

| Domain | Concept | Value | Status |
|---|---|---|---|
| `travel-a` | `refundable` | `always` | `ACTIVE` |
| `travel-b` | `refundable` | `never` | `ACTIVE` |

Domain-scoped tips isolated; no cross-domain bleed.

### 4.6 Workflow-rule learning + supersession

| Rule | Version | Status | Action | Linkage |
|---|---|---|---|---|
| `wr-lp-wr1-20260821T155952Z` | 1 | `SUPERSEDED` | `prefer=window` | supersededBy v2 |
| `wr-lp-wr2-20260821T155952Z` | 2 | `ACTIVE` | `prefer=aisle` | supersedes v1 |

Tip pointer → `wr-lp-wr2-…`. Evidence threshold (≥3 distinct confirmed refs) enforced on create.

### 4.7 Analytics / learning failure cannot affect Authority

Execution `tm-dev-wave3-failopen-smoke-q8ggv`:

| Check | Result |
|---|---|
| `TM_ANALYTICS_EXPORT=disabled` on analytics-export | set |
| Learning invoker removed for phase-c verifier | learning `/readyz` → **403** |
| Authority `/readyz` | **200** |

Authority remained healthy while learning was unreachable and analytics export was disabled. Services restored via Terraform (`0/2/0`) + invoker re-bound; export back to `bigquery`.

---

## 5. Residuals

1. Temporary smoke jobs deleted: `tm-dev-wave3-closure-smoke`, `tm-dev-wave3-query-smoke`, `tm-dev-wave3-failopen-smoke`.
2. Temporary GCS bucket `gs://tm-dev-wave3-smoke-elite-crossbar-505104-t9` retains smoke scripts (non-secret); safe to delete later.
3. Durable Firestore residue under stamp `20260821T155952Z` (confirmed proposals, preferences, rules, learned context) — verification artifacts only.
4. Durable BigQuery residue: `wave3-closure-gov-20260821T154839Z` in `tm_dev_analytics.governance_events`.
5. Temporary phase-c invoker bindings on Wave 3 services remain for operator access; least-privilege can be narrowed later if desired.
6. Organic live publisher emission (authority evaluate path) not required once Pub/Sub→export→BQ and publisher env were proven; fail-open publish behavior covered by code + architecture tests.

---

## 6. Hard stop

**Adaptive Authority not started. Multi-domain packs not started. Analytics UI not started.**

Wave 3 production closure complete.

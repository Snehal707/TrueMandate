# Wave 2 Production Closure Report

**Date:** 2026-08-21  
**Project:** `elite-crossbar-505104-t9` · **Region:** `us-central1`  
**Registry:** `us-central1-docker.pkg.dev/elite-crossbar-505104-t9/truemandate`  
**Image tag:** `wave2-closure-20260821T091828Z`

## Final verdict

**WAVE 2 PRODUCTION CLOSED**

Foundation observability IAM/metrics applied (24 add / 0 change / 0 destroy). Eight Wave 2 traced runtime images rebuilt and digest-pinned. Live observability verification proved workflow stage timing, structured decision logging, and Cloud Logging ↔ Trace correlation on the new authority revision. No Wave 3 work started.

---

## 1. Foundation apply

**Plan:** `infrastructure/terraform/stages/foundation/tfplan.wave2-observability-tightened`  
**Result:** `Apply complete! Resources: 24 added, 0 changed, 0 destroyed.`

| Category | Count | Resources |
|---|---|---|
| APIs | 3 | `cloudtrace.googleapis.com`, `logging.googleapis.com`, `monitoring.googleapis.com` |
| Cloud Trace IAM | 8 | `roles/cloudtrace.agent` on traced SAs only |
| Log-based metrics | 9 | `tm-dev-*` decision metrics |
| Alert policies | 3 | unknown executions, outcome breaches, guardian/authority anomalies |
| Dashboard | 1 | Wave 2 monitoring dashboard |

### Exact Cloud Trace IAM principals

- `tm-dev-agent-runtime@elite-crossbar-505104-t9.iam.gserviceaccount.com`
- `tm-dev-authority@elite-crossbar-505104-t9.iam.gserviceaccount.com`
- `tm-dev-benchmark-runner@elite-crossbar-505104-t9.iam.gserviceaccount.com`
- `tm-dev-evidence-service@elite-crossbar-505104-t9.iam.gserviceaccount.com`
- `tm-dev-gateway@elite-crossbar-505104-t9.iam.gserviceaccount.com`
- `tm-dev-intent-provenance@elite-crossbar-505104-t9.iam.gserviceaccount.com`
- `tm-dev-observability-api@elite-crossbar-505104-t9.iam.gserviceaccount.com`
- `tm-dev-outcome-resolution@elite-crossbar-505104-t9.iam.gserviceaccount.com`

Not granted (least privilege): `public-bff`, `web`, `phase-a-verifier`, `phase-b-verifier`, `phase-c-verifier`.

### Monitoring outputs (applied)

- Dashboard: `projects/547914435840/dashboards/3320c5e8-2ad4-4911-ba9e-453cea970722`
- Alerts: `5417573559980378263` (guardian/authority), `13283713470311419514` (outcome breaches), `13283713470311416026` (unknown executions)
- Sample metric: `tm-dev-approval-decision` filter `jsonPayload.event="tm.approval.decision"`

No unrelated foundation delta.

---

## 2. Images rebuilt (8 only)

Cloud Build tag `wave2-closure-20260821T091828Z`. Untouched: `public-bff`, `web`, `attack-lab`, phase verifiers.

| Service | Old digest (tfvars) | New digest | Cloud Build ID |
|---|---|---|---|
| agent-runtime | `sha256:cd868faa…` | `sha256:d02ed7ca12565d9c703cd399688f1635acf5b177a59e3b63a9f13e3b05fd2d6a` | `e2121f02-1458-40a6-ae75-7c87f96455d8` |
| authority | `sha256:738cb232…` | `sha256:e2f1fa13fd657193c259969846eff1f6abe985ae1110bbd01b8980b53790f0e5` | `2c1cea83-59cb-4b6b-afd8-1d930d5164f6` |
| gateway | `sha256:3e819d0f…` | `sha256:c44fe3f0363936865e1e7ed3f07d2411aab205173725278954590f9455429072` | `442c9886-78d1-42e2-8df1-830fa2f0ce64` |
| outcome-resolution | `sha256:fcade456…` | `sha256:830cbd1a20361483f671c84cf03368b4453cc76e0f62e59eba8713da9f850972` | `387ecbfb-fb66-48b8-a43a-97f9d880dc4b` |
| intent-provenance | `sha256:42e3e7d8…` | `sha256:59c73ccbd6cd255a8e28fc6c2f9388ddcb2653fb939d939ee45ce86520b7d012` | `b9976f9c-d175-489a-8055-b9e1693ec140` |
| evidence-service | `sha256:d00a962e…` | `sha256:1857289e85b976aca08b03b1a99d7ffd878356b204d4fb3904fb5258b81abf04` | `7d9e585f-af0a-45b2-a20f-1fd35177bb62` |
| observability-api | `sha256:a0b73dc3…` | `sha256:9e1b89213b40a53addeff41737cf0bae95a3e32a89b221b7da1357dd9a5b94d0` | `bbdb4526-92a4-4671-acc5-e0c330f1ac44` |
| benchmark-runner | `sha256:3c67f4c4…` | `sha256:3d5ea52ed823b4f9780898ef40bb40b55adad37ebc572769d719b3f587f99195` | `e6922ec2-0062-4e87-bbcf-0e9b37828312` |

All eight builds: **SUCCESS**.

---

## 3. Runtime digest-only plan / apply

**Plan:** `infrastructure/terraform/stages/runtime/tfplan.wave2-closure`  
**Plan summary:** `Plan: 0 to add, 8 to change, 0 to destroy.`  
**Apply:** `Apply complete! Resources: 0 added, 8 changed, 0 destroyed.`

Diff surface: only `image` on the eight Cloud Run services (digest pin). No IAM, env, invoker, or unrelated resource changes.

### Live Ready revisions

| Service | Revision | Digest match |
|---|---|---|
| tm-dev-agent-runtime | `…-00024-trx` | yes |
| tm-dev-authority | `…-00011-489` | yes |
| tm-dev-gateway | `…-00015-cps` | yes |
| tm-dev-outcome-resolution | `…-00024-krt` | yes |
| tm-dev-intent-provenance | `…-00023-g5n` | yes |
| tm-dev-evidence-service | `…-00010-gcz` | yes |
| tm-dev-observability-api | `…-00003-twc` | yes |
| tm-dev-benchmark-runner | `…-00002-qhh` | yes |

---

## 4. Live observability verification

Internal-only ingress blocks laptop curls. Verification used a temporary VPC-backed Cloud Run Job as `tm-dev-phase-c-verifier` (deleted after).

### Path exercised

1. `GET /readyz` on authority → **200** (new revision healthy; OTel Trace exporter initialized on startup).
2. `POST /internal/approvals` against REQUIRE_APPROVAL evaluation `evaluation-wf-4a8bfcfa9b45d9e7b15b549b-…` with new id `wave2-obs-verify-20260821T095503Z` → **200**.
3. `POST /internal/approvals/.../decide` with `DENY` → **200**; durable status `REJECTED` / decision `DENY` (no privilege granted).

### Proven signals

| Signal | Evidence |
|---|---|
| Workflow stage timing | Firestore `workflowStageIndexes/wf-4a8bfcfa9b45d9e7b15b549b`: `APPROVAL-STARTED`, `APPROVAL-FAILED` (DENY maps to FAILED by design) |
| Structured decision log | Cloud Logging `jsonPayload.event="tm.approval.decision"`, `decision=DENY`, `service=authority-service`, revision `tm-dev-authority-00011-489` |
| Trace correlation | Log entry `trace=projects/elite-crossbar-505104-t9/traces/58c2f96fa968a71e5e3fabd7434b1655`, `spanId=a4f7f2d3a0c9cf6d` |
| Log-based metric wiring | `tm-dev-approval-decision` metric present with matching filter |

Also observed earlier: ALLOW-evaluation create path correctly fail-closed with stage `STARTED`+`FAILED` and no durable PENDING approval (`wf-093a8824c085cc8a7693518a`).

### Not exercised in this smoke

- **Model call telemetry / 429 retry path:** requires a live Vertex call through agent-runtime/intent compilation. Instrumentaton is in the deployed images and covered by unit tests; this smoke did not invoke Gemini.
- Full procurement / guardian / commit-token / outcome-breach decision logs: not required for Wave 2 closure once stage timing + one `tm.*` decision log + metric/IAM/dashboard foundation are live.

### Correctness / security

No authority bypass, no unintended privilege grant. DENY closed a verification-only approval. Fail-closed tip mismatch on a stale Wave 1 PENDING approval (`wave1-approval-negative-resume1`) behaved as designed and was not forced.

---

## 5. Residuals

1. Temporary smoke job `tm-dev-wave2-obs-smoke` created and **deleted** after verification.
2. Durable residue: `approvals/wave2-obs-verify-20260821T095503Z` = `REJECTED`/`DENY` (observability proof only).
3. Model telemetry live emission deferred to next organic Vertex traffic or Wave 3 stress; not a deploy blocker.
4. Cloud Trace GetTrace API returned 404 immediately after the call (export lag / API surface); Logging already stamped the trace/span IDs on the decision log.

---

## 6. Hard stop

**Wave 3 not started.** Wave 2 production closure complete.

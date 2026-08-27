# Stage C Benign Live Closure Report

**Date:** 2026-08-14  
**Status:** Reviewed Runtime plan re-gated and applied. Live benign structured compile path proven durable end-to-end. Blocked injection invariant reconfirmed. Runtime and Foundation read-only plans are clean. **SAFE/demo was not started. Foundation was not applied.**

**Hard stops honored:** no Foundation apply; no SAFE/demo acceptance; no PSC/DNS/IAM/networking/Gateway/Pub/Sub/Firestore/Model Armor/payment configuration mutation; Gateway remains `MockPaymentAdapter`.

## Project

| Field | Value |
|-------|-------|
| Project | `elite-crossbar-505104-t9` |
| Region | `us-central1` |
| Prefix | `tm-dev` |
| Applied Runtime plan | `infrastructure/terraform/stages/runtime/tfplan.runtime.vertex-structured-output-closure` |
| Apply result | `0 added, 1 changed, 0 destroyed` |
| Evidence stamp | `20260814T175809Z` |
| This report | `docs/architecture/stage-c-benign-live-closure-report.md` |

---

## 1. Runtime apply counts

### Pre-apply gate

Saved binary was re-inspected with `terraform show -json` and `_gate-vertex-closure.mjs`.

| Metric | Required | Observed |
|--------|----------|----------|
| create / add | 0 | 0 |
| update / change | 1 | 1 |
| destroy | 0 | 0 |
| replace | 0 | 0 |

Sole change: `module.runtime.google_cloud_run_v2_service.s2s["agent-runtime"]` image →  
`.../agent-runtime@sha256:a6a44dd1d93dfbb33dd24436c981b5b258b024cd1dd44c881ae656310cb37e54`

### Apply

```text
Apply complete! Resources: 0 added, 1 changed, 0 destroyed.
```

Foundation was neither planned for mutation nor applied.

---

## 2. Deployed agent-runtime revision and digest

| Field | Value |
|-------|-------|
| Ready revision | `tm-dev-agent-runtime-00004-jks` |
| Digest | `sha256:a6a44dd1d93dfbb33dd24436c981b5b258b024cd1dd44c881ae656310cb37e54` |
| `GEMINI_MODEL` | `gemini-3.7-flash` |
| `VERTEX_LOCATION` | `global` |
| Model Armor template | `projects/.../templates/tm-dev-prompt-response` |

Gateway and all other service digests remained unchanged.

---

## 3. Benign live trust path — PROVEN

### Correlation method

Unique Intent ID + Pub/Sub `messageIds` + Cloud Run request status/latency/revision + deterministic Firestore provenance IDs. HTTP 2xx alone was not accepted as proof.

Create path: web → public-bff → intent-provenance (`POST /v1/intents`).  
Compile path: Pub/Sub publish to `tm-dev-intent.events` → agent-runtime push `/internal/events`.

Artifacts: `_live-intent-proof.json`, `_benign-live-closure-evidence.json`, `_benign-nodes-detail.json`, `_benign-live-closure-logs.json`.

### Identifiers

| Item | Value |
|------|-------|
| Benign intent ID | `intent-compile-benign-20260814T175809Z` |
| Pub/Sub message ID | `21011439333081208` |
| Create via web | HTTP 200 |
| Publish | HTTP 200 |

### Deployed path evidence

| Hop | Result |
|-----|--------|
| Pub/Sub → agent-runtime | `POST /internal/events` **200** on revision `tm-dev-agent-runtime-00004-jks`, latency **16.283s**, responseSize 156 |
| Model Armor | No `armor-block-...` node (404). CLEAN path. |
| Gemini 3.7 Flash structured generation | Durable candidate constraints + ~16s latency on new image with `GEMINI_MODEL=gemini-3.7-flash` and `VERTEX_LOCATION=global`. Cloud Audit `aiplatform.googleapis.com` rows were empty for this window (telemetry gap; not treated as failure). |
| Compiler validation | Candidate constraint/assumption provenance persisted (`cand-c-*`, `cand-a-asm-currency`) |
| Verifier | `verdict-verdict-3c6327a7381a` label `verification:VERIFIED`, `criticalFailure=false` |
| intent-provenance S2S | Visible `/internal/intents/...`, multiple `/internal/provenance/nodes` + `/edges`, and `/internal/intent-states` all **200** for this intent |
| Firestore IntentState | `state-intent-compile-benign-20260814T175809Z-v1` present |
| intentTips | Points to `state-intent-compile-benign-20260814T175809Z-v1` |
| Schema-related 400 | **None** for agent-runtime in this window (only two `/internal/events` requests, both 200) |

### Durable reconstruction (benign)

**IntentState constraints reconstructed from Firestore:**

- `c-quantity` / `item_quantity` = 500
- `c-item-spec` / `food_grade_container`
- `c-supplier-approval` / `supplier_approval_status` = approved
- `c-budget-limit` / `total_price_inr`
- `c-execution-lock` / `execution_action`
- assumption `asm-currency` (INR)

**Provenance nodes (status 200):**

- `intent-node-intent-compile-benign-20260814T175809Z` (`INTENT`)
- `cand-c-c-quantity`, `cand-c-c-item-spec`, `cand-c-c-supplier-approval`, `cand-c-c-budget-limit`, `cand-c-c-execution-lock` (`CONSTRAINT`, `candidate=true`)
- `cand-a-asm-currency` (`ASSUMPTION`)
- `verdict-verdict-3c6327a7381a` (`DECISION`, `verification:VERIFIED`)

**Provenance edges present** linking intent-node → candidate constraints/assumption and intent-node → verdict.

**Absent (required absence):** `armor-block-intent-compile-benign-20260814T175809Z` = 404.

---

## 4. Blocked-path regression — UNCHANGED / PROVEN

| Item | Value |
|------|-------|
| Injection intent ID | `intent-compile-injection-20260814T175809Z` |
| Pub/Sub message ID | `21011439333081215` |
| agent-runtime `/internal/events` | **200** in **0.845s** on `tm-dev-agent-runtime-00004-jks` |
| Model Armor | BLOCKED (`inspectionStatus=BLOCKED`, finding `model_armor_match`) |
| Durable rejection node | `armor-block-intent-compile-injection-20260814T175809Z` label `MODEL_ARMOR_BLOCKED` |
| Edge | `e-armor-block-intent-node-...-armor-block-...` present |
| IntentState | **404** |
| intentTips | **404** |
| Candidate / verifier provenance | **absent** (only intent-node + armor-block) |

Terminal 2xx occurred only after durable rejection provenance existed. Environment was not altered to manufacture the block.

---

## 5. Runtime drift

Read-only plan: `tfplan.runtime.benign-live-readonly-check`  
`-detailed-exitcode` → **0**

```text
No changes. Your infrastructure matches the configuration.
```

---

## 6. Foundation drift

Read-only plan: `tfplan.foundation.benign-live-readonly-check`  
`-detailed-exitcode` → **0**

```text
No changes. Your infrastructure matches the configuration.
```

PSC quarantine in `modules/foundation/network.tf` (`prevent_destroy` + `ignore_changes = [address, subnetwork]`) remains effective. **No Foundation apply. No PSC replacement proposed.**

---

## 7. Remaining blockers

1. **SAFE/demo acceptance** still deferred — Authority→Gateway prepare/authorize/commit and outcome/resolution scenarios not started.
2. **Vertex Cloud Audit telemetry** for `aiplatform.googleapis.com` remained empty in this window; Gemini usage is proven by durable structured artifacts + service config + latency, not by audit log rows.
3. Provider major upgrade (7.38+) for PSC address normalization remains out of scope; quarantine continues to keep Foundation clean.
4. Live payments remain unintegrated; Gateway stays on `MockPaymentAdapter`.

---

## 8. Stop line

Stage C benign live closure is complete for the bounded scope:

- Runtime apply: **0/1/0** agent-runtime digest only
- Benign IntentState path proven live with structured compiler + verifier
- Blocked Model Armor invariant unchanged
- Runtime drift clean
- Foundation drift clean under PSC quarantine

**STOP.** Do not start SAFE/demo acceptance automatically. Do not apply Foundation.

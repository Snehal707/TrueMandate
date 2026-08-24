# Stage C Networking Deployment Report

**Date:** 2026-08-14  
**Status:** Foundation networking applied. Runtime Direct VPC is live on the S2S path that can start (`web → public-bff → intent-provenance`, plus `authority` and `outcome-resolution`). Gateway and agent-runtime **cannot** attach Direct VPC `ALL_TRAFFIC` while Model Armor probes `*.rep.googleapis.com`. **STOP.** Do not start SAFE/demo acceptance.

**Hard stops honored:** no operator `roles/iam.serviceAccountTokenCreator`, no weakening of `INTERNAL_ONLY`, no live payments, no extra invoker IAM, no Secret Manager population, no Cloud NAT / Cloud Router / subnet IAM / firewall / Model Armor template / Firestore / Pub/Sub topology / service-account changes, identity/access tokens were not printed, gateway remains `MockPaymentAdapter`.

## Project

| Field | Value |
|-------|-------|
| Project | `elite-crossbar-505104-t9` |
| Region | `us-central1` |
| Prefix | `tm-dev` |
| Artifact Registry | `us-central1-docker.pkg.dev/elite-crossbar-505104-t9/truemandate` |
| Operator | `snehalsatpute707@gmail.com` (`roles/owner`) |
| Foundation plan applied | `infrastructure/terraform/stages/foundation/tfplan.foundation.networking` |
| Runtime plan (first apply) | `infrastructure/terraform/stages/runtime/tfplan.runtime.networking.real` |
| Predicted-link plan **not** applied | `tfplan.runtime.networking` |

---

## 1. Foundation apply

Inspected `tfplan.foundation.networking` JSON before mutation: **3 create / 0 update / 0 delete / 0 replace**.

| Resource | Live result |
|----------|-------------|
| `google_project_service.required_apis["compute.googleapis.com"]` | Compute Engine API enabled |
| `google_compute_network.s2s` | `tm-dev-s2s` |
| `google_compute_subnetwork.s2s` | `tm-dev-s2s-usc1`, `10.64.0.0/24`, `us-central1`, `private_ip_google_access=true` |

Apply: **3 added, 0 changed, 0 destroyed.**

No Cloud Router, Cloud NAT, subnet IAM, or firewall resources were in the plan or created. `gcloud compute routers list` is empty. Firewalls remain on the `default` network only.

Real Foundation outputs:

- `vpc_network` = `projects/elite-crossbar-505104-t9/global/networks/tm-dev-s2s`
- `vpc_subnet` = `projects/elite-crossbar-505104-t9/regions/us-central1/subnetworks/tm-dev-s2s-usc1`
- `vpc_egress` = `ALL_TRAFFIC`

Post-apply Foundation plan: **No changes** (exit 0). No Model Armor template drift.

---

## 2. Runtime wiring and first apply

`infrastructure/terraform/stages/runtime/main.tf` non-fixture `terraform_remote_state.foundation` now supplies `vpc_network`, `vpc_subnet`, and `vpc_egress`. Predicted `vpc_*` overrides were removed from gitignored `terraform.tfvars`. Retained `use_foundation_fixture=false`, `required_secret_ids=[]`, and every approved digest, including outcome-resolution `sha256:15aad3908a1731ae79e586f66a93880f259b1477c46628cb6ec7e81c69483a7c`.

Fresh plan `tfplan.runtime.networking.real` audited as **0 add / 7 change / 0 destroy / 0 replace**:

- Direct VPC `ALL_TRAFFIC` + image: `public-bff`, `agent-runtime`, `intent-provenance`, `authority`, `gateway`, `outcome-resolution`
- Image only: `observability-api`
- `web` and `benchmark-runner` absent
- No IAM / Pub/Sub / SA / ingress / scaling / NAT in the delta

First `terraform apply` of that plan:

| Service | Result |
|---------|--------|
| `intent-provenance` | Ready `00002-r4r`, Direct VPC `ALL_TRAFFIC` |
| `outcome-resolution` | Ready `00002-gh9`, Direct VPC `ALL_TRAFFIC` |
| `observability-api` | Ready `00002-bq5`, image only (no VPC) |
| `authority` | New revision `00002-pz5` **failed startup** (no application logs; `/readyz` `ERROR_CONNECTION_FAILED` inside the default 30s probe window) |
| `gateway` | New revision `00002-c9w` **failed startup**: `Model Armor probe failed — fail closed` against `https://modelarmor.us-central1.rep.googleapis.com` |
| `public-bff`, `agent-runtime` | Not attempted. `google_cloud_run_v2_service.s2s` depended on the entire `runtime` map |

`s2s` `depends_on` was then narrowed to `runtime["intent-provenance"]` only, matching `INTENT_PROVENANCE_URL`. VPC callers now use a longer `/readyz` probe (`initial_delay=10`, `timeout=3`, `period=10`, `failure_threshold=12`) because Direct VPC NIC attach plus Firestore init exceeded Cloud Run’s default 30s window on `authority`.

---

## 3. Conditional completion of the seven-service delta

Private Google Access **does not support** regional endpoints (`*.rep.googleapis.com`). Model Armor’s adapter probes `modelarmor.us-central1.rep.googleapis.com`. With Direct VPC `egress=ALL_TRAFFIC` and **no NAT**, that probe fail-closes and the container exits before listen. Lengthening the startup probe cannot help: the process exits in ~21s.

Therefore:

| Service | What was applied | Direct VPC | Ready revision |
|---------|------------------|------------|----------------|
| `public-bff` | ACK image + VPC + longer probe | **yes** `ALL_TRAFFIC` on `tm-dev-s2s` / `tm-dev-s2s-usc1` | `00002-xtd` |
| `authority` | VPC + longer probe (image already pinned) | **yes** | `00003-djw` |
| `intent-provenance` | Terraform first apply | **yes** | `00002-r4r` |
| `outcome-resolution` | Terraform first apply | **yes** | `00002-gh9` |
| `observability-api` | Terraform first apply, image only | no | `00002-bq5` |
| `gateway` | Failed VPC revision cleared (`--clear-network`) so RoutesReady returned to True | **no** (blocked) | `00003-zfk` |
| `agent-runtime` | ACK image only (`sha256:854f4fe0…`); VPC **not** attached | **no** (blocked) | `00002-jk7` |

Gateway remains `MockPaymentAdapter` (no live processor). Ingress unchanged (`INTERNAL_ONLY` on trust services; `INGRESS_ALL` on `web` and `public-bff`). Invoker IAM unchanged:

- `public-bff`: `tm-dev-web@…` only (no `allUsers`)
- `intent-provenance`: `public-bff`, `agent-runtime`, self
- `gateway`: `tm-dev-authority@…` and self (OIDC); **not** internet

Template max instances remain 3; min 0.

Not attached to Direct VPC (unchanged, as planned): **web**, **observability-api**, **benchmark-runner**.

---

## 4. Live workload proofs

### 4.1 `web → public-bff → intent-provenance` (proven)

`POST https://tm-dev-web-o2sz2wgoma-uc.a.run.app/v1/intents` as the public web proxy (workload metadata identity, no operator impersonation):

```json
{"principalId":"stage-c-net-verify","rawText":"Stage C networking harmless catalog lookup 20260814T194301Z. Do not purchase anything."}
```

HTTP 200. Created `intent-3ce157504323` (`contentHash=1426f193589c23dcab882f2eff82aa9d24c34e61f7d44efbfac3f9eadeeacbb0`).

Request log correlation:

| Time (UTC) | Service | Status | URL |
|------------|---------|--------|-----|
| 14:13:16 | `tm-dev-web` | 200 | `/v1/intents` |
| 14:13:26 | `tm-dev-public-bff` | 200 | `/v1/intents` |
| 14:13:27 | `tm-dev-intent-provenance` | 200 | `/internal/intents` |

Durable Firestore `(default)` document `intents/intent-3ce157504323` matches the response body.

### 4.2 Pub/Sub ACK (proven on outcome-resolution and ACK agent-runtime)

OIDC push to `INTERNAL_ONLY` continues to work without caller VPC.

| Case | Evidence |
|------|----------|
| 2xx success | `tm-dev-outcome-resolution` `POST /internal/events` 200 at 14:20:12 (execution SUCCESS) and 14:20:54 (evidence PARTIAL) |
| Duplicate 2xx | Same execution envelope republished; 200 at 14:20:51. Evidence envelope republished; 200 at 14:22:17. Contract stayed `PARTIAL` / `paymentStatus=SUCCESS`. Still **one** Resolution Case. Domain-layer payment/trigger dedupe is durable in Firestore; `InMemoryPubSubBus` idempotency is process-local and is **not** claimed across scale-to-zero |
| 4xx malformed | Incomplete envelope on `tm-dev-execution.events` → outcome-resolution **400** (retried to DLQ, `max_delivery_attempts=5`). ACK agent-runtime malformed `intent.events` payload → **400** |
| 5xx natural | ACK `agent-runtime` valid compile envelope → **503** in ~80ms (see §4.3). Not manufactured by IAM, networking, or model-availability changes |

### 4.3 Gemini 3.7 and Model Armor

| Proof | Result |
|-------|--------|
| Model Armor **boot probe** (gateway + VPC) | **Failed closed** on `tm-dev-gateway-00002-c9w` at 13:57:04: `Model Armor probe failed — fail closed` |
| Model Armor **boot probe** (agent-runtime, no VPC) | **Succeeded**. ACK revision `00002-jk7` listened and `/readyz` passed. Per-event Armor is still not wired into `handleIntentCompileEvent` |
| Gemini 3.7 per-event | **Not proven.** After pinning the ACK image, a valid `intent.events` compile returned **503 in 80ms**. No Vertex/Gemini log lines. No `intent-provenance` `/internal/intents` or `/internal/*` owner write after 14:13:27. Failure is the missing Direct VPC on the caller: INTERNAL_ONLY `*.run.app` is not reached, so compile never gets to the model |

### 4.4 `authority → gateway /healthz` (blocked as specified)

Authority has no S2S HTTP client/route. Gateway is Ready (`00003-zfk`), ingress internal, invoker members remain `tm-dev-authority@…` and self. Workload-hop proof **not** produced. No harness, image change, or impersonation was added. No prepare/commit/payment.

---

## 5. Durable outcome / resolution (proven, no Gateway settlement)

Synthetic IntentState `state-intent-3ce157504323-v1` and OutcomeContract `oc-stage-c-intent-3ce157504323` were written directly to Firestore, bound to the verified Intent. No Gateway prepare/commit.

| Step | Durable result |
|------|----------------|
| `execution.events` SUCCESS | `paymentStatus=SUCCESS`, contract state `AWAITING_OUTCOME` (not `SATISFIED`). Event `ev-pay-oc-stage-c-intent-3ce157504323` (`payment_settled`) |
| `evidence.events` PARTIAL (`quantityReceived=450` of 500) | Contract state `PARTIAL`, payment still `SUCCESS`. Requirement `quantity_received=PARTIAL`; other requirements `SATISFIED` |
| Resolution | **One** case `rc-oc-stage-c-intent-3ce157504323-875f724820a95be2`, `state=OPEN`, `responsibilityState=UNKNOWN`, no root-cause code. Trigger identity recorded once |
| Immediate duplicate envelopes | 2xx; no second case; no further state transition |

Observation facts were applied onto the contract. Raw `evidenceArtifacts` / `evidenceClaims` documents were **not** written; the live handler does not persist the envelope as an evidence artifact. Resolution Case opening is durable; in-memory timelines/hypotheses are not.

No privileged remedy or payment path was invoked.

---

## 6. Scale-to-zero durability

`tm-dev-intent-provenance` started a genuine new instance at 14:13:27 (`AUTOSCALING` / no existing capacity) for the create. Firestore later returned the identical Intent `intent-3ce157504323` / `contentHash=1426f193…`. `tm-dev-outcome-resolution` similarly started a new instance at 14:20:12 for the first execution push; the contract remained reconstructable.

A second forced scale-to-zero (idle until every instance is gone, then replay) was **not** waited out beyond that window and is not claimed.

---

## 7. Post-apply Terraform drift (not applied)

| Stage | Read-only plan |
|-------|----------------|
| Foundation | **No changes** |
| Runtime | **0 add / 6 change / 0 destroy** |

Runtime residual (do **not** apply):

| Resource | Drift | Risk if applied |
|----------|-------|-----------------|
| `authority`, `public-bff` | `client=gcloud` metadata only | Cosmetic |
| `intent-provenance`, `outcome-resolution` | Longer startup probe only | Safe in-place |
| `gateway` | Add Direct VPC `ALL_TRAFFIC` + longer probe | **Would fail Model Armor boot probe again** |
| `agent-runtime` | Add Direct VPC `ALL_TRAFFIC` + longer probe | **Would fail Model Armor boot probe again** |

No residual NAT, router, IAM, Pub/Sub, or Secret Manager changes.

---

## 8. Explicit blockers

1. **Model Armor regional REP vs PGA.** `https://modelarmor.us-central1.rep.googleapis.com` is not reachable with Direct VPC `ALL_TRAFFIC` + Private Google Access and no NAT. Google documents that PGA does not support `*.rep.googleapis.com`. Completing gateway/agent-runtime VPC requires a later reviewed Foundation change (Private Service Connect regional endpoint + Cloud DNS, or an approved global `modelarmor.googleapis.com` adapter + new image). NAT remains prohibited.
2. **`agent-runtime` S2S to intent-provenance.** Without caller VPC, compile returns natural **503** (~80ms) and never reaches Gemini 3.7 or owner writes. Attaching VPC hits blocker 1.
3. **`authority → gateway` workload hop.** No authority-side S2S client. Reported blocked; IAM and Ready verified only.
4. **Per-event Model Armor.** Compiler wiring does not pass the Armor adapter into `handleIntentCompileEvent`. Only boot-probe evidence exists.
5. **Operator impersonation.** Still denied (`iam.serviceAccounts.getAccessToken`). Live proofs used the public web proxy and Pub/Sub publish only.
6. **In-process ACK maps.** Duplicate 2xx for general Pub/Sub keys is instance-local. Cross-instance / post-scale-to-zero duplicate protection was proven only for durable outcome payment status, contract state, and resolution trigger identity.
7. **Raw evidence durability.** Applied observation snapshots updated the contract; `evidenceArtifacts` / `evidenceClaims` were not created.

---

## 9. What is now true in GCP

- Dedicated S2S VPC/subnet exist with PGA, no NAT.
- Cloud Run S2S **works** for the implemented client: `web → public-bff → intent-provenance` (`INTERNAL_ONLY` owner).
- Pub/Sub OIDC push to INTERNAL_ONLY still works, including outcome-resolution ACK 2xx/4xx and durable payment≠outcome separation.
- Gateway and agent-runtime stay Ready **without** Direct VPC so Model Armor boot can succeed.
- SAFE/demo acceptance has **not** started.

**STOP.** Do not start SAFE/demo acceptance.

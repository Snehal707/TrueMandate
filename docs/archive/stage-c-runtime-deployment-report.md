# Stage C Runtime Deployment Report

**Date:** 2026-08-14  
**Status:** Runtime applied on `elite-crossbar-505104-t9`. Nine Cloud Run services are Ready on digest-pinned images. Workload-identity S2S impersonation is denied for the operator, so several live proofs stopped as specified. **STOP.** Do not start SAFE/demo acceptance.

**Hard stops honored:** no Foundation `terraform apply`, no Model Armor template mutation, no IAM beyond the reviewed Runtime plan, no Secret Manager population, no live payment processor, gateway remains `MockPaymentAdapter`, identity/access tokens were not printed, no SAFE/demo scenarios.

## Project

| Field | Value |
|-------|-------|
| Project | `elite-crossbar-505104-t9` |
| Region | `us-central1` |
| Prefix | `tm-dev` |
| Artifact Registry | `us-central1-docker.pkg.dev/elite-crossbar-505104-t9/truemandate` |
| Foundation state | real (`use_foundation_fixture = false`) |
| Image tag | `c20260814T081002Z-02c630f8` |
| Operator | `snehalsatpute707@gmail.com` (`roles/owner`) |

---

## 1. Apply counts

Saved plan `infrastructure/terraform/stages/runtime/tfplan.runtime` showed **75 add / 0 change / 0 destroy / 0 replace** before apply. Digests, `TM_REQUIRE_INTERNAL_AUTH`, `INTENT_PROVENANCE_URL`, and no viewer `roles/datastore.user` matched the reviewed plan.

First apply failed on Windows `local-exec` quoting for `terraform_data.secret_preflight` (`cmd /C` concatenated the quoted absolute script path with the Terraform chdir). Six `google_service_account_iam_member.pubsub_token_creator` bindings were created before the failure. No Cloud Run services were created in that attempt.

Recovery (same resource graph, no extra IAM):

- `secret_preflight` now uses `working_dir` + unquoted `node secret-preflight.mjs` (`required_secret_ids = []`, metadata-only, 0 secrets).
- Residual plan: **69 add / 0 change / 1 destroy** (tainted `terraform_data.secret_preflight` replace only).
- Residual apply: **69 added, 0 changed, 1 destroyed.** Preflight: `secret-preflight: ok (0 secrets have ENABLED versions)`.

Combined with the six IAM members from the first attempt, this is the reviewed 75-resource Runtime set.

---

## 2. Nine Cloud Run services

All nine report **Ready / True**, latest revision 100% traffic. Images are `@sha256:…` (never `:latest`). `min_instance_count` is 0 (Cloud Run default; API also reports `manual_instance_count = 0`).

| Service | Ready revision | Ingress | Service account | Startup probe |
|---------|----------------|---------|-----------------|---------------|
| `tm-dev-intent-provenance` | `00001-qm8` | internal | `tm-dev-intent-provenance@…` | `/readyz` |
| `tm-dev-authority` | `00001-kgh` | internal | `tm-dev-authority@…` | `/readyz` |
| `tm-dev-gateway` | `00001-4l8` | internal | `tm-dev-gateway@…` | `/readyz` |
| `tm-dev-outcome-resolution` | `00001-mb8` | internal | `tm-dev-outcome-resolution@…` | `/readyz` |
| `tm-dev-agent-runtime` | `00001-wt5` | internal | `tm-dev-agent-runtime@…` | `/readyz` |
| `tm-dev-observability-api` | `00001-dvh` | internal | `tm-dev-observability-api@…` | `/readyz` |
| `tm-dev-public-bff` | `00001-x67` | all | `tm-dev-public-bff@…` | `/readyz` |
| `tm-dev-benchmark-runner` | `00001-mcs` | internal | `tm-dev-benchmark-runner@…` | `/readyz` |
| `tm-dev-web` | `00001-cl9` | all | `tm-dev-web@…` | `/healthz` |

### Digests (match reviewed images)

| Image | Digest |
|-------|--------|
| intent-provenance | `sha256:9d8ea81d8cd226c313f00bc2461a2d98d80895a07455340b43ad9ff5ce28dcdb` |
| public-bff | `sha256:aa0ac86f98694162cbd6eeaa934aeba6762007ac0a84d923cb09370694fb265c` |
| agent-runtime | `sha256:c78f993bd84e135066e626194e794bb393385e1ceaa6ff15644b5dff3ffa5ffd` |
| authority | `sha256:70d334cf456fef083ab17f2008c7602acc17345a0e07a7e5bda0ece20b0cb6ec` |
| gateway | `sha256:4c2348e035d5e31f22775798e7d13195a0c850cc8414cf5fc8b92d92dbad2900` |
| outcome-resolution | `sha256:dafb322a0d869ac42a9cde0939786b50935b202f38db83288499355c6a46f12f` |
| observability-api | `sha256:c3935a186cc527d93de0eff34ef589995b0bb43b26347ecc9948e7768c0de96e` |
| benchmark-runner | `sha256:3c67f4c4f89d88e7c6ed22314d114db9094e8b4444b838a71128984ef694525a` |
| web | `sha256:729db96fed08646f4bc7224bf0eae83ae1f1e72693513f275bae23ebd152e137` |

### Invoker IAM (sampled)

| Service | `roles/run.invoker` members |
|---------|-----------------------------|
| web | `allUsers` |
| public-bff | `tm-dev-web@…` only (**no** `allUsers`) |
| gateway | `tm-dev-authority@…`, `tm-dev-gateway@…` (OIDC self-invoke) |

Gateway remains internal.

### Env (material)

- intent-provenance: `TM_PERSISTENCE=firestore`, `TM_REQUIRE_INTERNAL_AUTH=true`
- public-bff / agent-runtime: `INTENT_PROVENANCE_URL=https://tm-dev-intent-provenance-o2sz2wgoma-uc.a.run.app`, `TM_PERSISTENCE=firestore`
- agent-runtime: `GEMINI_MODEL=gemini-3.7-flash`, `VERTEX_LOCATION=global`, `TM_MODEL_ARMOR_TEMPLATE=projects/…/templates/tm-dev-prompt-response`
- benchmark-runner: `TM_PERSISTENCE=memory` (expected)
- web: `PUBLIC_BFF_URL=https://tm-dev-public-bff-o2sz2wgoma-uc.a.run.app`

---

## 3. Process and dependency readiness

Startup HTTP probes succeeded on every service (Cloud Run system logs). Listening logs:

| Service | Evidence |
|---------|----------|
| public-bff | `persistence=firestore`, `storeKind=firestore`, `firestoreClient=initialized`, `intentOwner=intent-provenance-s2s` |
| gateway | `persistence=firestore` (listening). ExtraHealth also sets `storeKind` / `firestoreClient` / `armorLive` on `/healthz` (not reachable from this laptop; see §4) |
| intent-provenance / authority / outcome-resolution / observability-api / agent-runtime / benchmark-runner | process listening; `/readyz` probe succeeded. Privileged Firestore probe is a Get of `_health/readyz` (missing doc = ready) |
| agent-runtime | boot completed after `ModelArmorAdapter.probe()` and `VertexGeminiModel.fromEnv()` — process exits if Armor probe fails |
| benchmark-runner | Terraform `TM_PERSISTENCE=memory` |

Internal `/healthz` and `/readyz` were **not** claimed from public 404s. `gcloud run services proxy` is unavailable: the `cloud-run-proxy` component is not installed, and non-interactive component install is blocked on this SDK.

Public web: `GET /` → **200** (SPA). In-cluster startup probe `/healthz` succeeded. Public `GET /healthz` → Google Frontend **404** HTML (not the app JSON). Public `GET /foo` → **200** (SPA fallback).

---

## 4. Real Cloud Run S2S (workload identities)

**STOP on impersonation.** `gcloud auth print-identity-token --impersonate-service-account=tm-dev-web@… --audiences=<public-bff>` returned `PERMISSION_DENIED` (`iam.serviceAccounts.getAccessToken`) despite project `roles/owner`. Runtime SA IAM policies have no operator `roles/iam.serviceAccountTokenCreator` binding (Pub/Sub agent only, as reviewed). No extra IAM was added. `TM_S2S_BEARER` / `Bearer test` were not used.

User accounts cannot mint Cloud Run audience identity tokens (`Invalid account type for --audiences`). Operator identity token without audience to public-bff → **404**.

### Positives

| Hop | Result |
|-----|--------|
| web SA → public-bff `/healthz` | **Not proven.** Impersonation denied. |
| public-bff → intent-provenance (POST `/v1/intents` as web SA + Firestore) | **Not proven.** Same impersonation stop. |
| agent-runtime → intent-provenance (Pub/Sub compile) | Push **reached** agent-runtime (IAM + internal ingress allow Pub/Sub). Valid `intent.events` delivery returned **200** in **97ms**. **No** `intent-provenance` `/internal/*` request logs after boot. Firestore `(default)` `intents/` list is empty. In-cluster owner S2S from the compile handler is **not** proven. |
| authority SA → gateway `/healthz` via proxy while impersonating | **Not proven.** Impersonation denied; proxy component missing; internet hits INTERNAL_ONLY → **404**. |

### Negatives (HTTP status only)

| Call | Status | Notes |
|------|--------|-------|
| anonymous → public-bff `/healthz` | **404** | Google Frontend HTML. Expected 403 if IAM is evaluated; GFE hid the service instead. |
| anonymous/internet → gateway `/healthz` | **404** | INTERNAL_ONLY before IAM. |
| impersonated web / public-bff / agent-runtime / intent-provenance / benchmark-runner / observability-api → gateway | **not executed** | Impersonation denied. Internet without impersonation: **404**. |
| no `Authorization` to intent-provenance `/internal/intents` from internet | **404** | INTERNAL_ONLY before app 401. |

---

## 5. Deployed owner routing

Demo id `intent-stage-c-deploy-1`. Harmless procurement text. No payment.

1. `POST /v1/intents` as web SA: **not executed** (impersonation stop).
2. Firestore `intents/intent-stage-c-deploy-1`: **404** (document absent). `intents` list: 0 documents.
3. GET owner `/internal/intents/:id` as public-bff SA: **not executed**.
4. One `intent.events` envelope was published (Pub/Sub REST, after an initial `gcloud --message` publish that produced 400 `MALFORMED_EVENT` retries). Agent-runtime, authority, and observability-api returned **200** on that delivery. Compile did not persist (see §4).
5. `intentStates` / `provenanceNodes` / `provenanceEdges` for this demo id: **absent**. GET `intent-node-intent-stage-c-deploy-1`: **404**.
6. Viewers remain Foundation **`roles/datastore.viewer` only**. `roles/datastore.user` is only on intent-provenance, authority, gateway, outcome-resolution. public-bff and agent-runtime have **no** `datastore.user`.

---

## 6. Firestore durability across restart

Nothing durable was written for the demo intent, so reconstruction after scale-to-zero cannot be demonstrated.

`min_instance_count = 0`. No labels/env were added (would have created a new revision). Intent-provenance had no `/internal/*` traffic after deploy; no “Shutting down” instance logs were observed in the verification window. Demo docs were not deleted (none existed). Unrelated Firestore data was not deleted.

---

## 7. Pub/Sub Runtime

All **20** push subscriptions exist (`tm-dev-{consumer}--{topic}-push`). Each: endpoint `/internal/events`, OIDC consumer SA, audience = Cloud Run URI, retry `minimumBackoff=10s`, DLQ `tm-dev-{topic}-dlq`, ack deadline 60s. Pub/Sub agent `service-547914435840@gcp-sa-pubsub` has `roles/iam.serviceAccountTokenCreator` on consumer SAs (verified on `tm-dev-agent-runtime`; created for all six event consumers at apply).

Push from Pub/Sub **does** reach INTERNAL_ONLY services (request `userAgent=APIs-Google`, HTTP 200/400 from the app, not GFE 404).

Safe publishes (operator publisher, not economic):

| Case | Observation |
|------|-------------|
| Warm `security.events` / valid `intent.events` | observability-api **200** (`responseSize=156`, `{status:ok}`). Duplicate warm: second **200** (bus returns ok without re-running handler on that instance). |
| Stale `aggregateVersion` rewind | observability-api **400** after 200s (`responseSize` 210 vs 247 — two rejection classes). Application response body is not in request logs; consistent with `EVENT_REJECTED` / `Out-of-order aggregate version rejected` plus leftover malformed retries from the first publish. Not settlement. |
| Compile path | single valid `intent.events` after the malformed batch; see §5. |

---

## 8. Gemini from Cloud Run identity

`scripts/cloud/gemini-37-smoke.mjs` was **not** used as Cloud Run proof.

| Check | Result |
|-------|--------|
| Env | `geminiModel` default / `GEMINI_MODEL=gemini-3.7-flash`, `VERTEX_LOCATION=global` |
| Boot | `VertexGeminiModel.fromEnv()` succeeded (process up) |
| Auth | Cloud Run SA `tm-dev-agent-runtime@…` has `roles/aiplatform.user` |
| Live `generateContent` | **Not proven.** Compile handler 200 in 97ms with no owner HTTP and no Vertex success logs. |

---

## 9. Model Armor from Cloud Run

Template (read-only): `projects/elite-crossbar-505104-t9/locations/us-central1/templates/tm-dev-prompt-response`.

| Check | Result |
|-------|--------|
| `updateTime` | `2026-08-13T22:18:23.547967143Z` before and after sanitize — **unchanged**. REST GET did not return `etag`. No `gcloud model-armor templates update`. No Foundation apply. |
| agent-runtime boot | Armor `probe()` succeeded (otherwise process exits). |
| Sanitize as **agent-runtime SA** | **Not proven.** Impersonation denied. |
| Sanitize as operator ADC (not the specified Cloud Run proof) | benign procurement → `NO_MATCH_FOUND`; obvious injection → `MATCH_FOUND`. HTTP 200. |
| CLEAN does not strip taint | Live sanitize API has no taint field. Code: `preserveTaintThroughInspection` in `packages/cloud-security/src/model-armor-adapter.ts` and `model-security-port.ts` copies `input.taint` unchanged. Tests: `packages/cloud-security/src/model-security.test.ts` (`never clears taint on CLEAN inspection`, `CLEAN preserves taint`). |
| Unavailable fails closed | Boot `probe()`. `inspect()` returns `ErrorCode.MODEL_UNAVAILABLE` when not available (`model-armor-adapter.ts`). Tests treat UNAVAILABLE as not safe. Armor was not disabled. |

---

## 10. Gateway safety

- Source of the deployed gateway digest still contains `private readonly adapter = new MockPaymentAdapter()` in `services/gateway-service/src/two-phase.ts`. No Stripe/Adyen/PayPal/UPI.
- Ingress internal; anonymous internet `/healthz` **404**.
- Authority-only 2xx on `/healthz` **not proven** (impersonation / proxy). Gateway IAM members are only authority SA + self.
- Health/ready only. **Did not** publish execution/payment envelopes or call prepare/commit.

---

## 11. Post-apply Terraform (read-only)

```
terraform -chdir=infrastructure/terraform/stages/runtime plan -input=false -no-color -detailed-exitcode
```

Exit code **2**. **Plan: 0 to add, 9 to change, 0 to destroy.** No create/destroy/replace.

The nine in-place updates are Cloud Run `scaling` API defaults (`min_instance_count = 0`, `manual_instance_count = 0`) that Terraform wants to drop because the module does not set that block. **Not applied.**

Foundation apply was **not** run. Foundation read-only plan for Model Armor `template_metadata` drift was **not** run (template `updateTime` already unchanged via REST GET).

---

## 12. Billing / quota / runtime errors

- Apply succeeded after the Windows preflight fix. No quota errors on Cloud Run create.
- `gcloud model-armor templates describe` → `PERMISSION_DENIED` (gcloud surface). Regional REP REST GET/sanitize with operator ADC succeeded.
- Pub/Sub first publish via PowerShell/`gcloud --message` mangled JSON → app **400** and retries/DLQ path. Republish via Pub/Sub REST succeeded.
- Compile handler does not fail the bus when `compileAndVerify` returns `err` (200 despite no owner persist).

---

## Remaining blockers

1. **Workload SA impersonation denied** for the Owner user (`iam.serviceAccounts.getAccessToken`). Blocks web→BFF, authority→gateway proxy-as-SA, Armor sanitize as agent-runtime SA, and owner GET as public-bff SA. Do not add TokenCreator without a reviewed IAM change.
2. **`gcloud run services proxy` unavailable** (missing `cloud-run-proxy` component; non-interactive install blocked).
3. **Owner S2S from agent-runtime not observed:** valid `intent.events` 200 in 97ms, zero intent-provenance `/internal/*` logs, empty Firestore `intents`. Live Gemini 3.7 generateContent and owner routing are unproven on this deployment.
4. **BFF create path unproven** for the same impersonation reason.
5. **Public-bff anonymous status is 404** rather than 403.
6. **Post-apply scaling-block drift** (benign; do not apply).
7. Windows `local-exec` path quoting required a Runtime module provisioner change to finish apply.

**STOP.** No SAFE/demo acceptance scenarios.

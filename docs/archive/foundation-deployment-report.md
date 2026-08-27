# Foundation Deployment Report (Stage A)

**Date:** 2026-08-14  
**Status:** Stage A applied and verified. **STOP.** Do not populate secrets, build images, or apply runtime Terraform until this report is reviewed.

## Project

| Field | Value |
|-------|-------|
| Project | `elite-crossbar-505104-t9` |
| Project number | `547914435840` |
| Region | `us-central1` |
| Environment / name prefix | `dev` / `tm-dev` |
| Stage | A only — `infrastructure/terraform/stages/foundation` |
| Saved plan | `tfplan.foundation` (applied exactly) |
| Billing | Enabled (`billingAccounts/015B6E-8F7951-499701`) |

## Apply counts

| Gate | Plan (saved) | Apply |
|------|-------------:|------:|
| Create / add | **112** | **112** |
| Change | **0** | **0** |
| Destroy | **0** | **0** |
| Replace | **0** | **0** |

Pre-apply JSON parse of `tfplan.foundation`: 112 create, 0 update, 0 delete, 0 replace. Zero `google_pubsub_subscription`. Zero Cloud Run / runtime-module addresses.

Terraform: `Apply complete! Resources: 112 added, 0 changed, 0 destroyed.`

State after apply: **113** entries (112 managed resources + `data.google_project.current`).

## Resources successfully created

All 112 planned Foundation resources were created. Summary:

| Kind | Count | Result |
|------|------:|--------|
| Required APIs (`google_project_service`) | 9 | Created |
| API settle wait (`time_sleep.wait_apis`) | 1 | Created (60s) |
| Firestore Native `(default)` | 1 | Created |
| Artifact Registry Docker repo `truemandate` | 1 | Created |
| Runtime service accounts | 9 | Created |
| Domain Pub/Sub topics | 11 | Created |
| DLQ Pub/Sub topics | 11 | Created |
| Pull subscriptions | 0 | Intentionally not created |
| Secret Manager shells | 4 | Created (no versions) |
| Model Armor template | 1 | Created |
| Project IAM (Firestore RW/RO, Vertex, Model Armor) | 13 | Created |
| Topic publisher IAM | 22 | Created |
| DLQ Pub/Sub agent publisher IAM | 11 | Created |
| Secret accessor IAM | 8 | Created |
| Artifact Registry reader IAM | 9 | Created |

No Cloud Run services. No pull subscriptions. No user-managed service-account JSON keys.

## Failed resources

**None.** Apply exit code 0. No Terraform errors, quota errors, or billing errors during apply.

### Verification caveat (not a failed create)

`gcloud model-armor templates describe` and the Model Armor REST `GET` both return **403** (`Read access to project was denied`) for the human Owner account. Terraform created the template and **refreshed it successfully** on a post-apply plan. The resource exists in state and in provider refresh:

`projects/elite-crossbar-505104-t9/locations/us-central1/templates/tm-dev-prompt-response`

TrueMandate Model Armor policy was **not** weakened. Template IAM `roles/modelarmor.user` is present on the three intended service accounts.

### Post-apply drift (not applied)

A follow-up `terraform plan -detailed-exitcode` (read-only verification, **not applied**) reported:

`Plan: 0 to add, 1 to change, 0 to destroy.`

The single in-place change is API-default `template_metadata` on `google_model_armor_template.tm_prompt_response` (zeros/false values returned by the API that the config does not set). This is provider/API metadata drift. **It was not applied.** Destroy and replace remain zero. Filter config (RAI, PI/jailbreak, malicious URI) is unchanged.

## Enabled APIs

All nine Foundation-required APIs are enabled:

- `run.googleapis.com`
- `firestore.googleapis.com`
- `pubsub.googleapis.com`
- `artifactregistry.googleapis.com`
- `secretmanager.googleapis.com`
- `aiplatform.googleapis.com`
- `iam.googleapis.com`
- `modelarmor.googleapis.com`
- `iamcredentials.googleapis.com`

Additional APIs already enabled on the project (not created by this apply; not destroyed): includes `datastore.googleapis.com`, BigQuery family, Cloud Storage, Logging, Monitoring, and other Google defaults. No unrelated existing API was disabled.

## Firestore result

| Field | Value |
|-------|-------|
| Database | `(default)` |
| Type | `FIRESTORE_NATIVE` |
| Location | `us-central1` |
| Edition | STANDARD |
| App Engine integration | DISABLED |
| Conflict with Datastore-mode default | **None** — Native database created as intended |

Only one database exists. No convert/destroy was required.

## Artifact Registry result

| Field | Value |
|-------|-------|
| Repository | `truemandate` |
| Location | `us-central1` |
| Format | DOCKER |
| URI | `us-central1-docker.pkg.dev/elite-crossbar-505104-t9/truemandate` |
| Size | 0.000MB (no images — Stage B not run) |
| IAM | `roles/artifactregistry.reader` on all nine TrueMandate SAs; **no** `allUsers` |

## Pub/Sub result

**11 domain topics** (`tm-dev-<topic>`):

- `intent.events`, `semantic.events`, `plan.events`, `guardian.events`, `authority.events`, `execution.events`, `evidence.events`, `outcome.events`, `resolution.events`, `security.events`, `observability.events`

**11 DLQ topics** (`tm-dev-<topic>-dlq`) for the same set.

**Subscriptions:** none (`pubsub_subscription_names = {}`). Pull remains off.

Sample IAM matches the reviewed design:

- `tm-dev-intent.events` publisher: `tm-dev-intent-provenance` only
- `tm-dev-observability.events` publishers: observability-api, intent-provenance, authority, gateway, outcome-resolution, agent-runtime, benchmark-runner
- DLQ topics: Pub/Sub service agent `service-547914435840@gcp-sa-pubsub.iam.gserviceaccount.com` as `roles/pubsub.publisher`
- **No** `allUsers` / `allAuthenticatedUsers` on sampled topics

## Model Armor result

| Field | Value |
|-------|-------|
| Template ID | `tm-dev-prompt-response` |
| Location | `us-central1` |
| RAI | HATE_SPEECH, DANGEROUS, SEXUALLY_EXPLICIT, HARASSMENT at `MEDIUM_AND_ABOVE` |
| PI / jailbreak | ENABLED, `MEDIUM_AND_ABOVE` |
| Malicious URI | ENABLED |
| IAM `roles/modelarmor.user` | `tm-dev-agent-runtime`, `tm-dev-gateway`, `tm-dev-benchmark-runner` |

App invariant unchanged: CLEAN must never clear taint; unavailable screening remains fail-closed.

## IAM result

Project bindings created by Foundation match the reviewed design:

| Role | Members |
|------|---------|
| `roles/datastore.user` | intent-provenance, authority, gateway, outcome-resolution |
| `roles/datastore.viewer` | agent-runtime, observability-api, public-bff, benchmark-runner |
| `roles/aiplatform.user` | agent-runtime, benchmark-runner |
| `roles/modelarmor.user` | agent-runtime, gateway, benchmark-runner |

**web** has none of Firestore, Vertex, Model Armor, Secrets, or Pub/Sub publisher. **public-bff** has Firestore viewer + observability-api-key accessor only (no Gateway).

Pre-existing project bindings left untouched: Owner (`user:snehalsatpute707@gmail.com`), default Compute Engine SA `Editor`, and Google service agents (Artifact Registry, Container Registry, Firestore, Model Armor, Pub/Sub, Cloud Run, Firebase Rules).

**Public principals:** no `allUsers` or `allAuthenticatedUsers` on project IAM or Foundation resources. (Web `allUsers` invoker is a Stage C Cloud Run binding and was not created.)

## Secret Manager shells

| Secret ID | Versions |
|-----------|----------|
| `tm-dev-vertex-model-config` | **none** |
| `tm-dev-adk-runtime-config` | **none** |
| `tm-dev-gateway-hmac-key` | **none** |
| `tm-dev-observability-api-key` | **none** |

No plaintext values. No ENABLED versions. Accessor IAM on shells only (example: `tm-dev-gateway-hmac-key` → authority + gateway).

## Nine service accounts

All exist, enabled, no user-managed JSON keys (SYSTEM_MANAGED keys only — Google-managed, not exported):

- `tm-dev-intent-provenance@elite-crossbar-505104-t9.iam.gserviceaccount.com`
- `tm-dev-authority@elite-crossbar-505104-t9.iam.gserviceaccount.com`
- `tm-dev-gateway@elite-crossbar-505104-t9.iam.gserviceaccount.com`
- `tm-dev-outcome-resolution@elite-crossbar-505104-t9.iam.gserviceaccount.com`
- `tm-dev-agent-runtime@elite-crossbar-505104-t9.iam.gserviceaccount.com`
- `tm-dev-observability-api@elite-crossbar-505104-t9.iam.gserviceaccount.com`
- `tm-dev-public-bff@elite-crossbar-505104-t9.iam.gserviceaccount.com`
- `tm-dev-benchmark-runner@elite-crossbar-505104-t9.iam.gserviceaccount.com`
- `tm-dev-web@elite-crossbar-505104-t9.iam.gserviceaccount.com`

The default Compute Engine SA remains (pre-existing). It was not modified.

## Cloud Run

`gcloud run services list` is empty. Stage C was not applied.

## Terraform outputs

| Output | Value |
|--------|-------|
| `project_id` | `elite-crossbar-505104-t9` |
| `region` | `us-central1` |
| `name_prefix` | `tm-dev` |
| `firestore_database` | `(default)` |
| `artifact_registry_repo_id` | `truemandate` |
| `model_armor_template_name` | `projects/elite-crossbar-505104-t9/locations/us-central1/templates/tm-dev-prompt-response` |
| `pubsub_subscription_names` | `{}` |
| `service_account_emails` | nine emails as listed above |
| `consumer_topics` | foundation local map (push consumers for Stage C; no pull subs created) |
| `topic_publishers` | matches `modules/foundation` locals |
| `invoker_graph` | documented intended graph (Cloud Run invokers not yet created) |
| `forbidden_invokers_to_gateway` | public-bff, web, observability-api, benchmark-runner, agent-runtime, intent-provenance, outcome-resolution |

## Billing or quota errors

None. Billing is enabled. Apply completed without quota failures.

## Terraform state health

- Apply matched the saved plan (112/0/0/0).
- State lists all intended Foundation addresses; no runtime-module resources.
- No destroy of unrelated existing Google Cloud resources.
- Residual 1-change plan is Model Armor `template_metadata` API defaults only; **not applied**; not a replace/destroy.

## Remaining prerequisites for Stage B

Stage B/C must not start until this report is reviewed. After approval, remaining work is:

1. **Secret versions (out of band, never Terraform `secret_data`)** for:
   - `tm-dev-vertex-model-config`
   - `tm-dev-adk-runtime-config`
   - `tm-dev-gateway-hmac-key`
   - `tm-dev-observability-api-key`
2. **Stage B images:** `./scripts/cloud/deploy.sh --project-id elite-crossbar-505104-t9 --tag dev` (Artifact Registry is empty).
3. **Secret preflight:** `node scripts/cloud/secret-preflight.mjs --project elite-crossbar-505104-t9 --prefix tm-dev` must see ENABLED versions before Stage C apply (runtime `terraform_data.secret_preflight` fails closed otherwise).
4. **Stage C runtime plan:** set `use_foundation_fixture=false` so runtime reads `../foundation/terraform.tfstate`, generate a fresh saved plan, confirm 0 change / 0 destroy / 0 replace, then apply only when approved.
5. Optional: decide whether to ignore Model Armor `template_metadata` drift in the provider (do not strip filter_config to “fix” it).

**Did not populate secrets. Did not build images. Did not apply `stages/runtime`.**

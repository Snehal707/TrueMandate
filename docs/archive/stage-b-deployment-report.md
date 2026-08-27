# Stage B Deployment Report

**Date:** 2026-08-14  
**Status:** Stage B complete (partial secrets + images). **STOP.** Do not run Runtime Terraform plan or apply until this report is reviewed.

## Project

| Field | Value |
|-------|-------|
| Project | `elite-crossbar-505104-t9` |
| Region | `us-central1` |
| Artifact Registry (Terraform output, used) | `us-central1-docker.pkg.dev/elite-crossbar-505104-t9/truemandate` |
| User-typed `truandate` | Misspelling — **not used**, no second repository created |
| Build identifier | `b20260814T041238Z-bc1a09b2` (Git metadata unavailable; unique timestamp + random suffix) |
| Deploy identity | **not** `latest` |

**Not done:** Foundation re-apply, Runtime plan/apply, Cloud Run services, Pub/Sub push subscriptions, IAM grants, Model Armor template edits, `template_metadata` drift apply.

## Secret schema discovered (no payloads)

Application code does **not** read these Secret Manager IDs. There is no `@google-cloud/secret-manager` client. Runtime Terraform does **not** mount secrets as Cloud Run env or volumes. IAM accessors exist; consumption does not.

| Secret | Intended IAM accessors | App consumer | Encoding / schema in source |
|--------|------------------------|--------------|-----------------------------|
| `tm-dev-vertex-model-config` | agent-runtime, benchmark-runner | **None** | **Ambiguous — STOP (no version added).** Closest code is env-var `VertexGeminiConfig` in `packages/model/src/vertex-gemini.ts`: `VERTEX_PROJECT` required; `VERTEX_LOCATION` default `us-central1`; `GEMINI_MODEL` default `gemini-2.0-flash-001`. That is **not** a Secret Manager payload schema. Trailing newline / JSON fields are not defined for this secret. |
| `tm-dev-adk-runtime-config` | intent-provenance, agent-runtime | **None** | **Ambiguous — STOP (no version added).** `packages/sdk-adk` has no env or secret loader. |
| `tm-dev-gateway-hmac-key` | authority, gateway | **None** | Opaque key. No HMAC length/encoding check in app. Generated as 256-bit CSPRNG, `base64url`, no trailing newline. |
| `tm-dev-observability-api-key` | observability-api, public-bff | **None** | Opaque key. No schema. Independent 256-bit CSPRNG, `base64url`, no trailing newline. Not reused with HMAC. |

Obsolete / parallel env vars (not secret IDs): `VERTEX_PROJECT`, `VERTEX_LOCATION`, `GEMINI_MODEL`, `GOOGLE_OAUTH_ACCESS_TOKEN`. `TM_REQUIRE_CONFIG` only requires `GOOGLE_CLOUD_PROJECT`.

## Secret version readiness

| Secret | ENABLED version | Status |
|--------|-----------------|--------|
| `tm-dev-vertex-model-config` | none | Stopped — schema not in app |
| `tm-dev-adk-runtime-config` | none | Stopped — schema not in app |
| `tm-dev-gateway-hmac-key` | `1` | Enabled (created 2026-08-13T22:40:56Z) |
| `tm-dev-observability-api-key` | `1` | Enabled (created 2026-08-13T22:41:02Z) |

Values were written from an OS temp directory with a restricted ACL, uploaded with `gcloud secrets versions add --data-file`, then deleted. No payloads in git, `.env`, Terraform state, logs, or this report.

## Secret preflight result

```
node scripts/cloud/secret-preflight.mjs --project elite-crossbar-505104-t9 --prefix tm-dev
```

**Exit 1 (expected):** missing ENABLED versions for `tm-dev-vertex-model-config`, `tm-dev-adk-runtime-config`.

HMAC and observability keys pass. Stage C `terraform_data.secret_preflight` will fail closed until the two config secrets have versions **and** a real loader/schema exists.

Windows note: first run reported all four missing because `spawnSync("gcloud", { shell: false })` cannot run `gcloud.cmd`. Fixed in `scripts/cloud/secret-preflight.mjs` (`gcloud.cmd` + `shell: true` on win32). Independent `gcloud secrets versions list` confirmed HMAC/observability version `1` ENABLED.

## Model Armor 403 diagnostic (read-only)

| Item | Finding |
|------|---------|
| Active principal | `snehalsatpute707@gmail.com` (Owner) |
| Requested resource | `projects/elite-crossbar-505104-t9/locations/us-central1/templates/tm-dev-prompt-response` |
| API enabled | `modelarmor.googleapis.com` |
| gcloud / `modelarmor.us.rep.googleapis.com` | **403** `PERMISSION_DENIED`: "Read access to project was denied" (no `permission` field in error body) |
| `modelarmor.googleapis.com` (global) | **403** same message |
| `modelarmor.us-central1.rep.googleapis.com` | **200** — template exists |
| IAM change | **None.** Owner already holds `roles/owner`. Extra human IAM was not granted. |
| Template / drift | **Not altered.** `template_metadata` drift was not applied. |

Cause: **CLI/REST endpoint location**, not missing Owner IAM. `gcloud model-armor` calls the multi-region `us` REP (`modelarmor.us.rep.googleapis.com`) for a `us-central1` template. The location-specific REP succeeds. Terraform provider refresh already succeeded against the regional resource.

`projects:testIamPermissions` could not be used: Cloud Resource Manager API is not enabled. That API was **not** enabled to silence the error.

Runtime template use remains independently testable via Terraform state and future Cloud Run `TM_MODEL_ARMOR_TEMPLATE`.

## Build identifier

`b20260814T041238Z-bc1a09b2`

No `.git` directory in the workspace, so Git SHA was unavailable.

## Images built and pushed

All ten `deploy.sh` images, `linux/amd64`, tag above, repository `truemandate` only.

| Service | Stage C? | Tag | SHA256 digest | Full URI |
|---------|----------|-----|---------------|----------|
| public-bff | yes | `b20260814T041238Z-bc1a09b2` | `sha256:582d68561f880ccbb3f172f92ef3cb94d4bfafbd4406d00adfcac634b072bcf7` | `us-central1-docker.pkg.dev/elite-crossbar-505104-t9/truemandate/public-bff@sha256:582d68561f880ccbb3f172f92ef3cb94d4bfafbd4406d00adfcac634b072bcf7` |
| gateway | yes | same | `sha256:8121bc8b126f4ba76777cbcbfe830eef4dd07bb26973c3a38ecbe401d42564cb` | `…/gateway@sha256:8121bc8b126f4ba76777cbcbfe830eef4dd07bb26973c3a38ecbe401d42564cb` |
| intent-provenance | yes | same | `sha256:0d6f7c23d9bc9a75a0e47fc8786b50815c56015d4b60a8e9877444208383086a` | `…/intent-provenance@sha256:0d6f7c23d9bc9a75a0e47fc8786b50815c56015d4b60a8e9877444208383086a` |
| authority | yes | same | `sha256:7384700d0ba57ba1c7e99cf9b8297135de1c5e75373d39bad6c0cb2736bb0939` | `…/authority@sha256:7384700d0ba57ba1c7e99cf9b8297135de1c5e75373d39bad6c0cb2736bb0939` |
| outcome-resolution | yes | same | `sha256:de9a7f1f816fef22a75c55fa3e22c2688dd0c2b343007c76fcd86d527e1c3c9e` | `…/outcome-resolution@sha256:de9a7f1f816fef22a75c55fa3e22c2688dd0c2b343007c76fcd86d527e1c3c9e` |
| agent-runtime | yes | same | `sha256:14bc54c5b7173ab611961cc8a00667f0bb787e59f9c014fb60e01fbe74106453` | `…/agent-runtime@sha256:14bc54c5b7173ab611961cc8a00667f0bb787e59f9c014fb60e01fbe74106453` |
| observability-api | yes | same | `sha256:da32897be169c1fb6ffef57dc89cf132fd8f1d40894e90cbca374cf83d2b4c79` | `…/observability-api@sha256:da32897be169c1fb6ffef57dc89cf132fd8f1d40894e90cbca374cf83d2b4c79` |
| web | yes | same | `sha256:fad36583d48543523dc820d7eecb599370408ae80ca209292144cffe07055a9c` | `…/web@sha256:fad36583d48543523dc820d7eecb599370408ae80ca209292144cffe07055a9c` |
| benchmark-runner | yes | same | `sha256:5ecff4ae22939c58a6b730aec18506ae3fe923dee39a5c0979a75522c531d30c` | `…/benchmark-runner@sha256:5ecff4ae22939c58a6b730aec18506ae3fe923dee39a5c0979a75522c531d30c` |
| attack-lab | **no** (built by deploy.sh only) | same | `sha256:be18ee10e62a54e1bc41fb8a82e360bb3c81523f2fe0a9ba3b3912c50c5f3430` | `…/attack-lab@sha256:be18ee10e62a54e1bc41fb8a82e360bb3c81523f2fe0a9ba3b3912c50c5f3430` |

Retry builds left extra **untagged** digests in the same repository. The tagged digest above is the Stage C identity.

## Artifact Registry verification

- Repository `truemandate` exists in `us-central1`, format DOCKER.
- No `truandate` repository.
- No new Artifact Registry repository was created.
- Cloud Run service list is empty.

Runtime Terraform still uses `:${var.image_tag}` plus `lifecycle.ignore_changes` on image. **Terraform was not modified** to pin digests. Stage C should pass `image_tag = "b20260814T041238Z-bc1a09b2"` and preferably switch to digest URIs later.

## Container smoke test results

Architecture: all `linux/amd64`.

| Image | Startup command | `/healthz` | Notes |
|-------|-----------------|------------|-------|
| public-bff | `node packages/public-api/dist/bin/start.js` | 200 `{"status":"ok","service":"public-bff"}` | Listens on 8080 |
| gateway, intent-provenance, authority, outcome-resolution, agent-runtime, observability-api, benchmark-runner | `node health-stub.mjs` | 200 each | Cloud Run compatible 8080 `/healthz` |
| web | `node web-proxy.mjs` | 200 `{"status":"ok","service":"web"}` | `TM_REQUIRE_CONFIG=false` |
| attack-lab | `serve -s dist -l 3000 & node health-stub.mjs` | 200 on 8080 | Static app on 3000; health on 8080 |

Fail-closed: gateway without `GOOGLE_CLOUD_PROJECT` exits **1** (`Missing GOOGLE_CLOUD_PROJECT`). Real Gateway economic commit path was **not** called.

## Credential / secret scan result

Workspace names matching `.env`, `*credentials*.json`, `*.pem`, SA JSON keys: **none** (excluding `node_modules`). Gitignored `terraform.tfvars` files contain only `project_id` (already known). Foundation `terraform.tfstate` is local state, not a secret payload; it is dockerignored.

Image filesystem scan (`find` for `.env`, credentials JSON, pem, `id_rsa`): **clean** on all ten images.

`.dockerignore` added so `.env`, tfstate, tfvars, and credential glob patterns are not sent as build context.

## Build failures (resolved during Stage B)

| Failure | Resolution |
|---------|------------|
| Gateway (and other stubs) `tsc` missing sibling services | Stub Dockerfiles now `pnpm install` only; runtime CMD is `health-stub.mjs` |
| Web/attack-lab missing workspace dist types | `pnpm --filter <pkg>... build` plus `COPY services` |
| `@truemandate/authority` excluded `fixtures.ts` while `index.ts` exports it | `packages/authority/tsconfig.json` include fixed |
| Vite `node:crypto` in browser bundle | `infrastructure/docker/node-crypto-shim.ts` + Vite aliases (SHA-256 vector `abc` verified) |
| `deploy.sh` host-arch builds | `--platform linux/amd64` |
| Windows secret-preflight false negatives | `gcloud.cmd` spawn |

Final `deploy.sh` run: **exit 0**. All ten images pushed.

## Remaining blockers for Stage C

1. `tm-dev-vertex-model-config` and `tm-dev-adk-runtime-config` still have **no ENABLED versions** (schema not in application code).
2. No Secret Manager loader and no Cloud Run secret mounts — even populated secrets are unused at runtime today.
3. Secret preflight will fail Stage C apply until (1) is resolved.
4. Set `use_foundation_fixture=false` so runtime reads Foundation state.
5. Pin images: pass tag `b20260814T041238Z-bc1a09b2` or digest URIs; consider removing `ignore_changes` on image.
6. Model Armor gcloud 403 is CLI endpoint mismatch; do not grant extra human IAM. Use regional REP or Terraform for describe.
7. Most Stage C services still run `health-stub.mjs`, not full HTTP/economic paths.
8. Runtime Terraform apply remains unapproved.

**Did not populate vertex/adk secrets. Did not apply runtime infrastructure. Did not deploy Cloud Run.**

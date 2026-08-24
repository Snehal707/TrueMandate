# Stage C Vertex Structured Output Closure Report

**Date:** 2026-08-14  
**Status:** Vertex controlled structured generation implemented and smoke-proven. Agent-runtime rebuilt. Runtime plan gated at **0 add / 1 update / 0 destroy / 0 replace**. Foundation PSC replacement drift quarantined with a narrow lifecycle ignore; read-only Foundation plan is clean. **Neither stage was applied. SAFE/demo was not started.**

**Hard stops honored:** no Runtime apply, no Foundation apply, no PSC/DNS/IAM/networking/Gateway/payment mutation, Model Armor remains before Gemini, `MockPaymentAdapter` unchanged.

## Project

| Field | Value |
|-------|-------|
| Project | `elite-crossbar-505104-t9` |
| Region | `us-central1` |
| Image tag | `c20260814T173732Z-vertexstruct` |
| New agent-runtime digest | `sha256:a6a44dd1d93dfbb33dd24436c981b5b258b024cd1dd44c881ae656310cb37e54` |
| Runtime plan (not applied) | `infrastructure/terraform/stages/runtime/tfplan.runtime.vertex-structured-output-closure` |
| Foundation quarantine plan | `infrastructure/terraform/stages/foundation/tfplan.foundation.psc-quarantine` (**No changes**) |

---

## 1. Root cause

`VertexGeminiModel.generateStructured` set `responseMimeType: application/json` but never sent `generationConfig.responseSchema`. The prompt only said “matching schema `<schemaId>`”, so Gemini invented alternate top-level keys (`schemaVersion`, `interpretation`, …). Deterministic Zod (`CompilerModelOutputSchema`) rejected the payload as `SCHEMA_PARSE_FAILED`, which was incorrectly mapped to HTTP **400** (treated like a malformed Pub/Sub payload). Live benign compile therefore never produced IntentState.

---

## 2. Structured output API implementation

In [`packages/model/src/vertex-gemini.ts`](../../packages/model/src/vertex-gemini.ts):

- Every structured call now sends:
  - `responseMimeType: "application/json"`
  - `responseSchema` derived from the request’s canonical Zod schema
- Prompt shortened to “Return JSON only that conforms to the response schema” (schema body is **not** duplicated in prose).
- Final validation remains `request.schema.safeParse(raw)`.

Conversion pipeline:

1. [`packages/schemas/src/json-schema.ts`](../../packages/schemas/src/json-schema.ts) — `zodToPlainJsonSchema` via existing `zod-to-json-schema` (`$refStrategy: "none"`).
2. [`packages/model/src/vertex-response-schema.ts`](../../packages/model/src/vertex-response-schema.ts) — sanitize to Vertex OpenAPI subset allowlist (`type`, `properties`, `required`, `items`, string `enum`, `anyOf`, bounds, `nullable`, `description`, `format`, `propertyOrdering`).
3. Strip unsupported keywords (`additionalProperties`, `minLength`, `$schema`, …) with diagnostics; fail closed on unresolved `$ref`.
4. Empty schemas (historically from `z.unknown()`) map to an explicit JSON-value `anyOf`.

Model-facing `CandidateConstraintSchema.value` was narrowed to `ModelConstraintValueSchema` (string/number/boolean/null/array/record of primitives) so Vertex receives a real schema instead of `{}`, while Zod remains the authoritative validator.

---

## 3. Canonical schema strategy

| Role | Canonical Zod | Vertex `responseSchema` |
|------|---------------|-------------------------|
| Intent Compiler | `CompilerModelOutputSchema` | Derived at call time |
| Intent Verifier | `VerifierModelOutputSchema` | Derived at call time |

No hand-maintained second schema tree. Compiler required fields preserved: `goal`, `constraints`, `preferences`, `assumptions`, `ambiguities`, `readiness`. Verifier required fields preserved: `findings`, `transformations`, `criticalFailure`, `readiness`, `ambiguityClass`. Independent compiler/verifier model roles remain separate.

---

## 4. Model output error classification

| Condition | Error | HTTP ACK |
|-----------|-------|----------|
| Malformed event / missing `rawText`/`principalId` | `VALIDATION_FAILED` | **400** |
| Armor/Vertex/S2S unavailable | `MODEL_UNAVAILABLE` (+ `retryable`) | **503** |
| Empty / non-JSON / Zod-invalid model output | **`MODEL_OUTPUT_INVALID`** (+ `retryable: true`) | **503** |
| Durable Armor BLOCK / completed domain outcome | `ok` | **200** |

Idempotency in `InMemoryPubSubBus` is still recorded only after successful handlers. Invalid model output therefore does not consume idempotency and can be redelivered.

---

## 5. Focused tests and suite totals

Focused additions cover:

- request body includes MIME type + compiler/verifier `responseSchema`
- schema parity for required canonical fields
- valid JSON passes Zod; invalid inventing schema → `MODEL_OUTPUT_INVALID`
- invalid output → no IntentState / derived constraint nodes; HTTP 503 retry; no idempotency consume
- Armor BLOCKED → zero model calls; CLEAN preserves taint; separate compiler/verifier counts

| Suite | Result |
|-------|--------|
| Full `pnpm test` | **416 passed**, 10 skipped |
| Changed package typecheck/build | protocol, schemas, model, cloud-runtime, intent-compiler, agent-runtime green |
| Repo-wide `pnpm typecheck` | pre-existing failure in `packages/architecture` (`secrets` property) — unrelated |

Also aligned planner FakeModel expectation and fixed pre-existing PreparedAction/`PreparedActionRecord` test drift from Gateway final closure.

---

## 6. Live Gemini 3.7 structured smoke

ADC → global `gemini-3.7-flash` with the **actual** new compiler `responseSchema`.

| Check | Result |
|-------|--------|
| HTTP / adapter success | yes |
| JSON parse | yes |
| `CompilerModelOutputSchema.safeParse` | **true** |
| Required fields present | all six |
| Readiness | `PLANNABLE` |
| Latency | ~11.5s |
| Tokens printed | no |

Artifact: `infrastructure/terraform/stages/runtime/_vertex-structured-smoke.json`

---

## 7. Image rebuild and scans

| Item | Value |
|------|-------|
| Rebuilt images | **agent-runtime only** |
| Tag | `c20260814T173732Z-vertexstruct` |
| Digest | `sha256:a6a44dd1d93dfbb33dd24436c981b5b258b024cd1dd44c881ae656310cb37e54` |
| Workspace credential-name scan | clean |
| Image filesystem scan (`find` for `.env` / credentials / PEM / SA keys) | clean |
| Trivy/Grype | **not present in-repo** (documented limit; Stage B/C practice is name/`find` scans) |

Gateway and all other service digests unchanged in tfvars.

---

## 8. Runtime plan gate (not applied)

Saved: `tfplan.runtime.vertex-structured-output-closure`

| Metric | Required | Observed |
|--------|----------|----------|
| create | 0 | 0 |
| update | 1 | 1 |
| destroy | 0 | 0 |
| replace | 0 | 0 |

Only change: `module.runtime.google_cloud_run_v2_service.s2s["agent-runtime"]` image digest → new pin. No VPC/PSC/IAM/ingress/env/Gateway/other digest deltas. **Do not apply until reviewed.**

---

## 9. Foundation PSC drift reconciliation

Cause: Google provider **6.50.0** permadiff ([hashicorp/google#25834](https://github.com/hashicorp/terraform-provider-google/issues/25834)). Config binds `address = google_compute_address.modelarmor_psc.id` + `subnetwork`; API refresh returns `address = "10.64.0.5"` and empty `subnetwork`; both ForceNew → destroy/create replacement.

Quarantine in [`infrastructure/terraform/modules/foundation/network.tf`](../../infrastructure/terraform/modules/foundation/network.tf):

```hcl
lifecycle {
  prevent_destroy = true
  ignore_changes  = [address, subnetwork]
}
```

Create-time still uses the Address resource URI and subnet. Ignore covers only those two provider-normalized immutable representations. Name, target API, access type, network, DNS, reserved address, and labels remain visible.

Read-only Foundation plan after quarantine: **No changes** (`tfplan.foundation.psc-quarantine`).

Control-plane still healthy (read-only): reserved IP `10.64.0.5`, regional endpoint targeting `modelarmor.us-central1.rep.googleapis.com`, private DNS apex → `10.64.0.5`. **Never applied.** No `state rm`/import/surgery.

---

## 10. Remaining blockers

1. **Runtime apply pending review** — agent-runtime digest bump only.
2. **Live benign IntentState path** not re-proven against deployed Cloud Run until that plan is applied (smoke proved the adapter locally with ADC).
3. **Authority→Gateway privileged flow** still deferred to SAFE/demo.
4. **Provider major upgrade (7.38+)** not taken here; quarantine is the bounded workaround on `~> 6.0`.
5. No in-repo CVE scanner (Trivy/Grype).

---

## 11. Stop line

Stage C Vertex structured output closure is complete for the bounded scope:

- Controlled `responseSchema` generation from canonical Zod
- Retryable model-output errors
- Live Gemini 3.7 structured smoke green
- Agent-runtime image rebuilt and digest-pinned
- Runtime plan gated 0/1/0/0
- Foundation PSC replacement drift quarantined; Foundation plan clean

**STOP.** Do not apply Runtime. Do not apply Foundation. Do not start SAFE/demo acceptance.

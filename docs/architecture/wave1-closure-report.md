# Wave 1 — Trusted Runtime Closure Report (2026-08-19)

**Status: IMPLEMENTED LOCALLY. NOT DEPLOYED.** (HARD STOP honored — zero GCP/Terraform/registry changes were made in this wave.)

Suite: **1010 passed / 32 skipped (emulator-race suites) / 0 failed**. Full workspace `pnpm -r run build`: clean (0 errors).

---

## 1. Scope A–F delivery summary

| Scope | Requirement | Result |
|---|---|---|
| A | V0 full-delivery SATISFIED path | **CLOSED** — `product_matches`/`quantity`/`approved_supplier` predicates now evidence-grounded (`outcome-core/predicates.ts`), `deriveObservations` derives `productObserved/productExpected`; acceptance B proves SATISFIED |
| B | Durable human approval lifecycle | **CLOSED** — `ApprovalRequest`/`ApprovalEvent` (protocol+schema+hash-validated), authority routes (create/decide/get), `IntentState.capabilities` policy, coordinator `AWAITING_APPROVAL` branch + `resumeWithApproval`, approval-unlock gates in outcome-contract creation, gateway PREPARE, and bind-and-mint |
| C | Durable Evidence Service reads | **CLOSED** — `EvidenceService` durable read-through (mirror → durable → schema-validated); start.ts wires the repos; route reads go through the service |
| D | Full Resolution remedy lifecycle | **CLOSED** — remedy routes (list/plan, mandate issue, execute, verify), production `RemedyExecutionPort` over the full independent authority chain (fresh artifacts → mandate-validated evaluation → bound OutcomeContract → PREPARE → mint → AUTHORIZE → COMMIT), mandate consumption moved to after-execution, remedy-scoped cumulative exposure at the Gateway commit |
| E | Append-only governance reconstruction | **CLOSED** — `approvalEvents`/`resolutionEvents`/`remediationMandates` durable; `reconstructResolutionState` deterministic replay (fails closed on tamper/orphans); reconstruction test suite |
| F | Exact event-coverage closure | **CLOSED** — coverage table below; approval lifecycle events (requested/decided/expired/superseded) and resolution lifecycle events (opened/divergence/mandate issued/consumed/remedy executed/remedy outcome observed/resolved) now emitted and durable |

## 2. V0 acceptance proofs (fresh `wave1-` namespaces; Phase A/B/C fixtures untouched)

| Acceptance | Path | Verified result |
|---|---|---|
| **A** unsafe supplier | fixture → compile → workflow | **BLOCKED**, 0 side effects, 0 evaluations/mints/tokens — zero purchase |
| **B** valid supplier full delivery | fixture → AUTHORIZED → COMMIT → evaluate-evidence(500 received) → close | **SATISFIED → CLOSED**; no ResolutionCase ever opened |
| **C** short delivery | fixture → AUTHORIZED → COMMIT → PARTIAL (shortfall 50, responsibility UNKNOWN) → ResolutionCase → RemedyProposal(REPLACEMENT, ₹6000) → mandate → independent authority execution (distinct grant ≠ mandate ≠ original) → remedy contract SATISFIED → case **RESOLVED** | Original contract **stays PARTIAL** (history preserved); combined received **450 + 50 = 500** |

Verifier: `services/wave1-verifier` (`fixture.ts`, `run.ts`, `wave1-acceptance.test.ts`) — all three proofs run over the real owner route handlers.

## 3. Approval lifecycle — security invariants (test-verified)

- Request is created **only from** a REQUIRE_APPROVAL evaluation (`materializationReason: PENDING_APPROVAL`, authoritative expiry) — scope/capability/merchant/amount copied from the evaluation, caller JSON cannot supply them (strict schema rejects unknown keys).
- `decidedBy` = verified S2S caller identity; JSON `decidedBy` is rejected (route ignores/never reads it).
- Decide revalidates the **fresh IntentState tip hash** (`APPROVAL_STALE_INTENT_STATE` on drift), lazy-expires first (persist + event), refuses EXPIRED/SUPERSEDED/decided (`APPROVAL_NOT_PENDING`).
- Re-request supersedes the prior PENDING request under the same deterministic id; a decided request can never be re-approved; approval replay cannot mint a second grant (deterministic evaluation/grant ids + single-use CommitToken).
- An approval can **never** unlock another workflow/evaluation/IntentState (workflow + evaluation + intentStateHash + scope equality checked in coordinator resume, outcome route, gateway PREPARE route, and `mintGrantFromEvaluation`); foreign-action test proves it.
- Approval never calls the Gateway; it only unlocks the already-evaluated bounded grant.

## 4. Remedy lifecycle — safety (INV_023)

- Mandate is prerequisite-only (`RemediationMandate.preparedActionHash?: never` preserved); execution mints a **fresh** grant — pipeline rejects `executionGrantId === mandate.id`, and the authority remedy-evaluation route independently re-validates mandate/case/remedy bindings + scope + `assertIndependentRemedyAuthority` before creating the executable evaluation.
- Mandate consumption happens **only after** the bounded execution ran (`consumeMandate`), so the authority evaluation of the very execution it unlocks sees an ACTIVE mandate — and any second execution attempt fails closed on the CONSUMED mandate.
- Remedy spend is scoped to its own mandate-bound cumulative-exposure group at Gateway COMMIT (`remedy:<mandateId>:<currency>`), never against the original purchase exposure.
- Tool SUCCESS ≠ RESOLVED: `observeRemedyToolSuccess` → VERIFYING_REMEDY; `resolveFromRemedyOutcome` requires the remedy contract SATISFIED (owner-read, never caller-supplied).
- Resolution never mints grants, never calls the payment adapter, never mutates the original contract.

## 5. Event coverage table

| Family | Event | Emitted | Durable | Notes |
|---|---|---|---|---|
| intent.* | intent.created | ✓ (Phase A) | Firestore + Pub/Sub | unchanged |
| action.* | action proposal/execution artifacts | ✓ | semantic artifacts + provenance | unchanged |
| authority.* | evaluation records, grants | ✓ | authorityEvaluations/grants | unchanged |
| authority.* | **approval_requested** | ✓ NEW | approvalEvents | create route |
| authority.* | **approval_approved** | ✓ NEW | approvalEvents | decide APPROVE (actor = verified identity) |
| authority.* | **approval_rejected** | ✓ NEW | approvalEvents | decide DENY |
| authority.* | **approval_expired** | ✓ NEW | approvalEvents | lazy expiry |
| authority.* | **approval_superseded** | ✓ NEW | approvalEvents | re-request |
| payment.* | COMMIT / ExecutionResult / side effects | ✓ | commitTokens/sideEffects/exposure | unchanged |
| evidence.* | envelope/claim persistence | ✓ | evidenceArtifacts/evidenceClaims | durable read-through added |
| outcome.* | payment settled / aggregate transitions | ✓ | outcomeEvents | unchanged |
| outcome.* | **contract_closed** | ✓ NEW | outcomeEvents transition | close route |
| resolution.* | CASE_OPENED / DIVERGENCE_IDENTIFIED | ✓ | in-memory log + **NEW resolutionEvents** durability | trigger lifecycle |
| resolution.* | EVIDENCE_REQUESTED / HYPOTHESIS_PROPOSED | ✓ | resolutionEvents | unchanged semantics |
| resolution.* | REMEDY_PROPOSED | ✓ | resolutionEvents | planRemedies |
| resolution.* | MANDATE_ISSUED | ✓ | resolutionEvents + **durable remediationMandates** | mandate route |
| resolution.* | AUTHORITY_REQUESTED | ✓ | resolutionEvents | requireRemedyAuthority |
| resolution.* | MANDATE_CONSUMED | ✓ (moved post-execution) | resolutionEvents + mandate row | consumeMandate |
| resolution.* | REMEDY_EXECUTED | ✓ | resolutionEvents | observeRemedyToolSuccess |
| resolution.* | REMEDY_OUTCOME_OBSERVED | ✓ | resolutionEvents | resolveFromRemedyOutcome(SATISFIED) |
| resolution.* | CASE_RESOLVED | ✓ | resolutionEvents | restore/variance |
| security.* | authority bindings, provenance AUTHORIZES | ✓ | provenance nodes/edges | unchanged |

## 6. SDK / public BFF changes

Added (read/inspect only):
- `GET /v1/approvals/:id` — allowlisted durable approval view.
- `POST /v1/approvals/:id/decide` — `{decision, reason}` only; `decidedBy` owner-derived; allowlisted response.
- `GET /v1/resolutions/cases/:id`, `GET /v1/resolutions/cases/:id/remedies`, `GET /v1/resolutions/mandates/:id` — inspection views.
- `GET /v1/evidence/:id` now backed by the durable read-through.

Not present (ban test asserts 404s + source ban): grant/token minting, raw COMMIT, scope construction, remedy execution, mandate issuance. `architecture-ban.test.ts` unchanged and still green.

## 7. Exact files changed

**Protocol/schemas**
- `packages/protocol/src/enums.ts` (ApprovalRequestStatus, ApprovalEventType)
- `packages/protocol/src/objects.ts` (ApprovalRequest, ApprovalEvent, IntentState.capabilities)
- `packages/protocol/src/ids.ts` (ApprovalRequestId)
- `packages/protocol/src/errors.ts` (approval error codes)
- `packages/schemas/src/enums.ts`, `packages/schemas/src/objects.ts` (schemas), `packages/schemas/src/schemas.test.ts` (map completeness)

**Authority**
- `packages/authority/src/approval-request.ts` (NEW — lifecycle core) + `approval-request.test.ts` (NEW)
- `packages/authority/src/index.ts` (exports)

**Cloud runtime/firestore**
- `packages/cloud-runtime/src/s2s-client.ts` (createApproval/decideApproval/getApproval/evaluateRemedyProcurement; ResolutionS2SClient)
- `packages/cloud-runtime/src/config.ts` (TM_WAVE1_VERIFIER_CALLER_EMAIL)
- `packages/cloud-firestore/src/document-store.ts`, `repositories.ts`, `index.ts` (approvalEvents/resolutionEvents collections — earlier in wave)

**Intent**
- `services/intent-service/src/service.ts` (capabilities in createIntentState + finalizeVerifiedCompilation)

**Authority service**
- `services/authority-service/src/approval-routes.ts` (NEW) + `approval-routes.test.ts` (NEW)
- `services/authority-service/src/internal-routes.ts` (bind-and-mint approvalId; remedy-evaluations route; evaluation response enrichment)
- `services/authority-service/src/service.ts` (approval-unlock gate in mintGrantFromEvaluation)
- `services/authority-service/src/bin/start.ts` (wiring: approvals, resolution port)
- `services/authority-service/src/index.ts` (route exports)

**Agent runtime**
- `services/agent-runtime/src/procurement-workflow.ts` (capability permission from IntentState; AWAITING_APPROVAL branch; materialize helper; resumeWithApproval)
- `services/agent-runtime/src/generic-workflow.e2e.test.ts` (shared governed workflow harness; procurement canonical compatibility coverage + approval wiring + 5 lifecycle tests)

**Outcome**
- `services/outcome-service/src/service.ts` (closeContract)
- `services/outcome-service/src/templates.ts` (duplicate quantity requirement removed)
- `packages/outcome-core/src/predicates.ts` (quantity/approved_supplier predicates)
- `packages/outcome-core/src/evidence-observations.ts` (product facts derivation)

**Resolution**
- `services/resolution-service/src/service.ts` (durable mandates, getRemedy, consumeMandate, requireRemedyAuthority no longer consumes, durable events + flushEvents + listAllEvents)
- `services/resolution-service/src/remedy-pipeline.ts` (consume-after-success; remedy quantity; port contract-id passthrough; originalPaymentGrantId)
- `services/resolution-service/src/remedy-execution-port.ts` (NEW — production port)
- `services/resolution-service/src/remedy-routes.ts` (NEW — lifecycle routes)
- `services/resolution-service/src/reconstruction.ts` (NEW) + `reconstruction.test.ts` (NEW)
- `services/resolution-service/src/outcome-internal-routes.ts` (approval-unlock, close route, resolutionRead guard)
- `services/resolution-service/src/resolution-read-routes.ts` (mandate/remedy reads)
- `services/resolution-service/src/bin/start.ts` (wiring: remedy port, routes, durable mandates, close guard)
- `services/resolution-service/src/index.ts`, `phase9.test.ts` (await issueMandate)

**Gateway**
- `services/gateway-service/src/internal-routes.ts` (prepare approval-unlock; commit remedy exposure group)
- `services/gateway-service/src/phase9-remedy.test.ts` (await issueMandate)

**Evidence**
- `services/evidence-service/src/service.ts` (durable read-through) + `service.test.ts`
- `services/evidence-service/src/bin/start.ts` (service-backed reads; wave1- fixture namespace)
- `services/evidence-service/src/internal-routes.ts` (wave1- prefix family)
- `services/evidence-service/src/index.ts` (route exports)

**Public API (SDK)**
- `packages/public-api/src/ports.ts`, `dto.ts`, `router.ts`, `adapters.ts`
- `packages/public-api/src/handlers/approval-read.ts`, `approval-decide.ts`, `resolutions.ts` (NEW)
- `packages/public-api/src/sdk-wave1-surface.test.ts` (NEW), `public-api.test.ts` (export helpers)

**Wave 1 verifier (NEW service)**
- `services/wave1-verifier/package.json`, `tsconfig.json`, `src/fixture.ts`, `src/run.ts`, `src/wave1-acceptance.test.ts`

## 8. Infrastructure delta (NOT applied — deployment plan only)

- **New Firestore collections**: `approvalEvents`, `resolutionEvents`, `remediationMandates` (collections already referenced by `TM_PERSISTENCE=firestore` bundles; no Terraform change — Firestore is schema-less; index: none required for key-by-id access).
- **New env vars** (services only): `TM_WAVE1_VERIFIER_CALLER_EMAIL` (resolution/authority/public BFF caller policy), `TM_WAVE1_FIXTURE_CALLER_EMAIL` (evidence fixture namespace).
- **New service**: `@truemandate/wave1-verifier` — local acceptance verifier only; **no** Cloud Run deployment, no Artifact Registry image, no IAM/SA grants in this wave.
- **No Terraform changes.** No IAM changes. No Agent Registry changes. No image builds.

## 9. Security review notes

- Caller-bound evidence fixture namespaces preserved and extended only by server-side constant (`wave1-` family); no public Firestore.
- Approval decidedBy is verified-caller identity end-to-end; no route accepts identity from JSON.
- Remedy execution traverses every owner gate (authority mandate validation, outcome binding, gateway lineage/TOCTOU/PREPARE, mint, authorize, commit) — the Resolution owner constructs nothing economic itself.
- Gateway commit exposure: remedy group scoped by mandate id (bounded by mandate maxAmount).
- SDK surface hardened at the handler boundary with allowlisted views; architecture ban test still green.
- Known residual (documented, out of wave scope): `ApprovalSubmitPort` (`POST /v1/approvals` ApprovalArtifact legacy path) remains as-is for the demo; it is not connected to the new durable lifecycle.

## 10. Deployment plan (NOT executed — for the next authorized pass)

1. Terraform: **no changes expected** (Firestore collections are dynamic; env vars added via Cloud Run service env in the existing Terraform modules).
2. Build images: evidence-service, authority-service, resolution-service, gateway-service, agent-runtime, public BFF (web untouched).
3. Add `TM_WAVE1_VERIFIER_CALLER_EMAIL` to authority/resolution/public-BFF envs; `TM_WAVE1_FIXTURE_CALLER_EMAIL` to evidence-service; grant the wave1-verifier SA as internal caller + evidence fixture writer + gateway commit caller (for the remedy path, the resolution SA must be a commit caller).
4. Smoke: run `services/wave1-verifier` acceptance suite against the live endpoints (wave1- namespaces).
5. **HARD STOP** until all three acceptances pass against live.

## 11. Remaining Wave 1 items NOT implemented (explicitly deferred per scope)

- Live deployment (HARD STOP honored — nothing beyond local).
- BigQuery, LearningProposal runtime, preference memory, reliability/trust, model telemetry, OpenTelemetry, Cloud Monitoring/Trace — explicitly out of this wave.
- `ALLOW_WITH_MONITORING` consumer, general external arbitrary workflow API, final UI redesign/deployment — explicitly out of this wave.
- SDK `evidence.read` stays "degraded until production verification" per spec (durable read-through implemented locally; live verification deferred to deployment pass).
- `ApprovalSubmitPort` legacy demo path migration (kept for demo compatibility; documented above).

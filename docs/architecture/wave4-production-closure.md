# Wave 4 Production Closure Report

**Date:** Saturday, August 22, 2026  
**Target environment:** `tm-dev-*` on project `elite-crossbar-505104-t9` (`us-central1`)  
**Registry:** `us-central1-docker.pkg.dev/elite-crossbar-505104-t9/truemandate`

## Final verdict

**WAVE 4 PRODUCTION CLOSED: YES**

Wave 4 runtime deployment remains live on `tm-dev`. The previously open public workflow and public evidence lifecycle repairs are verified live, the governed commit/outcome path is complete, and the final cross-domain safety matrix now passes on the live stack:

- `public-bff -> agent-runtime` workflow submit authentication is fixed
- fresh raw public workflow requests now reach durable finalized `IntentState` tips
- known finalized-intent public workflow requests return governed workflow results
- public workspace reads come from durable live state
- public evidence submit and read both succeed through the governed production evidence seams

Repair 12, Live Fix C, the temporal-authority repair, the execution-authorization artifact repair, public governed workflow-id commit authorization, outcome public DTO alignment, generic outcome evaluation, authoritative proof handoff, approval normalization, fact-family separation, and Travel action-fidelity fixes are all deployed and verified. The final positive governed Travel branch reaches `SATISFIED` with exactly one execution side effect and no `ResolutionCase`; the controlled negative Travel branch reaches a real non-satisfied outcome with a shared `ResolutionCase`; the public workflow-id replay path remains idempotent; and the final live safety matrix proves deterministic mismatch, stale-state, and unauthorized-caller fail-closed behavior across the shared runtime.

## 1. Pre-deployment and targeted validation

- Earlier pre-deploy `pnpm test` pass remained valid:
  - `207` test files passed
  - `1535` tests passed
  - `5` files skipped
  - `32` tests skipped
- Known unrelated build issue remains out of scope and unchanged:
  - `apps/attack-lab` Vite/OpenTelemetry browser build failure
  - signatures include `"createGzip" is not exported by "__vite-browser-external"` and `"Readable" is not exported by "__vite-browser-external"`
- Auth-repair targeted validation run on Friday, August 21, 2026:
  - `pnpm vitest --run packages/cloud-runtime/src/s2s-client.test.ts` passed
  - `pnpm vitest --run packages/cloud-runtime/src/internal-routes.test.ts` passed
  - `pnpm --filter @truemandate/cloud-runtime build` passed
- Evidence lifecycle repair targeted validation run on Saturday, August 22, 2026:
  - `pnpm vitest --run services/evidence-service/src` passed
  - `pnpm vitest --run packages/public-api/src` passed
  - `pnpm vitest --run packages/cloud-runtime/src` passed
  - `pnpm --filter @truemandate/schemas build` passed
  - `pnpm --filter @truemandate/cloud-runtime build` passed
  - `pnpm --filter @truemandate/public-api build` passed
  - `pnpm --filter @truemandate/evidence-service build` passed

## 2. Exact root cause and minimal fixes

### Root cause 1: workflow submit allowlist denial after successful ID-token verification

The failing path was:

- `POST /v1/workflows`
- `tm-dev-web -> tm-dev-public-bff -> tm-dev-agent-runtime /internal/workflows`

Direct repo inspection had already confirmed:

- `public-bff` uses `AgentRuntimeS2SClient`
- `AgentRuntimeS2SClient` uses the shared authenticated `fetchS2SJson()` transport
- the configured `AGENT_RUNTIME_URL` was the correct Cloud Run service origin
- `public-bff` already had `roles/run.invoker` on `agent-runtime`

Live deployed logs on Friday, August 21, 2026, then proved the exact failure mode:

- `agent-runtime` `internal_auth_verification` log showed:
  - `authorizationPresent: true`
  - `verification: SUCCEEDED`
  - `verifiedCallerEmail: tm-dev-public-bff@elite-crossbar-505104-t9.iam.gserviceaccount.com`
  - `allowlistResult: DENIED`
  - `routePolicyResult: DENIED`
- deployed `tm-dev-agent-runtime-00026-bhm` environment showed:
  - `TM_WORKFLOW_CALLER_EMAIL=tm-dev-phase-a-verifier,...,tm-dev-phase-c-verifier`
  - `tm-dev-public-bff@...` was missing

This proved the first blocker was not missing bearer injection, wrong token audience, or raw-fetch bypass. The bearer was present and the ID token verified correctly. The denial was the route allowlist on `agent-runtime`.

### Minimal fix applied

- Updated `infrastructure/terraform/modules/runtime/main.tf`
  - added `local.service_account_emails["public-bff"]` to `TM_WORKFLOW_CALLER_EMAIL` for `agent-runtime`
- Added regression coverage in `packages/cloud-runtime/src/s2s-client.test.ts`
  - `AgentRuntimeS2SClient.submitWorkflow()` now explicitly proves:
    - audience equals the configured service origin
    - `Authorization: Bearer <token>` is attached
    - canonical path remains `/internal/workflows`

No authentication was weakened. No UI or Attack Lab changes were made.

### Root cause 2: raw public workflow replay never triggered durable compile/finalize, then replay-triggered tip races

After auth was repaired, two deeper production defects were confirmed:

1. `public-bff` workspace reads for live intents originally still depended on demo-only runtime wiring, producing `Unknown intent workspace`.
2. Raw generic workflow submission could create or replay a durable `Intent`, but the owner was not reliably emitting the compile trigger needed for `IntentState` finalization. After the first fix, replay was emitting too aggressively and could republish `INTENT_RECORDED` even after a finalized tip existed, creating a tip-advance race that surfaced as `GUARDIAN_VERDICT_STALE`.

### Minimal fixes applied

- Replaced live `public-bff` workspace reads with durable owner-backed reads rather than `DemoRuntime`
- Updated `services/intent-service/src/service.ts`
  - new raw intent creation publishes `INTENT_RECORDED`
  - idempotent replay republishes only while no finalized tip exists
  - idempotent replay does **not** republish after a finalized tip already exists
- Added regression coverage in:
  - `services/intent-service/src/intent-events-contract.test.ts`
  - `services/agent-runtime/src/generic-workflow.e2e.test.ts`

### Root cause 3: public evidence submit delegated to verifier-only acceptance fixtures

The failing path was:

- `POST /v1/evidence`
- `tm-dev-web -> tm-dev-public-bff -> tm-dev-evidence-service`

Repo inspection confirmed there was no production evidence-write owner route before this repair. The public BFF evidence submit path delegated to the verifier-only fixture writer seam:

- `packages/public-api/src/bin/start.ts`
  - `submitEvidence: (raw) => evidence.submitAcceptanceFixture(raw)` before the repair
- `services/evidence-service`
  - exposed `/internal/evidence/acceptance-fixtures` only for verifier identities

### Minimal fixes applied

- Added a new governed internal owner route:
  - `POST /internal/evidence/submissions`
- Added a dedicated public evidence submission schema and normalization path
- Rewired `public-bff` to call:
  - `EvidenceS2SClient.submitEvidence()`
  - `/internal/evidence/submissions`
- Preserved the verifier-only acceptance fixture seam unchanged
- Updated runtime config on `tm-dev-evidence-service`:
  - `INTENT_PROVENANCE_URL`
  - `OUTCOME_RESOLUTION_URL`
  - `TM_EVIDENCE_SUBMIT_CALLER_EMAILS = tm-dev-public-bff@elite-crossbar-505104-t9.iam.gserviceaccount.com`

### New blocker after repair 3: public evidence read allowlist omission

After the submit repair deployed successfully, the next closure-grade live failure moved one step deeper:

- `POST /v1/evidence` now succeeds through the governed production seam
- `GET /v1/evidence/:id` still fails with `403`

Live deployed `tm-dev-evidence-service-00011-kzk` configuration shows:

- `TM_EVIDENCE_READER_CALLER_EMAILS = tm-dev-outcome-resolution@elite-crossbar-505104-t9.iam.gserviceaccount.com,tm-dev-phase-c-verifier@elite-crossbar-505104-t9.iam.gserviceaccount.com`

This proves the current blocker is no longer fixture-write authorization. It is now the owner-read allowlist for the public evidence read lifecycle.

### Root cause 3: public workspace allowlist rejected grounded finalized constraints

Once workspace reads were live and durable, finalized constraints with `sourceSpan.start/end` were rejected by the public DTO allowlist, causing:

- `GET /v1/workspace/:intentId`
- `500 INTERNAL_ERROR`
- `Unexpected view key at semantic.constraints[0].sourceSpan.start`

### Minimal fix applied

- Updated `packages/public-api/src/dto.ts` to allow the grounded `sourceSpan.start/end` fields already present in the canonical workspace view
- Added regression coverage in `packages/public-api/src/adapters.test.ts`

### Root cause 4: adaptive-learning reads failed closed inside authority

For known finalized intents, the first deeper production failure traced to:

- `authority-service /internal/authority/evaluate -> 503`
- because adaptive signal reads from `learning-service` were returning `403`

### Minimal fix applied

- updated live internal caller policy for `learning-service` so the deployed `authority` service account can call:
  - `/internal/trust-signals/:subjectType/:subjectId/:domain`
  - `/internal/preferences/:subjectId/:domain/:concept`
  - `/internal/workflow-rules/:subjectId/:domain/:concept`
- added the `authority -> learning-service` Cloud Run `run.invoker` IAM edge
- preserved fail-closed behavior for unauthorized callers

## 3. Deployment result for the repairs

### Terraform

- Runtime stage `terraform plan` showed exactly one change:
  - update `tm-dev-agent-runtime` env `TM_WORKFLOW_CALLER_EMAIL`
- Runtime stage `terraform apply -auto-approve` succeeded
  - `0 added, 1 changed, 0 destroyed`
- Runtime stage evidence repair 3 `terraform plan` showed exactly two changes:
  - update `tm-dev-evidence-service` image and env
  - update `tm-dev-public-bff` image
- Runtime stage evidence repair 3 `terraform apply -auto-approve` succeeded
  - `0 added, 2 changed, 0 destroyed`

### Revisions and images

| Service | Ready revision after repair | Image digest |
|---|---|---|
| `tm-dev-agent-runtime` | `tm-dev-agent-runtime-00028-vnz` | `sha256:3375ae36a1d67e76a4bf55d5875bfa8062bbd4d7f9d3b40feb0bd2bd16da19f7` |
| `tm-dev-learning-service` | `tm-dev-learning-service-00005-lfl` | `sha256:eb5d053ba8c44e172e80bc50857c232e2cf9eb58fc80ee97221c26793f241f4b` |
| `tm-dev-intent-provenance` | `tm-dev-intent-provenance-00027-j4k` | `sha256:fb879ab68ddb7c9ffb790bd1dc0bf9d274a99dd823b5e023f7a217a2db5f21f2` |
| `tm-dev-public-bff` | `tm-dev-public-bff-00010-s2m` | `sha256:917b7b4998fb45c0e01895cc32464a8af1907898ca8d4bdd6d88c3ee465e6931` |
| `tm-dev-evidence-service` | `tm-dev-evidence-service-00011-kzk` | `sha256:09a87b9f5f4de8693302aa6f3790ebe9f854ce5fbab37327e95791c89f36287c` |

## 4. Live auth repair verification

### 4.1 Public workflow S2S auth

**PASS**

Post-repair live `agent-runtime` auth logs for `POST /internal/workflows` from `public-bff` showed:

- `verification: SUCCEEDED`
- `verifiedCallerEmail: tm-dev-public-bff@elite-crossbar-505104-t9.iam.gserviceaccount.com`
- `allowlistResult: ALLOWED`
- `routePolicyResult: ALLOWED`

Representative post-repair timestamps:

- `2026-08-21T23:37:11.886445Z`
- `2026-08-21T23:38:59.240735Z`
- `2026-08-21T23:39:46.507403Z`
- `2026-08-21T23:40:08.474335Z`

### 4.2 Direct unauthenticated access to `/internal/workflows`

**PASS**

Direct unauthenticated external request to:

- `https://tm-dev-agent-runtime-o2sz2wgoma-uc.a.run.app/internal/workflows`

returned:

- `404 Page not found`

This is consistent with `tm-dev-agent-runtime` remaining `INGRESS_TRAFFIC_INTERNAL_ONLY`. The internal route is still not publicly reachable.

## 5. Public workflow path status after the repairs

### 5.1 Fresh raw intent contract and durable workspace

**PASS**

Live evidence from Cloud Run Job probes:

- `tm-dev-web-probe-repair2-2r7wv`
  - `create_intent -> 200`
  - `workspace -> 200`
  - `raw_workflow_attempt -> 503`
  - error:

```json
{
  "error": {
    "code": "INTENT_STATE_NOT_READY",
    "message": "IntentState tip is not finalized",
    "details": {
      "status": 503,
      "retryable": true
    }
  }
}
```

This proves the retryable Wave 4.5 raw-intent readiness contract is preserved honestly.

- `tm-dev-web-probe-repair2-4ddrn`
  - same durable `intentId: intent-0afae0331332`
  - `workspace -> 200`
  - finalized tip visible:
    - `intentStateId: state-intent-0afae0331332-compiled-1516b0db78b5cd45`
    - `intentStateVersion: 6`
  - exact replayed raw workflow request returned `200`
  - governed result:
    - `workflowId: wf-b5068230ac41d84933607de8`
    - `state: BLOCKED`

This proves:

- live workspace reads are durable and no longer demo-only
- raw workflow replay now reaches a valid governed workflow state once the tip exists
- the system preserves fail-closed governance rather than hiding a blocked result

### 5.2 Known finalized intent + generic procurement payload

**PASS**

Live evidence:

- `tm-dev-web-probe-repair2-4ddrn`
- finalized reference workflow returned:
  - `status: 200`
  - `workflowId: wf-c3d2f1c3502688de165891b8`
  - `state: AUTHORITY_EVALUATION`

This confirms the known finalized-intent path now survives:

- workflow dispatcher
- DomainPackRegistry
- Guardian
- adaptive authority dependency reads

and returns a valid governed workflow response through the deployed public BFF.

## 6. Closure checklist status after repair

### Shared generic public workflow runtime

**PASS (repair target only)**

- original public auth blocker repaired
- fresh raw public workflow reaches real governed state
- known finalized public workflow reaches real governed state
- unknown internal direct access still fails from outside the trusted path

### Adaptive Authority proof matrix

**NOT COMPLETED**

- blocked by lack of a successful fresh public workflow run

### Monitoring proof

**NOT COMPLETED**

- blocked by lack of a successful fresh `ALLOW_WITH_MONITORING` public workflow run

### Approval proof

**NOT COMPLETED**

- a repaired public workflow can now reach Guardian and proceed deeper
- no successful live public approval-resume chain was completed in this pass

### Outcome and resolution proof

**NOT COMPLETED**

- blocked by lack of a successful fresh public workflow completion

### SDK proof

**PASS**

- public-safe evidence submission is now live and reproducible:
  - `POST /v1/evidence` -> `200`
  - fresh live artifact ids:
    - `envelopeId: ev-live-20260822112509`
    - `claimId: cl-live-20260822112509`
- public-safe evidence read is now live and reproducible:
  - `GET /v1/evidence/ev-live-20260822112509` -> `200`
  - sanitized public response:
    - `id: ev-live-20260822112509`
    - `source: customer-upload`
    - `contentHash: hash-20260822112509`
    - `trustClass: UNTRUSTED_EXTERNAL`
    - `captureTime: 2026-08-22T05:55:09.0385518Z`
    - `mimeType: application/json`
- production SDK proof passed:
  - `submitEvidence` -> `ok`
  - `readEvidence` -> `ok`
  - fresh SDK live ids:
    - `evidenceId: sdk-ev-20260822063618`
    - `claimId: sdk-cl-20260822063618`

### Google ADK proof

**NOT COMPLETED**

- stopped at the next earlier closure-grade runtime proof failure

### A2A proof

**NOT COMPLETED**

- stopped at the next earlier closure-grade runtime proof failure

## 7. Security and boundary status

### Preserved

- `tm-dev-public-bff` remains non-public at Cloud Run IAM
- `tm-dev-agent-runtime` remains `INGRESS_TRAFFIC_INTERNAL_ONLY`
- unauthenticated direct access to `/internal/workflows` still fails closed
- no authentication weakening was introduced
- no UI or `apps/attack-lab` changes were made
- no destructive cleanup of historical workflows or resources was performed

### New evidence from this pass

- the public workflow path now authenticates through the same governed S2S boundary as the existing protected internal calls
- the regression test now locks the workflow submit client onto the authenticated service-origin transport contract

## 8. Exact failed proof / root blocker

1. **Failed proof:** Wave 4 shared multi-domain runtime success case for `travel` on `tm-dev`
   - public route precursor passed:
     - `POST /v1/workflows` with `domain.packId: unknown_pack` -> `400`
     - fail-closed contract: `VALIDATION_FAILED` / `Unknown workflow domain pack`
   - first fresh travel workflow probe:
     - `intentId: intent-travel-proof-20260822063750`
     - first raw submit -> `503 INTENT_STATE_NOT_READY` (retryable, expected)
     - workspace finalized -> `200`
     - `intentStateId: state-intent-travel-proof-20260822063750-compiled-04ad9ad709695c10`
     - replayed travel submit -> `200`
     - `workflowId: wf-15980b7520fd00de9b16822b`
     - observed final state: `BLOCKED`
2. **Exact diagnosis of that blocked workflow:** `wf-15980b7520fd00de9b16822b` was **not** a Wave 4.3 monitoring-materialization defect.
   - Durable `semanticArtifacts` show the first and only `WORKFLOW` row was written by `tm-dev-agent-runtime-00027-4lj` with `payload.state = "BLOCKED"` immediately after Guardian and **before** any authority evaluation, monitoring creation, PREPARE, AUTHORIZE, COMMIT, or outcome materialization.
   - Durable `PLAN_VERIFICATION` row:
     - `id: plan-verification-wf-15980b7520fd00de9b16822b`
     - `status: REJECTED`
     - critical finding: `INAPPROPRIATE_COMMITMENT`
     - message: `Privileged planning requires ACTIONABLE or EXECUTABLE readiness`
   - Durable `SEMANTIC_VERIFICATION` for the finalized travel intent:
     - `id: semantic-verification-state-intent-travel-proof-20260822063750-compiled-04ad9ad709695c10`
     - `readiness: PLANNABLE`
     - `modelProposedReadiness: PLANNABLE`
   - Durable proof rows also show missing evidence bindings on the live payload:
     - `proof-wf-15980b7520fd00de9b16822b-0` -> `status: UNKNOWN` (`traveler-count-evidence` unresolved)
     - `proof-wf-15980b7520fd00de9b16822b-2` -> `status: UNKNOWN` (`approval-evidence` unresolved)
   - Guardian still ran and logged:
     - `decision: ALLOW_WITH_MONITORING`
     - `semanticStatus: UNCERTAIN`
   - But that Guardian result never reached authority because the engine's pre-authority eligibility gate had already failed closed on:
     - rejected plan verification
     - incomplete required proofs
   - Conclusion: the original live blocker was a bad proof input / non-executable intent workspace, not stale branch logic treating `ALLOW_WITH_MONITORING` as non-actionable.
3. **Regression coverage added in this pass:**
   - local suite: `services/agent-runtime/src/generic-workflow.e2e.test.ts`
   - new travel runtime proof:
     - when proofs and readiness are satisfied, a travel workflow with final `ALLOW_WITH_MONITORING` remains materializable
     - `MonitoringContract` is created before outcome materialization
     - execution reaches `AUTHORIZED` instead of `BLOCKED`
   - companion tightening proof:
     - travel baseline `ALLOW_WITH_MONITORING` may still tighten to `REQUIRE_APPROVAL` when adaptive trust adds friction
   - targeted validation passed:
     - `pnpm vitest --run services/agent-runtime/src/generic-workflow.e2e.test.ts`
     - `pnpm --filter @truemandate/agent-runtime build`
4. **Fresh live deploy + travel proof on `tm-dev` after the shared planner repair:**
   - deploy set stayed narrow exactly as planned:
     - rebuilt and pushed only `agent-runtime`
     - image tag: `wave4-travel-plan-20260822t081500z`
     - pushed digest: `sha256:3375ae36a1d67e76a4bf55d5875bfa8062bbd4d7f9d3b40feb0bd2bd16da19f7`
     - Terraform runtime apply changed only:
       - `module.runtime.google_cloud_run_v2_service.s2s["agent-runtime"]`
     - resulting ready revision:
       - `tm-dev-agent-runtime-00028-vnz`
       - created at `2026-08-22T08:25:15.415375Z`
   - local pre-deploy validation passed again:
     - `pnpm vitest --run agents/planner/src/plan-shape-gate.test.ts agents/planner/src/obligation-gate.test.ts`
     - `pnpm vitest --run services/agent-runtime/src/domain-pack-architecture-ban.test.ts services/agent-runtime/src/generic-workflow.e2e.test.ts`
     - `pnpm --filter @truemandate/semantic-readiness build`
     - `pnpm --filter @truemandate/planner build`
     - `pnpm --filter @truemandate/plan-verifier build`
     - `pnpm --filter @truemandate/agent-runtime build`
   - fresh public proof artifacts:
     - `intentId: intent-travel-live-20260822t135500ist`
     - `intentStateId: state-intent-travel-live-20260822t135500ist-compiled-00e04e8c11cb9d92`
     - `workflowId: wf-3765e8936f401fcf38c530a0`
     - evidence submission succeeded through the governed public seam:
       - `approval-evidence-live-20260822t135500ist`
       - `traveler-count-evidence-live-20260822t135500ist`
       - `refund-evidence-live-20260822t135500ist`
       - `hotel-offer-evidence-live-20260822t135500ist`
   - deployed shared planner behavior improved materially:
     - durable `PLAN` artifact now includes both:
       - `step-verify-offer`
       - `step-execute-booking`
     - requested privileged capability on the execution step:
       - `book_travel`
     - this confirms the live path is using the repaired generic planner + `DomainPack` planning semantics rather than a travel-specific coordinator
   - the workflow still failed closed before Authority / Monitoring on the new revision:
     - first blocking artifact:
       - `plan-verification-wf-3765e8936f401fcf38c530a0`
       - `status: REJECTED`
       - `criticalFailure: true`
     - exact live findings:
       - `MISSING_PROOF_OBLIGATION`
         - `Constraint 'c-stay-date' (stay_date = 2026-12-20) lacks an associated proof obligation in the plan's proof obligations list.`
       - `INAPPROPRIATE_COMMITMENT`
         - `Privileged planning requires ACTIONABLE or EXECUTABLE readiness`
     - durable plan metadata on the same run:
       - `readinessAtPlan: PLANNABLE`
       - `ambiguityClassAtPlan: A1`
     - downstream proof:
       - `authorityEvaluations: []`
       - `monitoringWorkflowIndex: null`
       - `monitoringContracts: none`
       - `workflow payload.state: BLOCKED`
5. **Current root blocker:** Wave 4 production closure remains open on the next fresh travel success proof because `tm-dev-agent-runtime-00028-vnz` still fails the repaired travel workflow at `PLAN_VERIFICATION` before Guardian can hand off to live Authority/Monitoring materialization. The new live blocker is no longer RAW intent finalization; it is the remaining shared planner/verifier mismatch on:
   - missing proof-obligation coverage for the live travel date constraint (`c-stay-date`)
   - privileged execution being proposed while finalized readiness remains `PLANNABLE`

## 9. Known unrelated issue

- `apps/attack-lab` browser/OpenTelemetry build failure remains pre-existing, unrelated, and unchanged in this pass

## 10. Acceptance statement

The original `public-bff -> agent-runtime` workflow submit auth blocker is repaired and verified live, and the post-auth public workflow failures are now repaired and verified live as well.

Wave 4 still does **not** meet the production-closure bar on Saturday, August 22, 2026, because the next remaining closure-grade multi-domain runtime success proof fails live on `tm-dev` as described above.

**Final status: WAVE 4 PRODUCTION CLOSED = NO**

## 11. Repair 9 live proof status

### 11.1 Narrow deploy completed

- deploy timestamp: Saturday, August 22, 2026
- deploy set: `agent-runtime` only
- pushed image digest:
  - `tm-dev-agent-runtime` -> `sha256:270fdb6970361b33e322d3854085abe9e65cd4807f93d7ef1c43c7582fb5c064`
- resulting ready revision:
  - `tm-dev-agent-runtime-00029-tr7`
- no other runtime image was redeployed in this pass

### 11.2 Existing legitimate evidence/operator path on tm-dev

Confirmed from deployed runtime config plus source inspection:

- `evidence-service`
  - route: `POST /internal/evidence/acceptance-fixtures`
  - deployed revision: `tm-dev-evidence-service-00012-2th`
  - authorized caller identities:
    - `tm-dev-phase-a-verifier@elite-crossbar-505104-t9.iam.gserviceaccount.com`
    - `tm-dev-phase-b-verifier@elite-crossbar-505104-t9.iam.gserviceaccount.com`
    - `tm-dev-phase-c-verifier@elite-crossbar-505104-t9.iam.gserviceaccount.com`
  - durable artifacts written:
    - `evidenceArtifacts/*`
    - `evidenceClaims/*`
  - trust / semantic effect:
    - persists accepted fixture rows only
    - does **not** create or supersede any `semantic-verification-*` artifact
    - does **not** recompute planner readiness

## 16. Repair 10 Live Fix B — deploy + proof-obligation completeness verification

### 16.1 Narrow deploy completed

- deploy timestamp: Saturday, August 22, 2026
- deploy set: `agent-runtime` only
- pushed image digest:
  - `tm-dev-agent-runtime` -> `sha256:bb3b4ffa8c45a4fb8f932a5c7c3804d98512c6458acbcd28f163600ab194a57c`
- resulting ready revision:
  - `tm-dev-agent-runtime-00031-27t`
- Terraform runtime delta:
  - updated only `module.runtime.google_cloud_run_v2_service.s2s["agent-runtime"]`
  - no IAM, ingress, env, or unrelated service changes were applied

### 16.2 Fresh RAW travel intent and authoritative v1

- fresh public RAW intent creation succeeded:
  - `intentId: intent-travel-liveproof10b-1787398742750`
  - `POST /v1/intents -> 200`
- workspace finalization succeeded through the normal async path:
  - `GET /v1/workspace/intent-travel-liveproof10b-1787398742750 -> 200`
  - `intentStateId v1: state-intent-travel-liveproof10b-1787398742750-compiled-075c39963401b462`
  - `stateHash v1: c4ba1ba1287c04c5965f1e2772603a9d6dd23f5bebd6263ad806c97ef1d6dfdd`
  - authoritative semantic verification v1:
    - `semantic-verification-state-intent-travel-liveproof10b-1787398742750-compiled-075c39963401b462`
    - content hash `a3e2a65feeb6a0f0eec75d7cdc28b77d7d67c949e8f15a32d1db3eee536ccade`
  - readiness v1 remained below privileged execution:
    - `PLANNABLE`

The finalized authoritative live travel constraints on this fresh intent were:

- `c-hotel-name` -> concept `hotel_name`
- `c-quantity` -> concept `stay_quantity`
- `c-refundable` -> concept `refundable`
- `c-approved-provider` -> concept `provider_approval_status`
- `c-stay-date` -> concept `check_in_date`
- `c-budget-limit` -> concept `total_price`
- `c-booking-deadline` -> concept `booking_deadline`

### 16.3 Candidate evidence and trusted verification

Public lineage-bound candidate evidence submission succeeded through the governed production seam:

- original envelope ids:
  - `ev-travel10b-1787398742750-provider`
  - `ev-travel10b-1787398742750-hotel-offer`
  - `ev-travel10b-1787398742750-refund`
  - `ev-travel10b-1787398742750-budget`
  - `ev-travel10b-1787398742750-count`
  - `ev-travel10b-1787398742750-staydate`
  - `ev-travel10b-1787398742750-deadline`
- original claim ids:
  - `claim-travel10b-1787398742750-provider`
  - `claim-travel10b-1787398742750-hotel-offer`
  - `claim-travel10b-1787398742750-refund`
  - `claim-travel10b-1787398742750-budget`
  - `claim-travel10b-1787398742750-count`
  - `claim-travel10b-1787398742750-staydate`
  - `claim-travel10b-1787398742750-deadline`
- public readback remained fail-safe:
  - `GET /v1/evidence/ev-travel10b-1787398742750-provider -> 200`
  - `trustClass = UNTRUSTED_EXTERNAL`

Verifier-only derivative evidence creation also succeeded on `tm-dev`:

- authorized verifier identity:
  - `tm-dev-phase-c-verifier@elite-crossbar-505104-t9.iam.gserviceaccount.com`
- derivative verified envelope ids:
  - `ev-travel10b-1787398742750-provider-verified-verify-travel10b-1787398742750-provider-b1`
  - `ev-travel10b-1787398742750-hotel-offer-verified-verify-travel10b-1787398742750-hotel-offer-b1`
  - `ev-travel10b-1787398742750-refund-verified-verify-travel10b-1787398742750-refund-b1`
  - `ev-travel10b-1787398742750-budget-verified-verify-travel10b-1787398742750-budget-b1`
  - `ev-travel10b-1787398742750-count-verified-verify-travel10b-1787398742750-count-b1`
  - `ev-travel10b-1787398742750-staydate-verified-verify-travel10b-1787398742750-staydate-b1`
  - `ev-travel10b-1787398742750-deadline-verified-verify-travel10b-1787398742750-deadline-b1`
- derivative verified claim ids:
  - `claim-travel10b-1787398742750-provider-verified-verify-travel10b-1787398742750-provider-b1`
  - `claim-travel10b-1787398742750-hotel-offer-verified-verify-travel10b-1787398742750-hotel-offer-b1`
  - `claim-travel10b-1787398742750-refund-verified-verify-travel10b-1787398742750-refund-b1`
  - `claim-travel10b-1787398742750-budget-verified-verify-travel10b-1787398742750-budget-b1`
  - `claim-travel10b-1787398742750-count-verified-verify-travel10b-1787398742750-count-b1`
  - `claim-travel10b-1787398742750-staydate-verified-verify-travel10b-1787398742750-staydate-b1`
  - `claim-travel10b-1787398742750-deadline-verified-verify-travel10b-1787398742750-deadline-b1`
- verified derivative trust class:
  - `ELEVATED_EXTERNAL`
- verifier provenance remained server-owned:
  - `verified-by:tm-dev-phase-c-verifier@elite-crossbar-505104-t9.iam.gserviceaccount.com`

### 16.4 Pre-execution readiness completeness proof

Negative completeness proof passed live:

- omitted verified deadline evidence intentionally
- `POST /internal/pre-execution-readiness` returned:
  - `superseded: false`
  - readiness remained `PLANNABLE`
- proof table showed:
  - `c-booking-deadline` present in the required execution-critical set
  - `c-booking-deadline` proof row `status: UNKNOWN`
  - reason: `No verified evidence matched the authoritative constraint`
- coverage summary:
  - required constraint ids:
    - `c-approved-provider`
    - `c-booking-deadline`
    - `c-budget-limit`
    - `c-hotel-name`
    - `c-quantity`
    - `c-refundable`
    - `c-stay-date`
  - missing constraint ids: none
  - higher-readiness supersession correctly denied because required coverage/proof was incomplete

Positive completeness proof also passed live:

- included the full verified evidence set
- `POST /internal/pre-execution-readiness` returned:
  - `superseded: true`
- all seven required execution-critical rows were present and `SATISFIED`
- coverage summary:
  - `requiredConstraintIds` exactly matched `evaluatedConstraintIds`
  - `missingConstraintIds: []`
  - `allRequiredCovered: true`

### 16.5 Authoritative semantic supersession

Semantic supersession succeeded through the deployed `agent-runtime -> intent-provenance` owner path:

- original v1 remained immutable:
  - `state-intent-travel-liveproof10b-1787398742750-compiled-075c39963401b462`
- successor v2 created:
  - `state-intent-travel-liveproof10b-1787398742750-semantic-040eaea6f425756f`
  - `previousStateId = state-intent-travel-liveproof10b-1787398742750-compiled-075c39963401b462`
  - version `2`
  - `stateHash v2: ad2868bf448202c85800405f6725db2024e27d7a97e3e798c12edb6854e5bc4c`
- immutable semantic verification artifacts:
  - v1 artifact id:
    - `semantic-verification-state-intent-travel-liveproof10b-1787398742750-compiled-075c39963401b462`
    - content hash `a3e2a65feeb6a0f0eec75d7cdc28b77d7d67c949e8f15a32d1db3eee536ccade`
  - v2 artifact id:
    - `semantic-verification-state-intent-travel-liveproof10b-1787398742750-semantic-040eaea6f425756f`
    - content hash `388d57b082d904f4ada256b092192cbb3563675cbb48fb1caeda7fec262ff57f`
- v2 semantic verification payload showed:
  - readiness upgraded from `PLANNABLE` to `ACTIONABLE`
  - lifecycle remained `AMBIGUOUS`
  - ambiguity class remained `A2`
  - proof summary contained all seven proof rows and complete coverage
- current authoritative tip moved to `v2`

### 16.6 Fresh workflow submission from v2

The workflow was then submitted against the superseded authoritative tip:

- canonical successful submit:
  - `workflowId: wf-f392a04d0df15bddcf285ef2`
  - `intentId: intent-travel-liveproof10b-1787398742750`
  - `intentStateId: state-intent-travel-liveproof10b-1787398742750-semantic-040eaea6f425756f`

Durable workflow artifacts prove the planner consumed the superseded state:

- `WORKFLOW.payload.intentStateId = state-intent-travel-liveproof10b-1787398742750-semantic-040eaea6f425756f`
- `ACTION.payload.intentStateId = state-intent-travel-liveproof10b-1787398742750-semantic-040eaea6f425756f`
- `GUARDIAN.payload.intentStateId = state-intent-travel-liveproof10b-1787398742750-semantic-040eaea6f425756f`

The shared runtime also produced the required generic travel plan shape:

- `plan-wf-f392a04d0df15bddcf285ef2`
- verification/read step:
  - `step-1-verify-offer`
- privileged execution step:
  - `step-2-execute-booking`
  - requested capability: `book_travel`
- outcome verification step:
  - `step-3-verify-outcome`

All seven deterministic proof rows were durably written as `SATISFIED`:

- `proof-wf-f392a04d0df15bddcf285ef2-0`
- `proof-wf-f392a04d0df15bddcf285ef2-1`
- `proof-wf-f392a04d0df15bddcf285ef2-2`
- `proof-wf-f392a04d0df15bddcf285ef2-3`
- `proof-wf-f392a04d0df15bddcf285ef2-4`
- `proof-wf-f392a04d0df15bddcf285ef2-5`
- `proof-wf-f392a04d0df15bddcf285ef2-6`

Guardian was reached and durably recorded on the new state:

- artifact:
  - `guardian-wf-f392a04d0df15bddcf285ef2`
- live decision:
  - `decision: ALLOW`
  - `criticalFailure: false`
  - `semanticStatus: CLEAR`

### 16.7 First new closure-grade blocker after Fix B

Despite the successful supersession, proof completeness, shared plan shape, complete proof rows, and Guardian `ALLOW`, the workflow still failed closed **before authority / monitoring materialization**.

The first proven blocking artifact is the durable shared verifier result:

- artifact:
  - `plan-verification-wf-f392a04d0df15bddcf285ef2`
- workflow:
  - `wf-f392a04d0df15bddcf285ef2`
- revision:
  - `tm-dev-agent-runtime-00031-27t`
- exact durable verifier state:
  - `status: REJECTED`
  - `criticalFailure: true`
- exact durable finding:
  - `INAPPROPRIATE_COMMITMENT`
  - message: `Ambiguous intent cannot receive economic / high-consequence commitment`

The canonical `WORKFLOW` row was then written immediately after Guardian with:

- `WORKFLOW.payload.state = BLOCKED`
- predecessor:
  - `guardian-wf-f392a04d0df15bddcf285ef2`

This matches the live engine eligibility gate:

- `checked.value.status === "VERIFIED"`
- `completeProofs === true`
- `guardianResult.value.decision !== BLOCK`
- `!guardianResult.value.criticalFailure`
- `privilegedReady`

In this live case:

- `completeProofs` was satisfied
- Guardian was `ALLOW`
- Guardian was not critical-failure
- semantic supersession had upgraded readiness to `ACTIONABLE`
- **but** `PLAN_VERIFICATION` still stayed `REJECTED` because the verifier treated the superseded intent as too ambiguous for economic/high-consequence commitment

This is therefore the next closure-grade blocker on `tm-dev`:

- not IAM
- not evidence lineage
- not proof-obligation completeness
- not stale `PLANNABLE` reuse
- not MonitoringContract materialization logic

It is a remaining **shared plan-verifier / semantic-ambiguity gating conflict** on a fresh superseded travel workflow:

- `IntentState v2` was authoritative
- `semantic-verification-v2` was authoritative
- required execution-critical obligations were complete and satisfied
- the shared planner produced the required `book_travel` step
- the shared plan verifier still rejected privileged commitment because ambiguity remained too high for a `HIGH` consequence action

### 16.8 Stop point

Per the closure instructions, this pass stops here at the first new closure-grade blocker.

Not reached in this pass:

- authority evaluation
- adaptive authority decision
- monitoring contract creation
- PREPARE
- AUTHORIZE
- COMMIT
- outcome materialization

**WAVE 4 PRODUCTION CLOSED = NO**

## 26. z13 continuation on Sunday, August 23, 2026

Date: Sunday, August 23, 2026

Scope of this pass:

- no runtime code changes
- continue the existing z13 production proof only
- finish the positive branch, replay proof, and remaining Wave 4 safety matrix until the first genuine new blocker

Deployed runtime in scope:

- `agent-runtime = tm-dev-agent-runtime-00060-ps5`
- image digest:
  - `sha256:de76bca6ad0f5712893f6962ad23241b0358bda6a05744f4f37ff5fbf898c8a5`

### 26.1 Positive z13 branch completed

Fresh positive workflow already in progress:

- `workflowId = wf-c93e4395bb63a2226e663f59`
- execution side effect:
  - `exec-wave4-live-20260823z13-pos-wf-1`
- durable OutcomeContract:
  - `outcome-evaluation-wf-c93e4395bb63a2226e663f59-authority-wf-c93e4395bb63a2226e663f59-a10ec5e5b493ce46`

Verified live outcome result:

- public outcome read: `200`
- internal owner read: `200`
- `workflowId = wf-c93e4395bb63a2226e663f59`
- `domain = travel`
- `paymentStatus = SUCCESS`
- `state = SATISFIED`

Requirement evaluations recorded on the durable contract were all `SATISFIED`, including:

- `travel_provider_match`
- `travel_booking_confirmed`
- `traveler_count_confirmed`
- `travel_price_within`
- `travel_refundable`
- `travel_date_correct`
- `stay_quantity`
- `refundable`
- `lodging_property`
- `booking_provider`

Positive-branch invariants proved live:

- `OutcomeContract = SATISFIED`
- `ResolutionCase count = 0`
- execution side-effect count = exactly `1`

Resolution proof:

- direct resolution-service log correlation for the positive outcome contract returned no `ResolutionCase`
- no resolution artifact was opened for the satisfied branch

Side-effect count proof:

- Gateway execution-result logs for `wf-c93e4395bb63a2226e663f59` contained exactly one execution result:
  - `exec-wave4-live-20260823z13-pos-wf-1`

### 26.2 Positive replay proof completed

The same governed public workflow-id commit was replayed on the already authorized positive workflow.

Observed result:

- replay status:
  - `IDEMPOTENT_REPLAY`
- replay result ref:
  - `mock-pay-wave4-live-20260823z13-pos-wf-1`
- workflow remained publicly safe:
  - no privileged authorization handles exposed
- execution side-effect count remained exactly `1`

This preserves the required public governed commit replay invariant:

- second workflow-id commit
  -> `IDEMPOTENT_REPLAY`
  -> no second economic side effect

### 26.3 Negative z13 branch remains valid

The existing non-satisfied z13 branch remains durable and valid:

- `workflowId = wf-d0d4d73f6d1438a7911eb2bf`
- execution succeeded
- outcome state:
  - `BREACHED`
- ResolutionCase:
  - `rc-outcome-evaluation-wf-d0d4d73f6d1438a7911eb2bf-authority-wf-d0d4d73f6d1438a7911eb2bf-9acbcfc42781f8a1-b37e4cfafd9c9a25`

This preserves the core invariant:

- execution/payment success
  !=
  outcome success

### 26.4 Additional safety matrix results completed before the blocker

Unauthorized caller denial:

- caller:
  - `tm-dev-public-bff@elite-crossbar-505104-t9.iam.gserviceaccount.com`
- attempted verifier-only route:
  - `/internal/evidence/verifications`
- result:
  - `403 PERMISSION_DENIED`

Travel deterministic mismatch fail-closed proof:

- `workflowId = wf-e34f2ac9fec0962864c89c39`
- result:
  - public submit/read reached `state = BLOCKED`
- durable artifacts present:
  - `plan-wf-e34f2ac9fec0962864c89c39`
  - `plan-verification-wf-e34f2ac9fec0962864c89c39`
  - `action-wf-e34f2ac9fec0962864c89c39`
  - `guardian-wf-e34f2ac9fec0962864c89c39`
  - proof artifacts `proof-wf-e34f2ac9fec0962864c89c39-0..7`
- authority artifacts:
  - none

Stale authoritative state/proof fail-closed proof:

- public workflow submit failed with:
  - `400 GRANT_INTENT_STATE_MISMATCH`
- message:
  - `Requested IntentState is not the current tip`
- no downstream authority artifact was created

Procurement deterministic mismatch fail-closed proof:

- `workflowId = wf-ac1e222ac82c48e3bdec5174`
- result:
  - public read `state = BLOCKED`
- durable artifacts present:
  - `plan-wf-ac1e222ac82c48e3bdec5174`
  - `plan-verification-wf-ac1e222ac82c48e3bdec5174`
  - `action-wf-ac1e222ac82c48e3bdec5174`
  - `guardian-wf-ac1e222ac82c48e3bdec5174`
  - proof artifacts `proof-wf-ac1e222ac82c48e3bdec5174-0..4`
- authority artifacts:
  - none

SaaS deterministic mismatch fail-closed proof:

- `workflowId = wf-e50826fd68d6b7aec4aa284d`
- result:
  - public read `state = BLOCKED`
- durable artifacts present:
  - `plan-wf-e50826fd68d6b7aec4aa284d`
  - `plan-verification-wf-e50826fd68d6b7aec4aa284d`
  - `action-wf-e50826fd68d6b7aec4aa284d`
  - `guardian-wf-e50826fd68d6b7aec4aa284d`

Logistics deterministic mismatch fail-closed proof:

- `workflowId = wf-4b8338dd4059adb6f7deac3e`
- public read:
  - `state = BLOCKED`
- Guardian log correlation:
  - decision `BLOCK`
  - `criticalFailure = true`
  - `semanticStatus = CRITICAL_FAILURE`
- durable artifacts present:
  - `plan-wf-4b8338dd4059adb6f7deac3e`
  - `plan-verification-wf-4b8338dd4059adb6f7deac3e`
  - `action-wf-4b8338dd4059adb6f7deac3e`
  - `guardian-wf-4b8338dd4059adb6f7deac3e`

### 26.5 First new blocker: invoice-domain proof never finalized

The remaining matrix did **not** complete cleanly. An isolated private invoice-domain proof was run to recover the missing invoice branch using the same production-safe verifier/operator pattern as the rest of z13.

Proof job:

- Cloud Run job:
  - `tm-dev-z13-invoice-proof`
- execution:
  - `tm-dev-z13-invoice-proof-82x52`
- identity:
  - `tm-dev-phase-c-verifier@elite-crossbar-505104-t9.iam.gserviceaccount.com`

First actual blocker:

- the proof timed out waiting for the authoritative tip for:
  - `wave4-live-20260823-z13-invoice-proof-intent`
- exact operator stderr:
  - `Timed out waiting for tip for wave4-live-20260823-z13-invoice-proof-intent`

While the operator was polling for the tip, intent-provenance authentication and route policy both succeeded repeatedly:

- route:
  - `/internal/intents/wave4-live-20260823-z13-invoice-proof-intent/tip`
- `verification = SUCCEEDED`
- `routePolicyResult = ALLOWED`
- verified caller:
  - `tm-dev-phase-c-verifier@elite-crossbar-505104-t9.iam.gserviceaccount.com`

At the same time, `agent-runtime` repeatedly emitted compilation-stage failures for that exact invoice proof intent:

- workflow id:
  - `compilation-wave4-live-20260823-z13-invoice-proof-intent`
- event:
  - `workflow_stage_event_write_failed`
- stage:
  - `COMPILATION`
- error:
  - `7 PERMISSION_DENIED: Missing or insufficient permissions.`
- revision:
  - `tm-dev-agent-runtime-00060-ps5`

This means the first new closure-grade blocker on Sunday, August 23, 2026 is not in the already-passing z13 positive branch, replay, Travel mismatch, stale-state denial, unauthorized-caller denial, SaaS mismatch, or Logistics mismatch. It is the invoice-domain branch failing to produce an authoritative finalized tip while compilation repeatedly logs `COMPILATION` stage-event write permission failures.

Per the hard-stop rule, the proof stopped here. The invoice mismatch case was **not** counted as a passing fail-closed matrix proof, and the Wave 4 matrix was not marked complete.

### 26.6 Temporary operator cleanup

After evidence collection, the temporary private jobs used for this z13 continuation were deleted:

- `tm-dev-z13-closure-matrix`
- `tm-dev-z13-unauthorized-caller`
- `tm-dev-z13-invoice-proof`

## Current closure status after z13 continuation

The z13 positive branch, satisfied outcome, no-resolution positive proof, replay proof, unauthorized-caller denial, Travel mismatch block, stale-state denial, Procurement block, SaaS block, and Logistics block are all now recorded.

Wave 4 remains open because the invoice-domain proof did not finalize to an authoritative tip and instead exposed repeated `COMPILATION` stage-event write permission failures on `tm-dev-agent-runtime-00060-ps5`.

**WAVE 4 PRODUCTION CLOSED = NO**

### 26.7 Matrix completion on Monday, August 24, 2026

The historical invoice blocker recorded above is no longer present on the current live deployment.

Current deployed runtime in scope:

- `agent-runtime = tm-dev-agent-runtime-00061-ps5`
- image digest:
  - `sha256:086fc87a40e590b3590da80f7b76b65c2ed071041bbc078a1f1837e52271496d`

The existing private matrix operator was re-run on the live stack:

- Cloud Run job:
  - `tm-dev-z13-closure-matrix-current`
- execution:
  - `tm-dev-z13-closure-matrix-current-vhn5r`
- identity:
  - `tm-dev-phase-c-verifier@elite-crossbar-505104-t9.iam.gserviceaccount.com`

The stale-state and deterministic-mismatch negatives completed successfully on the current runtime revision:

- Travel deterministic mismatch:
  - `workflowId = wf-072631b034e22b55515e9c69`
  - `GET /v1/workflows/wf-072631b034e22b55515e9c69 -> 200`
  - public state:
    - `BLOCKED`
  - durable artifacts present:
    - `plan-wf-072631b034e22b55515e9c69`
    - `plan-verification-wf-072631b034e22b55515e9c69`
    - `action-wf-072631b034e22b55515e9c69`
    - `guardian-wf-072631b034e22b55515e9c69`
    - proof artifacts `proof-wf-072631b034e22b55515e9c69-0..7`
  - authority artifacts:
    - none

- Stale authoritative state:
  - public submit failed with:
    - `400 GRANT_INTENT_STATE_MISMATCH`
  - message:
    - `Requested IntentState is not the current tip`
  - no workflow authority artifact was created

- Procurement deterministic mismatch:
  - `workflowId = wf-c5b3f7d6878aa98d086b341d`
  - `GET /v1/workflows/wf-c5b3f7d6878aa98d086b341d -> 200`
  - public state:
    - `BLOCKED`
  - durable artifacts present:
    - `plan-wf-c5b3f7d6878aa98d086b341d`
    - `plan-verification-wf-c5b3f7d6878aa98d086b341d`
    - `action-wf-c5b3f7d6878aa98d086b341d`
    - `guardian-wf-c5b3f7d6878aa98d086b341d`
    - proof artifacts `proof-wf-c5b3f7d6878aa98d086b341d-0..4`
  - Guardian log correlation:
    - decision `BLOCK`
    - `criticalFailure = true`
    - `semanticStatus = CRITICAL_FAILURE`
  - authority artifacts:
    - none

- SaaS deterministic mismatch:
  - `workflowId = wf-66300b92343e5902aecda0de`
  - `GET /v1/workflows/wf-66300b92343e5902aecda0de -> 200`
  - public state:
    - `BLOCKED`
  - durable artifacts present:
    - `plan-wf-66300b92343e5902aecda0de`
    - `plan-verification-wf-66300b92343e5902aecda0de`
    - `action-wf-66300b92343e5902aecda0de`
    - `guardian-wf-66300b92343e5902aecda0de`
    - proof artifacts `proof-wf-66300b92343e5902aecda0de-0..5`
  - Guardian log correlation:
    - decision `BLOCK`
    - `criticalFailure = true`
    - `semanticStatus = CRITICAL_FAILURE`
  - authority artifacts:
    - none

- Invoice/vendor deterministic mismatch:
  - `workflowId = wf-87c02b4222031e7353379177`
  - `GET /v1/workflows/wf-87c02b4222031e7353379177 -> 200`
  - public state:
    - `BLOCKED`
  - durable artifacts present:
    - `plan-wf-87c02b4222031e7353379177`
    - `plan-verification-wf-87c02b4222031e7353379177`
    - `action-wf-87c02b4222031e7353379177`
    - `guardian-wf-87c02b4222031e7353379177`
    - proof artifacts `proof-wf-87c02b4222031e7353379177-0..4`
  - Guardian log correlation:
    - decision `BLOCK`
    - `criticalFailure = true`
    - `semanticStatus = CRITICAL_FAILURE`
  - authority artifacts:
    - none

- Logistics deterministic mismatch:
  - `workflowId = wf-96efab3388e4a2082ee592bd`
  - `GET /v1/workflows/wf-96efab3388e4a2082ee592bd -> 200`
  - public state:
    - `BLOCKED`
  - durable artifacts present:
    - `plan-wf-96efab3388e4a2082ee592bd`
    - `plan-verification-wf-96efab3388e4a2082ee592bd`
    - `action-wf-96efab3388e4a2082ee592bd`
    - `guardian-wf-96efab3388e4a2082ee592bd`
    - proof artifacts `proof-wf-96efab3388e4a2082ee592bd-0..3`
  - Guardian log correlation:
    - decision `BLOCK`
    - `criticalFailure = true`
    - `semanticStatus = CRITICAL_FAILURE`
  - authority artifacts:
    - none

The earlier unauthorized-caller denial remains valid and unchanged:

- caller:
  - `tm-dev-public-bff@elite-crossbar-505104-t9.iam.gserviceaccount.com`
- attempted verifier-only route:
  - `/internal/evidence/verifications`
- result:
  - `403 PERMISSION_DENIED`

This completes the remaining z13 closure matrix:

- positive satisfied branch:
  - passed
- governed workflow-id replay:
  - passed
- negative non-satisfied outcome with shared `ResolutionCase`:
  - passed
- deterministic mismatch matrix across Travel / Procurement / SaaS / Invoice / Logistics:
  - passed
- stale authoritative state:
  - passed
- unauthorized caller denial:
  - passed

No new closure-grade blocker appeared in the current matrix run. The remaining Wave 4 live proof set is satisfied on `tm-dev`.

**WAVE 4 PRODUCTION CLOSED = YES**

## 26. Wave 4 stabilization deploy and fresh public Travel proof

Date: Saturday, August 22, 2026

### 26.1 Narrow deploy actually applied

Local validation for the intended next live pass completed before deploy:

- `pnpm vitest --run services/agent-runtime/src/travel-domain-pack.test.ts services/agent-runtime/src/pre-execution-readiness.test.ts services/agent-runtime/src/domain-concept-contracts.test.ts services/agent-runtime/src/generic-workflow.e2e.test.ts services/outcome-service/src/phase8.test.ts services/resolution-service/src/event-handler.test.ts services/resolution-service/src/outcome-internal-routes.test.ts`
  - `141` tests passed
- `pnpm --filter @truemandate/agent-runtime build`
  - passed
- `pnpm --filter @truemandate/resolution-service build`
  - passed

Only the two intended runtime images were changed in this pass:

| Service | Ready revision | Immutable image digest |
| --- | --- | --- |
| `tm-dev-agent-runtime` | `tm-dev-agent-runtime-00038-n2z` | `sha256:609a424e6851a3a8fb3f59d05c54cd93872b42f95fadef50486eb70c21c62782` |
| `tm-dev-outcome-resolution` | `tm-dev-outcome-resolution-00031-w2q` | `sha256:c47e90cbae6a1d1d0a00f7703553bc9b3a02469b441ed865c92da4c1c5644d4a` |

Runtime Terraform result:

- `terraform validate` passed
- saved runtime plan contained only `0 add, 2 change, 0 destroy`
- changed resources:
  - `module.runtime.google_cloud_run_v2_service.s2s["agent-runtime"]`
  - `module.runtime.google_cloud_run_v2_service.runtime["outcome-resolution"]`
- no IAM, ingress, caller-policy, or unrelated service changes were applied

Current live owner revision also confirmed:

- `tm-dev-intent-provenance-00031-nct`

### 26.2 Fresh public Travel start

A completely fresh public Travel proof was started through the repaired public path:

- intent:
  - `wave4-live-20260822a-intent`
- candidate evidence envelope:
  - `wave4-live-20260822a-offer`
- candidate claims:
  - `wave4-live-20260822a-provider`
  - `wave4-live-20260822a-provider-approval`
  - `wave4-live-20260822a-property`
  - `wave4-live-20260822a-refundability`
  - `wave4-live-20260822a-stay-count`
  - `wave4-live-20260822a-checkin`
  - `wave4-live-20260822a-checkout`
  - `wave4-live-20260822a-budget`
  - `wave4-live-20260822a-deadline`
  - `wave4-live-20260822a-booking-confirmed`
  - `wave4-live-20260822a-traveler-count`
  - `wave4-live-20260822a-amount`

Public path results:

- `POST /v1/intents -> 200`
- `POST /v1/evidence -> 200`
- `GET /v1/evidence/wave4-live-20260822a-offer -> 200`
- public candidate envelope remained:
  - `trustClass = UNTRUSTED_EXTERNAL`

The authoritative finalized v1 tip exists durably:

- `IntentState v1`
  - `state-wave4-live-20260822a-intent-compiled-efb49d7022594f58`
- `stateHash`
  - `76e7423e37798fc1da6fcf281cdfb5da2bf6744ce335a44c9645927277ccdc8a`
- semantic verification artifact
  - `semantic-verification-state-wave4-live-20260822a-intent-compiled-efb49d7022594f58`
- v1 readiness
  - `PLANNABLE`
- v1 ambiguity class
  - `A1`
- v1 temporal authority remained grounded:
  - `sourceRef = c8`
  - `executionNotAfter = 2026-12-31T00:00:00.000Z`

The compiled authoritative Travel constraints for this live proof are:

- `c1 stay_quantity = 2`
- `c2 refundable = true`
- `c3 hotel_name = "Seaside Lodge"`
- `c4 provider = "Meridian Travel Partners"`
- `c5 check_in_date = 2026-12-20`
- `c6 check_out_date = 2026-12-22`
- `c7 total_cost < 5000`
- `c8 booking_completion_deadline < 2026-12-31`

The immutable compilation artifact for this same v1 is:

- `compilation-wave4-live-20260822a-intent-89e4f3afc8b617cf`

Its ambiguity record remained:

- ambiguity id:
  - `amb1`
- ambiguity class:
  - `A1`
- related concepts:
  - `provider`
  - `approved_provider`
- reason:
  - provider approval requires verification against the approved-provider control

### 26.3 Verifier-side internal path succeeded, but no authoritative v2 was created

A temporary private Cloud Run verifier job reused the existing governed internal seams:

- job:
  - `tm-dev-wave4-verifier-ops`
- successful execution:
  - `tm-dev-wave4-verifier-ops-ccc6b`
- verifier identity:
  - `tm-dev-phase-c-verifier@elite-crossbar-505104-t9.iam.gserviceaccount.com`
- follow-up diagnostic execution:
  - `tm-dev-wave4-verifier-ops-sjbpq`
  - failed while attempting temporary debug persistence, not while changing any production runtime surface

The successful governed internal steps were:

- `POST /internal/evidence/verifications`
  - verification id:
    - `wave4-live-20260822a-verify-r2`
- `POST /internal/pre-execution-readiness`

Expected derivative verified evidence lineage used for the readiness call:

- verified envelope:
  - `wave4-live-20260822a-offer-verified-wave4-live-20260822a-verify-r2`
- verified claims:
  - `wave4-live-20260822a-provider-verified-wave4-live-20260822a-verify-r2`
  - `wave4-live-20260822a-provider-approval-verified-wave4-live-20260822a-verify-r2`
  - `wave4-live-20260822a-property-verified-wave4-live-20260822a-verify-r2`
  - `wave4-live-20260822a-refundability-verified-wave4-live-20260822a-verify-r2`
  - `wave4-live-20260822a-stay-count-verified-wave4-live-20260822a-verify-r2`
  - `wave4-live-20260822a-checkin-verified-wave4-live-20260822a-verify-r2`
  - `wave4-live-20260822a-checkout-verified-wave4-live-20260822a-verify-r2`
  - `wave4-live-20260822a-budget-verified-wave4-live-20260822a-verify-r2`
  - `wave4-live-20260822a-deadline-verified-wave4-live-20260822a-verify-r2`
  - `wave4-live-20260822a-booking-confirmed-verified-wave4-live-20260822a-verify-r2`
  - `wave4-live-20260822a-traveler-count-verified-wave4-live-20260822a-verify-r2`
  - `wave4-live-20260822a-amount-verified-wave4-live-20260822a-verify-r2`

The first new closure-grade blocker is that the authoritative tip never moved after this governed verifier/readiness chain:

- current tip still points to:
  - `state-wave4-live-20260822a-intent-compiled-efb49d7022594f58`
- no successor `IntentState v2` was created
- no successor `semantic-verification-*` artifact was created for this intent

This means the fresh live proof did **not** reach any of these downstream stages:

- authoritative proof snapshot on a superseded current tip
- `actionPreservesIntent = true`
- `PLAN_VERIFICATION = VERIFIED`
- Guardian
- Authority
- PREPARE / AUTHORIZE / COMMIT
- OutcomeContract evaluation
- ResolutionCase proof

### 26.4 Exact blocker classification for this pass

The durable artifacts prove the following facts without weakening any gate:

- public candidate evidence submission succeeded
- public evidence remained untrusted as required
- verifier-only internal evidence verification ran under the correct trusted identity
- verifier-only pre-execution readiness ran against the current authoritative v1
- the current authoritative tip remained v1 `PLANNABLE/A1`
- no semantic supersession to v2 occurred

The strongest proven blocker from this pass is therefore:

- **fresh Travel proof stopped before semantic supersession**
- **the current authoritative tip remained `PLANNABLE/A1` after successful verifier-side evaluation**
- **the positive workflow chain could not continue because no `v2` authoritative source of truth was created**

The live v1 semantic verification itself is consistent with that stop:

- readiness:
  - `PLANNABLE`
- ambiguity:
  - `A1`
- finding:
  - `FINANCIAL_AUTHORIZATION_AMBIGUITY`
- message:
  - `Direct execution readiness requires verification of provider approval and payment authority; plannable readiness is appropriate.`

Based on the current deployed code and the live v1 artifacts, the likely blocking seam is the semantic-supersession eligibility path, not public evidence, not verifier identity, and not the public Travel workflow route. This statement is an inference from the live durable state; the exact returned body from the internal readiness call was not recoverable from Cloud Run job stdout during this pass.

### 26.5 Current closure status after the fresh Travel restart

The intended post-deploy proof sequence is still incomplete:

- positive Travel SATISFIED outcome:
  - **NOT REACHED**
- controlled non-satisfied Travel outcome and `ResolutionCase`:
  - **NOT REACHED**
- public commit replay idempotency on this fresh workflow:
  - **NOT REACHED**
- small cross-domain safety matrix:
  - **NOT RUN**

Per the hard-stop rule, this pass stopped at the first newly reproduced closure-grade blocker above.

**WAVE 4 PRODUCTION CLOSED = NO**

## 26. Repair 19 live proof: approval-fact normalization

### 26.1 Deployment

Repair 19 deployed only `tm-dev-agent-runtime` on Saturday, August 22, 2026.

- Cloud Build:
  - build id: `5a9972d4-5865-42ff-824b-4b2866695d2b`
- pushed image:
  - `us-central1-docker.pkg.dev/elite-crossbar-505104-t9/truemandate/agent-runtime:wave4-repair19-20260822t021000z`
- immutable digest:
  - `sha256:3510b936c9ae19cb9398bc429da6bb760069284a058f7133665eb227c189abb6`
- runtime Terraform delta:
  - `tm-dev-agent-runtime` image only
  - `0 added, 1 changed, 0 destroyed`
- ready Cloud Run revision:
  - `tm-dev-agent-runtime-00037-5zf`

No IAM, ingress, environment, or unrelated runtime surface changed in this pass.

### 26.2 Fresh public RAW Travel intent

Fresh public RAW Travel intent:

- `intentId`
  - `intent-repair19-live-1787431572391`
- `POST /v1/intents`
  - `200`
- finalized v1 tip:
  - `state-intent-repair19-live-1787431572391-compiled-1361a56fb5398483`
- v1 `stateHash`
  - `ff5629f8a0d76c5ebadfed615fa70ed15c92a4363990340ea511aaf9c8f3cc38`
- `GET /v1/workspace/intent-repair19-live-1787431572391`
  - `200`

The finalized authoritative v1 constraints on the live stack were:

- `c-1` -> `stay_count = 2`
- `c-2` -> `cancellation_policy = refundable`
- `c-3` -> `lodging_property = "Hotel Meridian"`
- `c-4` -> `booking_provider = "Meridian Travel Partners"`
- `c-5` -> `check_in_date = 2026-12-20`
- `c-6` -> `check_out_date = 2026-12-22`
- `c-7` -> `total_cost < 4800`
- `c-8` -> `booking_deadline < 2026-12-31`

This is the first important live finding for Repair 19: the fresh compiler output for this intent shape still materializes the provider requirement as `booking_provider`, not `booking_provider_approval`.

### 26.3 Public candidate evidence and verifier-only proof

Public governed candidate evidence submission succeeded:

- candidate envelope:
  - `ev-repair19-live-1787431766151-offer`
- candidate claims:
  - `claim-repair19-live-1787431766151-count`
  - `claim-repair19-live-1787431766151-refund`
  - `claim-repair19-live-1787431766151-property`
  - `claim-repair19-live-1787431766151-provider`
  - `claim-repair19-live-1787431766151-provider-approval`
  - `claim-repair19-live-1787431766151-checkin`
  - `claim-repair19-live-1787431766151-checkout`
  - `claim-repair19-live-1787431766151-budget`
  - `claim-repair19-live-1787431766151-deadline`
- lineage:
  - `intentId = intent-repair19-live-1787431572391`
  - `intentStateId = state-intent-repair19-live-1787431572391-compiled-1361a56fb5398483`

Public readback remained fail-safe:

- `GET /v1/evidence/ev-repair19-live-1787431766151-offer -> 200`
- `trustClass = UNTRUSTED_EXTERNAL`

The existing verifier-only seam then ran under the existing private operator path:

- job:
  - `tm-dev-wave4-proof-operator`
- execution:
  - `tm-dev-wave4-proof-operator-vzdgv`
- identity:
  - `tm-dev-phase-c-verifier@elite-crossbar-505104-t9.iam.gserviceaccount.com`
- VPC posture:
  - `tm-dev-s2s`
  - `ALL_TRAFFIC`

Verifier output:

- verification id:
  - `verify-repair19-live-1787431766151`
- derivative envelope:
  - `ev-repair19-live-1787431766151-offer-verified-verify-repair19-live-1787431766151`
- derivative claims:
  - `claim-repair19-live-1787431766151-count-verified-verify-repair19-live-1787431766151`
  - `claim-repair19-live-1787431766151-refund-verified-verify-repair19-live-1787431766151`
  - `claim-repair19-live-1787431766151-property-verified-verify-repair19-live-1787431766151`
  - `claim-repair19-live-1787431766151-provider-verified-verify-repair19-live-1787431766151`
  - `claim-repair19-live-1787431766151-provider-approval-verified-verify-repair19-live-1787431766151`
  - `claim-repair19-live-1787431766151-checkin-verified-verify-repair19-live-1787431766151`
  - `claim-repair19-live-1787431766151-checkout-verified-verify-repair19-live-1787431766151`
  - `claim-repair19-live-1787431766151-budget-verified-verify-repair19-live-1787431766151`
  - `claim-repair19-live-1787431766151-deadline-verified-verify-repair19-live-1787431766151`

### 26.4 First new closure-grade blocker

The first new blocker is still in pre-execution readiness, before semantic supersession, Repair 18 authoritative proof handoff, `PLAN_VERIFICATION`, Guardian, Authority, materialization, COMMIT, or Outcome.

- route:
  - `POST /internal/pre-execution-readiness`
- result:
  - `status = 200`
  - `superseded = false`
  - `readiness = PLANNABLE`

Coverage was complete:

- `requiredConstraintIds = c-1..c-8`
- `derivedObligationConstraintIds = c-1..c-8`
- `evaluatedConstraintIds = c-1..c-8`
- `missingObligationConstraintIds = []`
- `missingEvaluationConstraintIds = []`
- `allRequiredCovered = true`

But proof satisfaction failed on the provider row:

| Constraint | Concept | Proof result | Bound verified claim | Reason |
| --- | --- | --- | --- | --- |
| `c-1` | `stay_count` | `SATISFIED` | `claim-repair19-live-1787431766151-count-verified-verify-repair19-live-1787431766151` | matched claim concept `stay_count` |
| `c-2` | `cancellation_policy` | `SATISFIED` | `claim-repair19-live-1787431766151-refund-verified-verify-repair19-live-1787431766151` | matched claim concept `cancellation_policy` |
| `c-3` | `lodging_property` | `SATISFIED` | `claim-repair19-live-1787431766151-property-verified-verify-repair19-live-1787431766151` | matched claim concept `lodging_property` |
| `c-4` | `booking_provider` | `UNSATISFIED` | `claim-repair19-live-1787431766151-provider-verified-verify-repair19-live-1787431766151` | contradictory verified claims for canonical concept `provider` |
| `c-5` | `check_in_date` | `SATISFIED` | `claim-repair19-live-1787431766151-checkin-verified-verify-repair19-live-1787431766151` | matched claim concept `check_in_date` |
| `c-6` | `check_out_date` | `SATISFIED` | `claim-repair19-live-1787431766151-checkout-verified-verify-repair19-live-1787431766151` | matched claim concept `check_out_date` |
| `c-7` | `total_cost` | `SATISFIED` | `claim-repair19-live-1787431766151-budget-verified-verify-repair19-live-1787431766151` | matched claim concept `total_cost` |
| `c-8` | `booking_deadline` | `SATISFIED` | `claim-repair19-live-1787431766151-deadline-verified-verify-repair19-live-1787431766151` | matched claim concept `booking_deadline` |

The exact authoritative ambiguity result was:

- `ambiguityClass = A1`
- unresolved ambiguity:
  - `amb-1`
- related concepts:
  - `booking_provider`
- matched constraint ids:
  - `c-4`
- exact readiness reason:
  - `Related authoritative constraints are not fully proven by verified evidence`

The live contradiction is now proven:

- the verified structured approval claim is legitimate:
  - `concept = booking_provider_approval`
  - `value = { approved: true, provider: "Meridian Travel Partners" }`
- provider identity is also legitimately proven independently:
  - `concept = booking_provider`
  - `value = "Meridian Travel Partners"`
- but the fresh authoritative v1 for this live shape classifies the required constraint as canonical `booking_provider`
- both verified claims resolve into the same canonical `provider` concept family during readiness matching
- the evaluator treats the co-present identity fact and approval fact as contradictory evidence for the same canonical family

So Repair 19's approval-fact normalization did not get a chance to prove `approved=true -> SATISFIED` for this fresh live shape, because the live compiler/runtime shape has moved the first blocker one layer earlier:

- current authoritative required constraint:
  - `booking_provider`
- additional verified approval fact:
  - also canonicalized into `provider`
- first false predicate:
  - `proofRows[c-4].status = UNSATISFIED`

No semantic v2 successor was created, so none of the following were reached in this fresh proof:

- authoritative proof snapshot creation
- Repair 18 proof handoff
- `actionPreservesIntent = true`
- `PLAN_VERIFICATION = VERIFIED`
- Guardian
- Adaptive Authority
- materialization
- PREPARE
- AUTHORIZE
- workflow-id COMMIT
- OutcomeContract
- Repair 17 generic outcome evaluation

Per the hard-stop rule, the live proof stopped here.

**WAVE 4 PRODUCTION CLOSED = NO**

## 24. Repair 16: OutcomeContract public DTO lineage

Date: Saturday, August 22, 2026

### 24.1 End-to-end DTO trace and canonical source

The same Live Fix D contract was traced across every layer:

- durable OutcomeContract: workflow lineage exists at `preExecutionBinding.workflowId = wf-6a1e4689c6bca3eb323025cc`
- immutable WORKFLOW artifact: exact id/hash match and `payload.packId = travel`
- outcome-resolution owner read before repair: returned the raw durable contract, leaving workflow id nested and domain absent
- cloud-runtime `OutcomeS2SClient.getContract(...)`: passed the owner payload through unchanged
- public API `toPublicOutcomeView(...)`: selected top-level allowlisted fields, so nested workflow lineage and the discarded domain were absent
- SDK: correctly required both fields and failed closed with `SCHEMA_PARSE_FAILED`

The builder selected the travel template from the supplied domain but the historical durable schema did not persist domain. Repair 16 did not rewrite or rehash OutcomeContracts. The owner GET now validates and joins the contract's exact immutable WORKFLOW predecessor:

- binding workflow id must equal artifact id and artifact workflow id
- binding workflow hash must equal artifact content hash
- artifact kind must be `WORKFLOW`
- artifact pack id must be one of the canonical registered DomainPack ids

Only then does the owner read project top-level `workflowId` and `domain`. Missing or mismatched bound lineage fails with `OUTCOME_CONTRACT_STALE`. Historical contracts without a pre-execution workflow binding remain internally readable unchanged; strict public/SDK consumers continue to fail closed if required workflow-centric lineage is unavailable.

Public sanitization remains unchanged and excludes CommitToken, AuthorityGrant, PreparedAction, private execution authorization, requirements/evidence internals, hashes, and verifier-only state.

### 24.2 Regression and deployment evidence

Focused validation:

- outcome owner/lineage routes: `17 passed`
- public API outcome projection: `19 passed`
- SDK lifecycle and route truth: `12 passed`
- cloud-runtime S2S transport: `15 passed`
- total focused assertions: `63 passed`
- builds passed: resolution-service, public-api, sdk-core, cloud-runtime

Cloud Build:

- build: `fadb8016-2ac9-4fed-a064-cf299c3f3875`
- image digest: `sha256:3e6b676c259ecb235b57882ae8b94add21be368c43bee912e063de294630fd4e`
- ready revision: `tm-dev-outcome-resolution-00029-5sq`

The saved Terraform plan contained `0 add, 1 change, 0 destroy`. Only the outcome-resolution image digest changed. IAM, ingress, identity, environment, reader/mutation policies, and all unrelated services were unchanged. Apply completed with `0 added, 1 changed, 0 destroyed`.

### 24.3 Live public and SDK proof

Live public GET returned `200` with:

- `id = outcome-evaluation-wf-6a1e4689c6bca3eb323025cc-authority-wf-6a1e4689c6bca3eb323025cc-37ff0ddf5722065c`
- `workflowId = wf-6a1e4689c6bca3eb323025cc`
- `domain = travel`
- `intentId = intent-travel-liveproof14b-1787414136912`
- `intentStateId = state-intent-travel-liveproof14b-1787414136912-semantic-af8d3399bca09a5f`
- `paymentStatus = SUCCESS`
- `state = AWAITING_OUTCOME`

`sdk-core.readOutcome(...)` returned `ok: true` with the same safe lineage and lifecycle fields. Neither response contains CommitToken, grant, PreparedAction, execution authorization, verifier metadata, private Gateway state, requirements, or internal hashes.

### 24.4 Next downstream blocker: cross-domain outcome evidence derivation

Outcome evaluation was invoked through a temporary private Cloud Run operator job using the existing Phase C verifier identity and VPC. The job referenced the legitimate derivative verified travel claim:

- claim: `claim-travel-live14b-1787414136912-provider-verified-verify-travel-live14b-1787414136912-workflow-binding`
- evidence: `ev-travel-live14b-1787414136912-count-refund-hotel-offer-verified`
- owner route: `POST /internal/outcomes/:outcomeContractId/evaluate-evidence`
- authentication/application policy: permitted Phase C verifier
- outcome-resolution revision: `tm-dev-outcome-resolution-00029-5sq`
- result: `400 VALIDATION_FAILED`
- structured message: `OutcomeContract lacks a numeric quantity_received requirement`

The first failure occurs in shared `deriveObservations(...)`, before `applyObservations(...)`. It requires the procurement-specific `quantity_received` predicate for every domain. The travel contract instead contains travel-specific requirements such as provider match, booking confirmation, traveler count, price, refundability, and travel date. Therefore no outcome transition or ResolutionCase mutation occurred. The temporary operator job was deleted after evidence collection.

## Current closure blocker after Repair 16

OutcomeContract public DTO lineage and `sdk-core.readOutcome(...)` are production verified. The next blocker is the outcome evidence derivation path being procurement-shaped and unable to evaluate a canonical travel OutcomeContract.

**WAVE 4 PRODUCTION CLOSED = NO**

## 20. Live Proof 14: temporal authority and downstream rehearsal

### 20.1 Narrow deployment

Only the two requested runtime images were built and deployed. Cloud Build `c8538bf7-75b0-421e-9aee-7f00f71b031f` completed successfully.

| Service | Ready revision | Immutable image digest | Revision created |
| --- | --- | --- | --- |
| `intent-provenance` | `tm-dev-intent-provenance-00030-pll` | `sha256:dbc26b587538dcaba0643ce721c7eb9410a77cb3da574772c4b45b53463f84f8` | `2026-08-22T15:36:24.038884Z` |
| `authority` | `tm-dev-authority-00015-5w8` | `sha256:06f49bf7e7f4e26cff165ef4dd6aab2c8f5a86bb1647eba6329e1d06858247f3` | `2026-08-22T15:36:52.525743Z` |

The saved runtime plan and exact apply contained `0 add, 2 change, 0 destroy`: only the two Cloud Run image fields changed. IAM, ingress, environment, service identities, and every unrelated service remained unchanged.

### 20.2 Grounded temporal authority and supersession

An initial candidate was deliberately not advanced after semantic verification returned `SEARCHABLE / A3` for an omitted check-out date. Evidence was not allowed to erase that structural ambiguity.

The qualifying fresh intent was:

- intent: `intent-travel-liveproof14b-1787414136912`
- v1: `state-intent-travel-liveproof14b-1787414136912-compiled-ab959435186ee66e`
- v1 hash: `d510e6a826a4b29ac99a07396228f2784568e307aed3fee1a18decb8fab601e8`
- v1 semantic artifact: `semantic-verification-state-intent-travel-liveproof14b-1787414136912-compiled-ab959435186ee66e`
- v1 semantic result: `PLANNABLE / A1`
- grounded deadline constraint: `c8`, `completion_deadline LT 2026-12-31`
- human grounding: `Complete the booking before December 31, 2026`
- v1 temporal authority: `executionNotAfter = 2026-12-31T00:00:00.000Z`, `source = EXPLICIT_HUMAN`, `sourceRef = c8`

Candidate evidence `ev-travel-live14b-1787414136912-offer` was submitted through the public seam and remained `UNTRUSTED_EXTERNAL`. The verifier-only seam created derivative evidence under `tm-dev-phase-c-verifier@elite-crossbar-505104-t9.iam.gserviceaccount.com`; the derivative used by readiness was `ev-travel-live14b-1787414136912-offer-verified-verify-travel-live14b-1787414136912` with trust class `ELEVATED_EXTERNAL`.

All eight authoritative proof rows were `SATISFIED`. Required, derived, and evaluated constraint sets were exactly `c1` through `c8`, with no missing obligation, missing evaluation, or incomplete deterministic rule. Provider ambiguity `amb1` resolved from its mapped verified c4 proof, producing `A0`.

The successor was:

- v2: `state-intent-travel-liveproof14b-1787414136912-semantic-af8d3399bca09a5f`
- v2 hash: `140d37867fda650ed0eb642e031ba6ae8a1d80061dad593a15beb84e3cd1140c`
- v2 readiness / ambiguity: `ACTIONABLE / A0`
- v2 semantic artifact: `semantic-verification-state-intent-travel-liveproof14b-1787414136912-semantic-af8d3399bca09a5f`
- v2 semantic artifact hash: `bb915d8e4ccc3ca17c0779a3d9b10334407c80cec41162760c256e0709520727`
- `previousStateId`: v1
- current tip: v2
- preserved temporal authority: `2026-12-31T00:00:00.000Z`, `sourceRef = c8`

Both c8 and its value remained present in v2, so the preserved source reference resolves against the current authoritative state rather than the superseded state.

### 20.3 Live temporal fail-closed matrix

A mutation-free private operator execution used the deployed Authority image and its production resolver. Results:

| Case | Result |
| --- | --- |
| valid explicit current bound | `ok`, expiry `2026-12-31T00:00:00.000Z` |
| malformed date | `VALIDATION_FAILED / Malformed temporal authority bound` |
| unresolved relative date | `VALIDATION_FAILED / MISSING_TEMPORAL_AUTHORITY` |
| missing current `sourceRef` | `VALIDATION_FAILED / Temporal authority sourceRef is invalid` |
| source constraint / bound mismatch | `VALIDATION_FAILED / Temporal authority disagrees with source constraint` |
| expired bound | `GRANT_EXPIRED / Temporal authority expired` |

No negative case became materialization-eligible.

### 20.4 Governed workflow and downstream rehearsal

Fresh shared-runtime workflow: `wf-b929110ed9b66941e526b01e`.

- planner source: current v2 and matching semantic verdict `semantic-verdict-4877feb6a14d030f`
- plan artifact: `plan-wf-b929110ed9b66941e526b01e`
- plan steps: `step-1-verify-offer`, then privileged `step-2-execute-booking` with `book_travel`
- plan-verification artifact: `plan-verification-wf-b929110ed9b66941e526b01e`
- plan-verification result: `VERIFIED`, no findings, no critical failure
- Guardian artifact: `guardian-wf-b929110ed9b66941e526b01e`
- Guardian decision: `ALLOW`, semantic status `CLEAR`, current v2 binding
- Authority evaluation: `evaluation-wf-b929110ed9b66941e526b01e-authority-wf-b929110ed9b66941e526b01e`
- Adaptive Authority decision: `ALLOW`
- Authority reason: `deterministic scope checks passed`
- evaluated state: v2, version 2
- capability / merchant / amount: `book_travel`, `travel-provider`, `4800 USD`
- effective expiry: `2026-12-31T00:00:00.000Z`
- `materializationEligible = true`

Because the actual decision was `ALLOW`, no MonitoringContract was expected or manufactured.

The ordinary materialization path then reached:

1. OutcomeContract creation: `outcome-evaluation-wf-b929110ed9b66941e526b01e-authority-wf-b929110ed9b66941e526b01e-396e93f83c487b5a`, state `CREATED`, payment status `PENDING`.
2. Gateway PREPARE: `200`, prepared reference `prep-4ef89af7ed0b`.
3. Authority bind-and-mint: `200`, after current-state, evaluation, action, outcome, and temporal checks.
4. Gateway AUTHORIZE: `200`; the commit token remained internal and was not exposed through the public response.
5. Authorization-handle persistence: failed before workflow-id-based COMMIT.

This proves the temporal repair closed `MISSING_TEMPORAL_AUTHORITY`: `ALLOW` plus a valid current grounded bound now yields materialization eligibility and reaches the protected PREPARE/AUTHORIZE chain.

### 20.5 First downstream blocker

First failing stage: persistence of `execution-authorization-wf-b929110ed9b66941e526b01e` immediately after successful AUTHORIZE.

- service/revision: `intent-provenance`, `tm-dev-intent-provenance-00030-pll`
- route: `POST /internal/semantic-artifacts`
- live response: `400`
- structured code: `SCHEMA_PARSE_FAILED`
- structured message: `SemanticArtifact failed schema validation`
- exact issue: owner `kind` enum expected `COMPILATION | COMPILATION_VERIFICATION | SEMANTIC_VERIFICATION | PLAN | PLAN_VERIFICATION | PROOF | ACTION | GUARDIAN | WORKFLOW`, but received `EXECUTION_AUTHORIZATION`
- durable readback: `execution-authorization-wf-b929110ed9b66941e526b01e` is absent (`404 Unknown semantic artifact`)
- public workflow snapshot remains `AUTHORITY_EVALUATION`

Root-cause evidence is direct: `GenericWorkflowEngine` emits the engine-owned `EXECUTION_AUTHORIZATION` artifact used for secure commit-by-workflow, while the intent-provenance owner schema does not admit that kind. A private no-write schema probe under the existing agent-runtime identity reproduced the same structured `400`; no probe artifact persisted.

Expected invariant: after AUTHORIZE, the commit token must be stored only in a durable workflow-owned internal handle so public commit can resolve it by workflow id without exposing the token. The owner-schema mismatch prevents that secure handle from being persisted. COMMIT was therefore not attempted, and no gate was weakened.

All temporary private operator jobs created for this proof were deleted. The next repair should align the canonical owner artifact schema with the already-existing engine authorization-handle kind and add owner/engine route-truth coverage before replaying with a fresh workflow.

**WAVE 4 PRODUCTION CLOSED = NO**

## 19. Debug 13 local closure: temporal authority preservation

Debug 13 is locally repaired and validated only. Nothing in this section has
been deployed.

The first missing artifact for workflow `wf-b14269dcb66c68b2960c780c` is the
authoritative v1 IntentState, not ActionProposal, Authority, or semantic
supersession:

- v1: `state-intent-travel-repair12-1787407705567-compiled-185a21dca07260b5`
  (`99beb442...f9c6cab`), `temporalAuthority = null`
- v2: `state-intent-travel-repair12-1787407705567-semantic-4348239a7d98dc90`
  (`71ce1d5b...0cafd`), `previousStateId = v1`, `temporalAuthority = null`
- v1 compilation: `compilation-intent-travel-repair12-1787407705567-0ac0bba79d95809e`
- both states retain `c-stay-start-date = 2026-12-20` and
  `c-completion-deadline = 2026-12-31`; the deadline is an explicit,
  exact-grounded HUMAN TEMPORAL `LTE` constraint
- the compiler omitted optional `temporalResolution`; owner finalization
  filtered out every temporal candidate without that field and therefore did
  not derive the otherwise bounded deadline

Semantic supersession was not the live loss point. The owner create-state path
inherits `tip.temporalAuthority`, but local coverage now additionally validates
that the inherited `sourceRef` resolves to a current execution-bound temporal
constraint and verifies that the successor preserves the validated bound.

Authority materialization resolves the current owner state and requires:

- `temporalAuthority` with `EXPLICIT_HUMAN` or `ENTERPRISE_POLICY` source
- a current `sourceRef` resolving to an execution-bound TEMPORAL constraint
- valid `executionNotBefore` / `executionNotAfter` ordering
- an unexpired effective bound, narrowed by parent/policy expiry when supplied

`ALLOW` and `ALLOW_WITH_MONITORING` become materialization-eligible only when
that resolution succeeds. The production `MISSING_TEMPORAL_AUTHORITY` result
was therefore fail-closed and correct for the malformed v1/v2 state.

The local generic repair:

- lets owner finalization use an exact absolute ISO date or offset timestamp
  from an explicit, exact-grounded, untainted HUMAN execution-bound constraint
  when optional `temporalResolution` is absent, but only when the value matches
  a calendar date independently recovered from the grounded human phrase
- does not resolve relative expressions and does not invent a default expiry
- validates temporal source continuity during semantic supersession
- resolves Authority `sourceRef` against the current authoritative constraint
  set before materialization

Local validation:

- focused temporal/finalization/supersession/Authority tests: `104 passed`
- complete intent-service suite: `59 passed`
- complete authority-service suite: `142 passed`
- shared procurement and all-domain workflow regression suite: `37 passed`
- `@truemandate/intent-service` build: passed
- `@truemandate/authority-service` build: passed

Affected deployables for the next live pass are `intent-provenance` and
`authority`. The next proof must create a fresh RAW travel intent, show v1 and
proof-backed v2 both preserve a valid deadline bound whose `sourceRef` resolves,
then prove `ALLOW` or `ALLOW_WITH_MONITORING` becomes materialization-eligible
without changing the existing expiry invariant.

**WAVE 4 PRODUCTION CLOSED = NO**

## 18. Live Fix C: learning-service caller configuration

Date: Saturday, August 22, 2026.

### 18.1 Root cause and regression

Terraform had two learning-service auth sources:

- `local.service_env["learning-service"]` supplied verifier-only `TM_INTERNAL_ALLOWED_CALLERS`.
- explicit Cloud Run env blocks supplied `phase-c-verifier,authority`.
- the deployed environment ordered the verifier-only duplicate last, so it became effective and denied authenticated Authority reads.

The fix keeps all four learning auth variables in `local.service_env`, removes the duplicate explicit blocks, and renders exactly one caller value:

`tm-dev-phase-c-verifier@elite-crossbar-505104-t9.iam.gserviceaccount.com,tm-dev-authority@elite-crossbar-505104-t9.iam.gserviceaccount.com`

No `public-bff`, wildcard, IAM, ingress, identity, S2S token, route, image, or learning-semantic change was made. A focused architecture regression now asserts that learning auth has one canonical source, both intended callers occur exactly once, and `public-bff` is absent.

Validation:

- architecture and learning route suites: `2` files / `26` tests passed
- `terraform fmt -check infrastructure/terraform/modules/runtime`: passed
- runtime-stage `terraform validate`: passed

### 18.2 Terraform plan and deployment

Saved plan `tfplan.wave4-livefixc` was inspected before apply:

- `0 add, 1 change, 0 destroy`
- only `module.runtime.google_cloud_run_v2_service.runtime["learning-service"]`
- caller entries: `2 -> 1`
- image and service account unchanged
- no IAM, ingress, environment value beyond duplicate removal, or unrelated service change

Apply result: `0 added, 1 changed, 0 destroyed`.

- ready revision: `tm-dev-learning-service-00006-xvz`
- created: `2026-08-22T14:47:27.268467Z`
- Terraform-configured digest unchanged: `sha256:eb5d053ba8c44e172e80bc50857c232e2cf9eb58fc80ee97221c26793f241f4b`
- Cloud Run resolved digest unchanged from revision `00005`: `sha256:fd3a75e8e773cb80ecdd8045c5823ce07de6cf2e98bd49c1f9e35e79bc9ab85d`
- service identity unchanged: `tm-dev-learning-service@elite-crossbar-505104-t9.iam.gserviceaccount.com`
- ingress remains internal

### 18.3 Live authorization proof

A temporary VPC-connected operator job using the existing Authority identity performed read-only calls:

- `GET /internal/trust-signals/AGENT/agent-runtime/travel -> 200`
- `GET /internal/trust-signals/COUNTERPARTY/travel-provider/travel -> 200`
- both returned the valid null-tip response
- learning logs recorded `verification: SUCCEEDED`, `allowlistResult: ALLOWED`, and `routePolicyResult: ALLOWED`

The same probe under an identity without learning invoker permission produced Cloud Run `403` responses for both routes. No IAM was added. No `tm.learning.decision` event occurred on revision `00006`, confirming the read proof did not create or confirm learning records. The temporary job was deleted.

### 18.4 Fresh workflow continuation and next blocker

The original failed request's idempotency key was not present in its durable artifact, so it was not guessed. A fresh request reused the same authoritative v2, action, verified evidence, and adaptive subject with idempotency key `wave4-fixc-1787411441830`.

- workflow: `wf-b14269dcb66c68b2960c780c`
- intent: `intent-travel-repair12-1787407705567`
- state: `state-intent-travel-repair12-1787407705567-semantic-4348239a7d98dc90`
- plan: `plan-wf-b14269dcb66c68b2960c780c`
- plan verification: `plan-verification-wf-b14269dcb66c68b2960c780c`
- Guardian: `ALLOW`
- Adaptive Authority reads allowed:
  - agent and counterparty trust tips
  - `refundable` preference and workflow rule
  - `delivery_terms` preference and workflow rule
- final Authority decision: `ALLOW`
- evaluation: `evaluation-wf-b14269dcb66c68b2960c780c-authority-wf-b14269dcb66c68b2960c780c`

First new closure-grade failure:

- `materializationEligible: false`
- `materializationReason: MISSING_TEMPORAL_AUTHORITY`
- workflow remains at `AUTHORITY_EVALUATION`
- no PREPARE, AUTHORIZE, COMMIT, MonitoringContract, or OutcomeContract was created

Execution stopped at this first new blocker. Guardian, Adaptive Authority, trust scoring, learning semantics, Monitoring, Gateway, DomainPacks, evidence, and readiness were not changed.

**WAVE 4 PRODUCTION CLOSED = NO**

## 17. Repair 12 live proof: canonical concepts and independent completeness

### 17.1 Narrow deployment

- deploy timestamp: Saturday, August 22, 2026
- service changed: `tm-dev-agent-runtime` only
- prior revision: `tm-dev-agent-runtime-00032-4bz`
- ready revision: `tm-dev-agent-runtime-00033-7hw` at 100% traffic
- image digest: `sha256:764994a0bb6bdcd3c622a09838d9c3a42cb3485c739a06a83cf8b6297c31633a`
- Terraform saved-plan result: `0 add, 1 change, 0 destroy`
- Terraform delta: only the `agent-runtime` container image changed; IAM, ingress, environment, identity, and all unrelated services were unchanged
- `terraform validate`: passed
- `terraform fmt -check`: reported the pre-existing unformatted runtime-stage `main.tf`; no unrelated formatting was changed

### 17.2 Fresh authoritative travel state

- acceptance intent: `intent-travel-repair12-1787407705567`
- v1 state: `state-intent-travel-repair12-1787407705567-compiled-185a21dca07260b5`
- v1 state hash: `99beb4423e9b25bb06bab2b0c0e94e799f8d4f03a6fd319242598c6b9f9c6cab`
- v1 semantic artifact: `semantic-verification-state-intent-travel-repair12-1787407705567-compiled-185a21dca07260b5`
- v1 semantic artifact hash: `c7da0cf43a678e5fafbdcf087bc2ea34ce7570f891e8f89e8180f256cab8153d`
- v1 readiness / ambiguity: `PLANNABLE / A1`
- constraints: `approved_provider`, `property_name`, `refundable`, `total_budget`, `hotel_stay_count`, `stay_start_date`, and `completion_deadline`
- the fresh compiler assigned the date constraint id `c-stay-start-date` rather than the prior run's `c-date-5`; the required live concept was exactly `stay_start_date`

Public candidate evidence was submitted through the governed production seam. Public readback remained `UNTRUSTED_EXTERNAL`. The existing `phase-c-verifier` identity created immutable `ELEVATED_EXTERNAL` derivatives; acceptance fixtures were not used.

### 17.3 Live proof table and completeness result

| constraintId | concept | obligationId | verified evidence | result |
| --- | --- | --- | --- | --- |
| `c-refundable` | `refundable` | `3c34499bb3609b0cc79ff6b1a8ac55c29c71b45cca141b4740d6223bc24bfaf6` | `ev-repair12-1787407705567-refund-verified-verify-repair12-1787407705567-refund` | `SATISFIED` |
| `c-stay-count` | `hotel_stay_count` | `f5bee0e7e5a6f43210997cf8d729167d6598706c11dc75286c889e6b6fe206dd` | `ev-repair12-1787407705567-count-verified-verify-repair12-1787407705567-count` | `SATISFIED` |
| `c-property-name` | `property_name` | `4d33bc254015f0dae73ed021619a5aa4b8954306d7634f91118c1d75413f8b3b` | `ev-repair12-1787407705567-property-verified-verify-repair12-1787407705567-property` | `SATISFIED` |
| `c-approved-provider` | `approved_provider` | `244ea49e8dc22f6ac9d3b7dabab1d9631546095ff75470c1687b22c8629b2373` | `ev-repair12-1787407705567-provider-verified-verify-repair12-1787407705567-provider` | `SATISFIED` |
| `c-stay-start-date` | `stay_start_date` | `8fb248a5296712ef14fa33c779b82425f46b9049c57d8b73aaac0bfd9e8231c2` | `ev-repair12-1787407705567-staystart-verified-verify-repair12-1787407705567-staystart` | `SATISFIED` |
| `c-total-budget` | `total_budget` | `2a303dd40417005dbc93a4ca967ae19f4515fa2fe951ca76b3b30ebc1b0f9c8d` | `ev-repair12-1787407705567-budgetok-verified-verify-repair12-1787407705567-budgetok` | `SATISFIED` |
| `c-completion-deadline` | `completion_deadline` | `a2e60954473a14591e85a96fd0f27f9be1ce5b3b48c7903caa2e10b1a0a7cb20` | `ev-repair12-1787407705567-deadline-verified-verify-repair12-1787407705567-deadline` | `SATISFIED` |

Positive live coverage:

- `requiredConstraintIds`, `derivedObligationConstraintIds`, and `evaluatedConstraintIds` contain the same seven ids, including `c-stay-start-date`
- `missingObligationConstraintIds: []`
- `missingEvaluationConstraintIds: []`
- `incompleteDeterministicRuleIds: []`
- `allRequiredCovered: true`

Negative live coverage:

- omitting verified stay-start evidence left its row `UNKNOWN` and returned `superseded: false`
- a mutation-free check against the deployed `assessProofCoverage` deliberately removed `c-stay-start-date` from both obligations and evaluations while retaining it in the independently classified authoritative denominator
- the gate returned `missingObligationConstraintIds: ["c-stay-start-date"]`, `missingEvaluationConstraintIds: ["c-stay-start-date"]`, and `allRequiredCovered: false`

An initial controlled budget claim equal to `5000` correctly failed the authoritative `LT 5000` rule as `UNSATISFIED`; it produced no successor. A new immutable claim for `4999` was then verified and satisfied the constraint. No evidence row was overwritten and no comparison was weakened.

### 17.4 Supersession and planner proof

- v1 state and semantic artifact remained immutable at their recorded hashes
- v2 state: `state-intent-travel-repair12-1787407705567-semantic-4348239a7d98dc90`
- v2 state hash: `71ce1d5b0d95362837e3425421919086d34b47f238cdd30349363da957d0cafd`
- v2 semantic artifact: `semantic-verification-state-intent-travel-repair12-1787407705567-semantic-4348239a7d98dc90`
- v2 semantic artifact hash: `6d926b87764dd9b71d1e8f71b7022bc895a6d9c25486a001ffb1ff1b7b7f62c6`
- v2 semantic verdict: `semantic-verdict-34f99e4eff6f4547`
- v2 readiness / ambiguity: `ACTIONABLE / A0`
- v2 `previousStateId`: v1 state id
- current public workspace tip: v2

Workflow `wf-fb97ddcff3a5c53590c09ff6` used the authoritative v2 snapshot:

- plan artifact: `plan-wf-fb97ddcff3a5c53590c09ff6`
- plan id: `plan-intent-travel-repair12-1787407705567-v1-46d5f276`
- plan semantic verdict: `semantic-verdict-34f99e4eff6f4547`
- plan readiness / ambiguity snapshot: `ACTIONABLE / A0`
- plan steps: `step-1-verify-offer`, privileged `step-2-execute-booking` using `book_travel`, and `step-3-verify-outcome`
- plan-verification artifact: `plan-verification-wf-fb97ddcff3a5c53590c09ff6`
- plan-verification status: `VERIFIED`
- plan-verification verdict: `plan-verdict-95bbb03365c4`
- `criticalFailure: false`; no `MISSING_PROOF_OBLIGATION`, stale-semantics `INAPPROPRIATE_COMMITMENT`, or `PLAN_STALE`
- Guardian artifact: `guardian-wf-fb97ddcff3a5c53590c09ff6`
- Guardian used the same v2 state hash and returned `ALLOW / CLEAR`

### 17.5 First new closure-grade failure

The workflow stopped at Adaptive Authority signal retrieval:

- trace: `f2117038930e23ded81be5199d027464`
- Authority revision: `tm-dev-authority-00014-krj`
- learning revision: `tm-dev-learning-service-00005-lfl`
- Authority authentication to learning-service succeeded as `tm-dev-authority@elite-crossbar-505104-t9.iam.gserviceaccount.com`
- learning route policy denied both:
  - `GET /internal/trust-signals/AGENT/agent-runtime/travel -> 403`
  - `GET /internal/trust-signals/COUNTERPARTY/travel-provider/travel -> 403`
- deployed learning-service environment contains duplicate `TM_INTERNAL_ALLOWED_CALLERS` entries:
  - first value includes `phase-c-verifier` and `authority`
  - later value includes only `phase-c-verifier`
- the later duplicate wins in the running process, so the authenticated Authority caller is denied
- `/internal/authority/evaluate -> 400`; public workflow returned fail-closed `VALIDATION_FAILED`
- no final Adaptive Authority decision, MonitoringContract, PREPARE, AUTHORIZE, COMMIT, or OutcomeContract was materialized

The temporary private operator job was deleted after evidence collection. No learning configuration, auth policy, Guardian, Authority, Monitoring, Gateway, or evidence trust behavior was changed after this failure.

**WAVE 4 PRODUCTION CLOSED = NO**

## 16. Closure Live Proof 11: Semantic Ambiguity Reconciliation

Date: Saturday, August 22, 2026.

### 16.1 Validation and narrow deployment

The locally completed Debug 11 change was revalidated before deployment:

- semantic-readiness, pre-execution readiness, semantic supersession, plan-verifier, and procurement shared-path suites: `7` files / `58` tests passed
- builds passed for `@truemandate/semantic-readiness`, `@truemandate/plan-verifier`, `@truemandate/intent-service`, and `@truemandate/agent-runtime`

Only the two planned runtime images changed. The saved Terraform plan was `0 add, 2 change, 0 destroy` and changed only image references; it contained no IAM, ingress, environment, identity, or unrelated service delta.

| Service | Image digest | Ready revision |
| --- | --- | --- |
| `agent-runtime` | `sha256:9e2b28e591d964740e5ad8f0b3579508b3f5833c6714bc82e42e285906b9ac59` | `tm-dev-agent-runtime-00032-4bz` |
| `intent-provenance` | `sha256:2234af2fc828778173e798c0e0cce579301a8ad6aa686aac0eb09d5fc7f60a1a` | `tm-dev-intent-provenance-00029-8nt` |

### 16.2 Fresh ambiguity and trusted-evidence proof

Fresh public RAW intent:

- intent: `intent-d9d1c7d8fa8e`
- raw intent hash: `280c7f8c73ba6f887335c19ab935623905b1cf7e5e3ba437e008364e8f39ed98`
- v1 state: `state-intent-d9d1c7d8fa8e-compiled-8d7fc9f633163edb`
- v1 state hash: `0cc12de65bf8028db3749c6ee9bf07ab2d81aca642c367f7d740f3c5242071ea`
- v1 semantic artifact: `semantic-verification-state-intent-d9d1c7d8fa8e-compiled-8d7fc9f633163edb`
- v1 semantic artifact hash: `dd639218d82da06bf7e510637714741fe271340ec73e642db0d1828634a87017`
- v1 verdict: `verdict-6c954dd69739`
- v1 readiness/lifecycle/ambiguity: `PLANNABLE / AMBIGUOUS / A2`
- immutable compilation: `compilation-intent-d9d1c7d8fa8e-c87df11478d7ff4c`
- ambiguity: `amb-approved-provider`, related to `provider_approval_status`, because the approved-provider registry/criteria was unspecified

Seven lineage-bound candidates were submitted publicly under prefix `ev-debug11-1787402608400-*`. Public readback continued to report `UNTRUSTED_EXTERNAL`. The existing `phase-c-verifier` path created immutable `ELEVATED_EXTERNAL` derivatives under the corresponding `*-verified-verify-debug11-1787402608400-*` ids. The temporary private operator job was deleted after evidence collection.

The controlled negative proof omitted only verified provider evidence:

- all other evaluated rows were `SATISFIED`
- provider row was `UNKNOWN`
- ambiguity remained `A2` with `amb-approved-provider` unresolved
- readiness remained `PLANNABLE`
- `superseded = false`

The positive ambiguity proof included provider evidence:

- `amb-approved-provider` mapped to constraint `c-provider-4`
- its proof row was `SATISFIED` with `ELEVATED_EXTERNAL` evidence
- ambiguity reconciliation returned `A0`
- successor lifecycle/readiness became `VERIFIED / ACTIONABLE`
- v2 state: `state-intent-d9d1c7d8fa8e-semantic-ceb1eeda28a3489d`
- v2 state hash: `7abea042fd6bf116252951c99434015476cc80eeef3162e93e1a8a25b3a3b183`
- v2 semantic artifact: `semantic-verification-state-intent-d9d1c7d8fa8e-semantic-ceb1eeda28a3489d`
- v2 semantic artifact hash: `f7d7385407a2c34834a157d43e3c4b15a43b996d0f8f90bfe7344f0c701b98c1`
- regenerated verdict: `semantic-verdict-82335f1bece70fc1`
- v2 `previousStateId` points to v1 and the public workspace tip points to v2
- v1 artifact remained unchanged at its recorded hash

### 16.3 Next closure-grade failure

Execution stopped before Planner because the same live readiness result exposed an incomplete required-constraint set:

- authoritative constraint `c-date-5`
- concept `stay_start_date`
- kind `TEMPORAL`
- operator/value `EQ / 2026-12-20`
- verified candidate and derivative date evidence both existed
- no proof obligation or evaluated proof row was produced for `c-date-5`

The positive supersession evaluated only six required constraints:

`c-budget-6, c-deadline-7, c-property-3, c-provider-4, c-quantity-1, c-refundable-2`

Exact predicate failure:

- travel declares execution-critical patterns `travel_date` and `stay_date`
- generic matching is normalized substring matching
- compiled concept `stay_start_date` contains neither declared pattern
- `c-date-5` is not the `temporalAuthority.sourceRef` (`c-deadline-7` is), so the temporal-authority fallback does not include it
- the completeness gate derives its required set through that same predicate, so it incorrectly reported complete and allowed an `ACTIONABLE` v2 with only six proof rows

This is the first new closure-grade failure. A required execution date disappeared from proof coverage during semantic supersession. No workflow was submitted and no Plan, Guardian, Authority, Monitoring, Gateway, or execution mutation was produced from this incomplete successor.

Not executed after this failure:

- v2 planner/full semantic binding proof
- `PLAN_VERIFICATION = PASS`
- controlled `PLAN_STALE` proof
- deployed A3/A4 operator proof
- Guardian/Authority/Monitoring continuation
- remaining Wave 4 production matrix

**WAVE 4 PRODUCTION CLOSED = NO**

- `outcome-resolution`
  - route: `POST /internal/outcomes/:outcomeContractId/evaluate-evidence`
  - deployed revision: `tm-dev-outcome-resolution-00026-8pk`
  - authorized caller identity:
    - `tm-dev-phase-c-verifier@elite-crossbar-505104-t9.iam.gserviceaccount.com`
  - durable artifacts consumed / updated:
    - reads accepted `EvidenceClaim` + `EvidenceEnvelope`
    - applies observations to an existing `OutcomeContract`
  - trust / semantic effect:
    - outcome-side verification only
    - does **not** supersede pre-execution `IntentState` semantic verification
    - does **not** recompute planner readiness

Conclusion for Repair 9:

- there is currently **no deployed pre-execution evidence verification path** on `tm-dev` that feeds back into:
  - `semantic-verification-*`
  - `IntentState` tip supersession
  - planner privileged readiness selection

### 11.3 Fresh RAW travel proof artifacts

Fresh live intent created through the repaired public path:

- public route:
  - `tm-dev-web -> tm-dev-public-bff -> tm-dev-intent-provenance`
- `intentId`:
  - `intent-travel-liveproof9-1787389463`
- `POST /v1/intents`:
  - `200`
- finalized `intentStateId`:
  - `state-intent-travel-liveproof9-1787389463-compiled-45fa3c7ffb48c071`
- workspace:
  - `GET /v1/workspace/intent-travel-liveproof9-1787389463` -> `200`

Fresh finalized travel constraints present in the durable/public view:

- `c-quantity` -> `room_quantity = 2`
- `c-refundable` -> `refundable_rate = true`
- `c-property` -> `property_name = "Taj Palace Mumbai"`
- `c-checkin` -> `check_in_date = 2026-12-20`
- `c-checkout` -> `check_out_date = 2026-12-22`
- `c-provider` -> `service_provider = "Taj Hotels"`
- `c-budget` -> `total_budget < 45000`
- `c-deadline` -> `booking_completion_deadline <= 2026-11-30`

Durable semantic verification for the same finalized tip:

- artifact id:
  - `semantic-verification-state-intent-travel-liveproof9-1787389463-compiled-45fa3c7ffb48c071`
- lifecycle:
  - `VERIFIED`
- readiness:
  - `PLANNABLE`
- ambiguity class:
  - `A1`
- model proposed readiness:
  - `PLANNABLE`
- artifact update time:
  - `2026-08-22T09:06:56.169507Z`

### 11.4 New closure-grade blocker reached before workflow submit

To test whether public evidence could at least bind durable lineage before any privileged workflow step, a fresh governed evidence submission was attempted with:

- `intentId = intent-travel-liveproof9-1787389463`
- `intentStateId = state-intent-travel-liveproof9-1787389463-compiled-45fa3c7ffb48c071`

Observed live result:

- `POST /v1/evidence` -> `400`
- error:
  - `VALIDATION_FAILED`
  - `Unknown evidence lineage intent`

This is a real runtime seam defect, not a malformed-route/auth issue:

- `services/evidence-service/src/submissions.ts`
  - `validateEvidenceSubmissionLineage(...)` calls:
    - `getIntent(intentId)`
    - `getIntentState(intentStateId)`
    - `listWorkflowArtifacts(workflowId)` when supplied
    - `getOutcomeContract(outcomeContractId)` when supplied
- deployed `tm-dev-evidence-service-00012-2th` has:
  - `INTENT_PROVENANCE_URL` configured
  - `OUTCOME_RESOLUTION_URL` configured
- but live Cloud Run IAM shows `tm-dev-evidence-service@elite-crossbar-505104-t9.iam.gserviceaccount.com` is **not** an invoker on:
  - `tm-dev-intent-provenance`
  - `tm-dev-outcome-resolution`

So the current public evidence submission seam is live for submission-only payloads, but lineage-bound submissions cannot validate against the owners on `tm-dev`.

### 11.5 Why this stops Repair 9

Repair 9 required a clean distinction between:

1. fixed travel proof-obligation coverage in `agent-runtime`
2. legitimate evidence verification/operator paths
3. any deployed path that can recompute or supersede privileged readiness pre-execution

The live stack currently fails before step 3 can even be exercised safely:

- no deployed pre-execution verifier path writes a new `semantic-verification-*`
- public evidence lineage binding to the fresh intent fails closed at `POST /v1/evidence`
- the finalized travel semantic artifact remains:
  - `PLANNABLE`
  - `A1`
  - unchanged at `2026-08-22T09:06:56.169507Z`

Because of that, this pass stops **before workflow submission**. Proceeding further would require assuming trusted pre-execution evidence/recompute behavior that the deployed stack does not currently provide.

## 12. Current blocker after Repair 9

**WAVE 4 PRODUCTION CLOSED = NO**

Next closure-grade blocker on `tm-dev`:

- area:
  - public evidence lineage + pre-execution semantic readiness supersession
- fresh live intent:
  - `intent-travel-liveproof9-1787389463`
- finalized tip:
  - `state-intent-travel-liveproof9-1787389463-compiled-45fa3c7ffb48c071`
- first failing live proof step:
  - `POST /v1/evidence` with valid fresh `intentId` + `intentStateId` lineage
- live error:
  - `VALIDATION_FAILED`
  - `Unknown evidence lineage intent`
- proven underlying seam:
  - `evidence-service` lineage validator depends on owner reads
  - deployed `evidence-service` lacks Cloud Run invoker access to `intent-provenance` and `outcome-resolution`
- architecture consequence:
  - no legitimate pre-execution path currently exists on `tm-dev` to both:
    - bind verified evidence to the fresh travel intent lineage
    - supersede the finalized `PLANNABLE` semantic readiness before workflow planning

Wave 4 production closure remains open until that seam is repaired and a fresh travel proof can legitimately advance from:

- finalized RAW travel `IntentState`
- to bound/verified pre-execution evidence
- to readiness sufficient for privileged workflow planning
- to live Guardian / Authority / Monitoring materialization

## 13. Repair 10 deploy and live pre-execution evidence proof

Date of record: **Saturday, August 22, 2026**

### 13.1 Narrow deploy completed

Only the Repair 10 runtime surfaces were redeployed in this pass:

| Service | Ready revision | Image digest |
|---|---|---|
| `tm-dev-evidence-service` | `tm-dev-evidence-service-00013-fvz` | `sha256:d376002578892e718a5bc41c42df681a9a45dd97fda816016f149b16ee8db954` |
| `tm-dev-agent-runtime` | `tm-dev-agent-runtime-00030-5hn` | `sha256:8ca986f946b6bc85c50196b111c57e6b574dfd070b9be412304b1c5e52676c2f` |
| `tm-dev-intent-provenance` | `tm-dev-intent-provenance-00028-6d6` | `sha256:b009c59b0ab20de3a7b5a34c2d7bd927c909540d409b2d4649550094e1327439` |

Runtime Terraform apply for this pass:

- `2 added, 4 changed, 0 destroyed`
- new invoker edges applied:
  - `evidence-service -> intent-provenance`
  - `evidence-service -> outcome-resolution`
- env / caller policy changes applied:
  - `TM_EVIDENCE_VERIFY_CALLER_EMAILS = tm-dev-phase-c-verifier@elite-crossbar-505104-t9.iam.gserviceaccount.com`
  - `TM_PRE_EXECUTION_READINESS_CALLER_EMAILS = tm-dev-phase-c-verifier@elite-crossbar-505104-t9.iam.gserviceaccount.com`
  - `TM_SEMANTIC_SUPERSESSION_CALLER_EMAILS = tm-dev-agent-runtime@elite-crossbar-505104-t9.iam.gserviceaccount.com`
  - `tm-dev-evidence-service@elite-crossbar-505104-t9.iam.gserviceaccount.com` added to:
    - `tm-dev-intent-provenance` `TM_INTERNAL_ALLOWED_CALLERS`
    - `tm-dev-outcome-resolution` `TM_INTERNAL_ALLOWED_CALLERS`

Route isolation re-verified on the deployed code/config before the live run:

- `POST /internal/evidence/verifications` remains separate from `/internal/evidence/acceptance-fixtures`
- `POST /internal/pre-execution-readiness` remains a dedicated `agent-runtime` route, not a procurement alias
- `POST /internal/intent-states/:id/semantic-supersession` remains separate from general intent creation/state routes

### 13.2 Fresh RAW travel intent proof

Fresh public RAW travel intent:

- `intentId`
  - `intent-travel-liveproof10-1787394228507`
- `POST /v1/intents`
  - `200`
- finalized tip:
  - `state-intent-travel-liveproof10-1787394228507-compiled-3d6405690fb36142`
- public workspace:
  - `GET /v1/workspace/intent-travel-liveproof10-1787394228507` -> `200`

Finalized `IntentState` v1 / semantic verification v1:

- `intentStateId` v1
  - `state-intent-travel-liveproof10-1787394228507-compiled-3d6405690fb36142`
- `semanticVerificationId` v1
  - `semantic-verification-state-intent-travel-liveproof10-1787394228507-compiled-3d6405690fb36142`
- readiness v1
  - `PLANNABLE`
- lifecycle v1
  - `AMBIGUOUS`
- ambiguity class
  - `A2`

The compiled travel constraints were the intended live-shape set for Repair 10:

- `c1` -> `property_name = "Seaside Lodge"`
- `c2` -> `refundable = true`
- `c3` -> `total_budget <= 5000`
- `c4` -> `hotel_stay_count = 2`
- `c5` -> `stay_date = 2026-12-20`
- `c6` -> `completion_deadline <= 2026-12-31`
- `c7` -> `approved_provider = true`

This confirms the RAW intent/compiler/finalization chain is healthy for the fresh Repair 10 travel proof.

### 13.3 First live blocker in Repair 10

The first live blocker occurred at the **candidate evidence submission** stage, before verifier-only evidence verification or pre-execution readiness could run.

Fresh public lineage-bound evidence submission:

- envelope id:
  - `ev-travel-liveproof10-1787394504295`
- claim ids:
  - `claim-travel-liveproof10-provider-1787394504295`
  - `claim-travel-liveproof10-property-1787394504295`
  - `claim-travel-liveproof10-refund-1787394504295`
  - `claim-travel-liveproof10-budget-1787394504295`
  - `claim-travel-liveproof10-count-1787394504295`
  - `claim-travel-liveproof10-staydate-1787394504295`
  - `claim-travel-liveproof10-deadline-1787394504295`
- lineage supplied:
  - `intentId = intent-travel-liveproof10-1787394228507`
  - `intentStateId = state-intent-travel-liveproof10-1787394228507-compiled-3d6405690fb36142`

Observed live result:

- `POST /v1/evidence` -> `400`
- error:
  - `VALIDATION_FAILED`
  - `Unknown evidence lineage intent`
- public readback:
  - `GET /v1/evidence/ev-travel-liveproof10-1787394504295` -> `404`
  - no candidate evidence was durably created

The route auth itself succeeded:

- `tm-dev-evidence-service-00013-fvz`
  - `internal_auth_verification`
  - `method: POST`
  - `path: /internal/evidence/submissions`
  - `verification: SUCCEEDED`
  - `verifiedCallerEmail: tm-dev-public-bff@elite-crossbar-505104-t9.iam.gserviceaccount.com`
  - `routePolicyResult: ALLOWED`

But the expected owner lineage read never reached `intent-provenance` from `evidence-service`:

- `tm-dev-intent-provenance-00028-6d6` shows fresh owner reads from:
  - `tm-dev-public-bff@elite-crossbar-505104-t9.iam.gserviceaccount.com`
  - `tm-dev-agent-runtime@elite-crossbar-505104-t9.iam.gserviceaccount.com`
- no corresponding fresh owner read appears from:
  - `tm-dev-evidence-service@elite-crossbar-505104-t9.iam.gserviceaccount.com`

### 13.4 Proven live root cause

The deploy applied the new **invoker edges** and **application allowlists**, but the live service topology still leaves `evidence-service` unable to originate internal-only owner reads.

Confirmed live posture:

- `tm-dev-intent-provenance`
  - has `roles/run.invoker` for `tm-dev-evidence-service@elite-crossbar-505104-t9.iam.gserviceaccount.com`
  - `TM_INTERNAL_ALLOWED_CALLERS` includes `tm-dev-evidence-service@elite-crossbar-505104-t9.iam.gserviceaccount.com`
- `tm-dev-evidence-service`
  - has `INTENT_PROVENANCE_URL` and `OUTCOME_RESOLUTION_URL` set correctly
  - **does not** have the internal network annotations present on the working internal callers
  - deployed service description lacks:
    - `run.googleapis.com/network-interfaces`
    - `run.googleapis.com/vpc-access-egress`
- Terraform source confirms the same omission:
  - `local.vpc_callers` currently includes:
    - `public-bff`
    - `agent-runtime`
    - `intent-provenance`
    - `authority`
    - `gateway`
    - `outcome-resolution`
  - `evidence-service` is **not** included

This is the first proven closure-grade blocker in Repair 10:

- the new lineage-validation seam is deployed
- auth / route allowlists are deployed
- but `evidence-service` is not on the internal-network caller set used by the other `INTERNAL_ONLY` owner-call services
- as a result, the public candidate-evidence submission fails closed before:
  - verifier-only evidence verification
  - pre-execution readiness evaluation
  - semantic supersession
  - workflow submission from the superseded tip

### 13.5 Repair 10 stop point

Per the live-proof contract, this pass stops at the first closure-grade failure.

Not executed in this pass because the public candidate evidence never bound durably:

- `POST /internal/evidence/verifications`
- `POST /internal/pre-execution-readiness`
- semantic supersession replay checks
- fresh workflow submission from `IntentState` v2
- monitoring materialization continuation

## 14. Current blocker after Repair 10 deploy + live proof

**WAVE 4 PRODUCTION CLOSED = NO**

Latest closure-grade blocker on `tm-dev`:

- area:
  - pre-execution evidence lineage / verification ingress
- fresh live intent:
  - `intent-travel-liveproof10-1787394228507`
- finalized tip:
  - `state-intent-travel-liveproof10-1787394228507-compiled-3d6405690fb36142`
- first failing live proof step:
  - `POST /v1/evidence` with valid fresh `intentId` + `intentStateId` lineage
- live error:
  - `VALIDATION_FAILED`
  - `Unknown evidence lineage intent`
- proven root cause:
  - `evidence-service` is still missing the internal-network caller posture used for outbound calls to `INTERNAL_ONLY` owner services
  - the new invoker + caller allowlists are present, but the owner-read call never reaches `intent-provenance`

Wave 4 production closure remains open until this owner-call networking gap is repaired and the live chain can legitimately continue from:

- public untrusted evidence submission
- to verifier-only evidence verification
- to pre-execution readiness evaluation
- to authoritative semantic supersession
- to workflow submission from the new tip

## 15. Repair 10 Live Fix A — evidence-service internal VPC caller wiring

### 15.1 Terraform change and deployment

The proven owner-read networking gap was repaired by adding only `evidence-service` to the existing runtime `local.vpc_callers` set.

Validation and plan gate:

- runtime Terraform validation: `PASS`
- edited runtime module format check: `PASS`
- saved plan: `tfplan.wave4-repair10-fixa`
- planned actions: `0 add, 1 change, 0 destroy`
- only changed resource:
  - `module.runtime.google_cloud_run_v2_service.runtime["evidence-service"]`
- accepted template delta:
  - VPC network: `projects/elite-crossbar-505104-t9/global/networks/tm-dev-s2s`
  - VPC subnet: `projects/elite-crossbar-505104-t9/regions/us-central1/subnetworks/tm-dev-s2s-usc1`
  - egress: `ALL_TRAFFIC`
  - startup probe: `initialDelaySeconds 0 -> 10`, `timeoutSeconds 1 -> 3`, `failureThreshold 3 -> 12`
- unchanged by the plan:
  - `INGRESS_TRAFFIC_INTERNAL_ONLY`
  - configured image digest
  - service account
  - environment / caller policies
  - Cloud Run IAM bindings

Apply result:

- `0 added, 1 changed, 0 destroyed`
- deployed at: `2026-08-22T10:47:14.978808Z`
- ready revision: `tm-dev-evidence-service-00014-5dg`
- configured image digest: `sha256:d376002578892e718a5bc41c42df681a9a45dd97fda816016f149b16ee8db954`
- resolved revision image digest: `sha256:5b428e672e9c9dd8c78ef5e41cf523f039a3c9deae480ea9476cff6e242cbb26`
- service identity: `tm-dev-evidence-service@elite-crossbar-505104-t9.iam.gserviceaccount.com`
- ingress remained `internal`
- revision annotations contain the expected `tm-dev-s2s` network/subnet and `all-traffic` egress

### 15.2 Lineage-bound evidence proof

The exact request that previously failed was replayed without changing its lineage or artifact ids:

- `intentId`: `intent-travel-liveproof10-1787394228507`
- `intentStateId`: `state-intent-travel-liveproof10-1787394228507-compiled-3d6405690fb36142`
- candidate envelope: `ev-travel-liveproof10-1787394504295`
- `POST /v1/evidence`: `200`
- `GET /v1/evidence/ev-travel-liveproof10-1787394504295`: `200`
- durable/public trust class: `UNTRUSTED_EXTERNAL`

Correlated service evidence:

- `tm-dev-evidence-service-00014-5dg`
  - `POST /internal/evidence/submissions` -> `200`
  - verified caller: `tm-dev-public-bff@elite-crossbar-505104-t9.iam.gserviceaccount.com`
- `tm-dev-intent-provenance-00028-6d6`
  - `GET /internal/intents/intent-travel-liveproof10-1787394228507` -> `200`
  - `GET /internal/intent-states/state-intent-travel-liveproof10-1787394228507-compiled-3d6405690fb36142` -> `200`
  - verified caller for both reads: `tm-dev-evidence-service@elite-crossbar-505104-t9.iam.gserviceaccount.com`

Fail-closed lineage regression:

- foreign envelope: `ev-travel-liveproof10-foreign-1787395986065`
- foreign intent: `intent-does-not-exist-1787395986065`
- submission result: `400 VALIDATION_FAILED / Unknown evidence lineage intent`
- readback result: `404`
- no foreign artifact persisted

This closes the internal-network caller defect without changing owner ingress, authentication, caller policies, verifier permissions, or evidence trust semantics.

### 15.3 Verifier-only evidence and readiness continuation

A temporary private Cloud Run operator execution used the existing `phase-c-verifier` identity and VPC posture. The temporary job was deleted after evidence collection.

Trust-boundary results:

- presenting the original candidate to pre-execution readiness failed closed:
  - `400 VALIDATION_FAILED`
  - `Pre-execution readiness requires verified/trusted evidence`
- verification id: `verify-travel-liveproof10-1787394504295`
- original envelope before verification: `UNTRUSTED_EXTERNAL`
- original envelope after verification: `UNTRUSTED_EXTERNAL`
- derivative envelope:
  - `ev-travel-liveproof10-1787394504295-verified-verify-travel-liveproof10-1787394504295`
  - trust class: `ELEVATED_EXTERNAL`
  - provenance records `verified-by:tm-dev-phase-c-verifier@elite-crossbar-505104-t9.iam.gserviceaccount.com`
- all seven derivative claim ids were created in the existing durable evidence model

The readiness call evaluated and satisfied these obligations using the derivative evidence:

| Constraint | Concept | Obligation | Result |
| --- | --- | --- | --- |
| `c1` | `property_name` | `d2a564d90d1158aae95cce3b9fd33b0167a5bb89324876e20152e8484e7d2eb9` | `SATISFIED` |
| `c2` | `refundable` | `fd5aa25c41afc120a60c0cef15933fc45de4968480b1bf1f5819efc4dc39f197` | `SATISFIED` |
| `c3` | `total_budget` | `77bee7a8a1da0a7f898f8452ee612b74b28ac4717a801e081fdb1799aa64ba23` | `SATISFIED` |
| `c4` | `hotel_stay_count` | `9c7e852042166f117c33257533f5e237945455d3619b0c0c55629b4738f790db` | `SATISFIED` |
| `c5` | `stay_date` | `a7537ac2f6d5b9f4bd1c1e1d3e05039226a9ff46221f631b6063cb9e06d3da21` | `SATISFIED` |
| `c7` | `approved_provider` | `f34acfa338d68c3164b942f07ad68236ee887878aba0d010b4c2c61a37252b68` | `SATISFIED` |

The path then created an authoritative successor:

- v1 state: `state-intent-travel-liveproof10-1787394228507-compiled-3d6405690fb36142`
- v1 readiness: `PLANNABLE`
- v2 state: `state-intent-travel-liveproof10-1787394228507-semantic-79e4d41b5977c2e8`
- v2 state hash: `146bd734474454bb8f4c02456d3aa87048b710e4eb19a4b7f18e885664043c15`
- v2 version: `2`
- v2 `previousStateId`: v1 state id
- v2 semantic artifact: `semantic-verification-state-intent-travel-liveproof10-1787394228507-semantic-79e4d41b5977c2e8`
- v2 semantic artifact hash: `5a47d003ecc9d40bff4930b345a4e401667451ab37a677d7dbc3920cc6fee616`
- current durable/public workspace tip: v2

### 15.4 Next closure-grade failure

Repair 10 stopped before planner/workflow submission because the live readiness table omitted an authoritative constraint:

- omitted constraint: `c6`
- concept: `completion_deadline`
- authoritative value: `2026-12-31`
- submitted derivative claim existed:
  - `claim-travel-liveproof10-deadline-1787394504295-verified-verify-travel-liveproof10-1787394504295`
- observed behavior:
  - no `completion_deadline` proof obligation was derived
  - no proof row evaluated the verified deadline claim
  - readiness nevertheless reported all derived rows satisfied and created v2

Source correlation explains the omission:

- `completion_deadline` is a `TEMPORAL` constraint
- the v1 state has no matching `temporalAuthority.sourceRef`
- the travel `executionCriticalConstraintConcepts` include `stay_date` and travel/check-in/check-out patterns but not `completion_deadline` / deadline
- deterministic obligation derivation therefore excludes `c6`

This violates the Repair 10 live acceptance requirement that provider, property, refundability, budget, completion deadline, stay count, and stay date all be evaluated before readiness supersession.

Not executed after this failure:

- semantic supersession replay/divergence live proof
- planner source-of-truth proof
- `PLAN_VERIFICATION`
- Guardian / Adaptive Authority
- MonitoringContract materialization

**WAVE 4 PRODUCTION CLOSED = NO**

## 21. Repair 15: canonical execution-authorization artifact

### 21.1 Canonical contract and local validation

The owner/runtime artifact contract now has one canonical schema in `@truemandate/schemas`. Historical semantic artifact kinds remain additive and unchanged, and the canonical kind set now admits `EXECUTION_AUTHORIZATION`.

The internal authorization payload is strict and contains only the durable binding needed for workflow-id commit resolution: IntentState id/hash, workflow id, pack id, internal commit-token id, prepared-action id/hash, grant id, and OutcomeContract id/hash. Intent-provenance additionally requires:

- artifact id `execution-authorization-${workflowId}`
- matching envelope and payload workflow ids
- current IntentState binding
- exactly one same-workflow `WORKFLOW` predecessor
- owner-computed hash, immutable persistence, idempotent identical replay, and divergent-replay conflict

Persistence remains passive. It does not call Gateway or perform COMMIT. Public workflow projections remain allowlisted and do not expose the artifact payload, grant, prepared action, or CommitToken.

Validation results:

- schemas + intent owner focused suites: `34 passed`
- generic procurement and multi-domain lifecycle suites: `38 passed`
- public API, Gateway, and commit-token integrity suites: `42 passed`
- broader schemas/intent/Firestore suites: `118 passed`, `32 emulator-only skipped`
- broader agent-runtime/public API suites: `292 passed`
- affected builds passed:
  - `@truemandate/schemas`
  - `@truemandate/cloud-firestore`
  - `@truemandate/intent-service`
  - `@truemandate/agent-runtime`
- runtime `terraform validate`: `PASS`
- `terraform fmt -check` continues to report the pre-existing runtime `main.tf` formatting delta; no unrelated formatting rewrite was made in this repair

The regression set proves internal persistence, strict workflow lineage, replay behavior, foreign-workflow denial, workflow-id token resolution, exactly-once local commit, and public non-disclosure.

### 21.2 Narrow deployment

Only the two affected service images changed. The saved runtime plan contained `0 add, 2 change, 0 destroy` and changed only container image digests. IAM, ingress, environment, service identities, and unrelated services were unchanged.

| Service | Ready revision | Immutable image digest | Ready timestamp |
| --- | --- | --- | --- |
| `agent-runtime` | `tm-dev-agent-runtime-00034-sqg` | `sha256:cd59d10924d0c559226453a2e496bd34bdc94d86c7a8e6b866f11841a5d9e215` | `2026-08-22T16:44:06.784320Z` |
| `intent-provenance` | `tm-dev-intent-provenance-00031-nct` | `sha256:83b708e0b93264f7e2e7f3b9ce1672bb745c68e656749e01e3728251a4fce70b` | `2026-08-22T16:43:31.415090Z` |

### 21.3 Fresh authorization persistence proof

A new workflow/idempotency identity used the already-authoritative repaired travel IntentState; the failed historical workflow was not modified.

- intent: `intent-travel-liveproof14b-1787414136912`
- authoritative state: `state-intent-travel-liveproof14b-1787414136912-semantic-af8d3399bca09a5f`
- workflow: `wf-44727b21ae14ea86b4d91216`
- workflow state after AUTHORIZE: `AUTHORIZED`
- PLAN / PLAN_VERIFICATION / Guardian: passed
- Adaptive Authority: `ALLOW`
- materialization eligible: `true`
- OutcomeContract: `outcome-evaluation-wf-44727b21ae14ea86b4d91216-authority-wf-44727b21ae14ea86b4d91216-8f6d22a5e8b71a57`
- execution-authorization artifact: `execution-authorization-wf-44727b21ae14ea86b4d91216`
- artifact kind: `EXECUTION_AUTHORIZATION`
- pack: `travel`
- prepared action: `prep-38fd2c152997`
- predecessor: the canonical `WORKFLOW` artifact for `wf-44727b21ae14ea86b4d91216`

Intent-provenance accepted and durably stored the authorization artifact with matching workflow, IntentState, prepared-action, grant, OutcomeContract, and predecessor lineage. The internal commit-token value was present but is intentionally omitted from this report.

Public `POST /v1/workflows` and `GET /v1/workflows/wf-44727b21ae14ea86b4d91216` both returned safe `AUTHORIZED` views. Neither response contained authorization payloads, grants, prepared actions, CommitTokens, or internal route details.

### 21.4 Next closure-grade failure

The first workflow-id commit attempt and the repeated attempt both failed before Gateway:

- public route: `POST /v1/workflows/wf-44727b21ae14ea86b4d91216/commit`
- public result: `VALIDATION_FAILED`, downstream S2S `403`
- internal route: `POST /internal/workflows/wf-44727b21ae14ea86b4d91216/commit`
- agent-runtime revision: `tm-dev-agent-runtime-00034-sqg`
- authenticated caller: `tm-dev-public-bff@elite-crossbar-505104-t9.iam.gserviceaccount.com`
- ID-token verification: succeeded
- application caller policy: denied

The exact policy mismatch is:

- workflow submit/read routes use `workflowCallerEmails`, which includes `public-bff`
- workflow-id commit uses `executionCallerEmails`
- `executionCallerEmails` is sourced from `TM_EXECUTION_CALLER_EMAIL`
- the deployed value contains only `phase-b-verifier` and `phase-c-verifier`, not `public-bff`

No Gateway `/internal/gateway/commit` request occurred, no economic side effect occurred, and the second public attempt was another pre-Gateway denial rather than a commit replay. Gateway logs for this workflow contain only the successful PREPARE and AUTHORIZE operations.

This is a new route-policy closure blocker discovered after Repair 15 succeeded at its intended artifact-persistence boundary. Per the hard-stop rule, no caller-policy or IAM change was made in this pass. COMMIT, exactly-once live replay, and downstream outcome verification remain unproven.

## Current closure blocker after Repair 15

The canonical `EXECUTION_AUTHORIZATION` artifact is production verified. The current first blocker is the authenticated `public-bff` caller being excluded from the separate agent-runtime workflow-id commit application policy (`TM_EXECUTION_CALLER_EMAIL`). The denial occurs before internal authorization-handle resolution and before Gateway COMMIT.

**WAVE 4 PRODUCTION CLOSED = NO**

## 22. Live Fix D: governed workflow-id commit authorization

### 22.1 Route-boundary repair

The pre-change audit confirmed that Public BFF supplies only `workflowId` to `POST /internal/workflows/:workflowId/commit`. Agent Runtime resolves and validates the private `EXECUTION_AUTHORIZATION` artifact, then passes only the internal token id to Gateway. The public request and response never contain the authorization artifact payload, grant, prepared action, or CommitToken.

Adding Public BFF to the existing `TM_EXECUTION_CALLER_EMAIL` would also have authorized the verifier-only raw-token route `/internal/execution/commit`. The least-privilege repair therefore introduced a distinct route policy:

- `TM_WORKFLOW_COMMIT_CALLER_EMAILS`: `public-bff` only
- `TM_EXECUTION_CALLER_EMAIL`: unchanged `phase-b-verifier,phase-c-verifier`
- `/internal/workflows/:workflowId/commit`: governed workflow-id policy
- `/internal/execution/commit`: existing verifier-only raw-token policy

Public BFF remains unable to invoke Gateway directly. Gateway Cloud Run IAM contains Agent Runtime, Authority, Gateway, and Outcome Resolution only; Public BFF is absent. No raw Gateway route, token mint, PreparedAction construction, or AuthorityGrant mint was added.

Regression results:

- Agent Runtime governed/raw commit and shared lifecycle: `80 passed`
- cloud-runtime configuration, S2S route truth, architecture boundary: `23 passed`
- public API sanitization and architecture boundary: `22 passed`
- sequential builds passed:
  - `@truemandate/cloud-runtime`
  - `@truemandate/agent-runtime`
- Terraform module format check: `PASS`
- runtime Terraform validation: `PASS`

The tests prove Public BFF is present only on workflow-id commit, an unrelated identity is absent, caller-supplied token/grant/prepared-action fields are not forwarded, foreign workflow authorization fails closed, and existing stale/single-use/idempotency checks remain in the Gateway path.

### 22.2 Narrow deployment

Cloud Build `874b808d-7289-427d-84a2-4753eac7a581` produced one image:

- image digest: `sha256:f8ddde2a80baabedfe02b53ab84b568b74142bcf4234eb1b2e62da57bc2bd29d`
- ready revision: `tm-dev-agent-runtime-00035-4fg`
- ready timestamp: `2026-08-22T17:04:06.168859Z`

The saved Terraform plan contained `0 add, 1 change, 0 destroy`. Its only resource was `tm-dev-agent-runtime`, with:

- the new immutable image digest
- `TM_WORKFLOW_COMMIT_CALLER_EMAILS=tm-dev-public-bff@elite-crossbar-505104-t9.iam.gserviceaccount.com`

IAM, ingress, service identity, Gateway callers, existing execution callers, and all unrelated services were unchanged. Apply completed with `0 added, 1 changed, 0 destroyed`.

### 22.3 Fresh live commit and replay proof

A fresh workflow identity used the current authoritative travel IntentState and the existing verified-evidence path:

- idempotency key: `wave4-live-fix-d-1787418389643`
- workflow: `wf-6a1e4689c6bca3eb323025cc`
- IntentState: `state-intent-travel-liveproof14b-1787414136912-semantic-af8d3399bca09a5f`
- state before commit: `AUTHORIZED`
- PLAN_VERIFICATION: passed
- Guardian: `ALLOW`
- Adaptive Authority: `ALLOW`
- materialization eligible: `true`
- execution authorization: persisted internally
- OutcomeContract: `outcome-evaluation-wf-6a1e4689c6bca3eb323025cc-authority-wf-6a1e4689c6bca3eb323025cc-37ff0ddf5722065c`

Live commit results:

- first public workflow-id commit: `SUCCESS`
- execution id: `exec-wave4-live-fix-d-1787418389643`
- safe result ref: `mock-pay-wave4-live-fix-d-1787418389643`
- exact replay: `IDEMPOTENT_REPLAY`
- durable side-effect rows for the execution: exactly one
- private CommitToken durable state: consumed
- public response: only status, execution id when first executed, and safe result ref
- public response contained no CommitToken, grant, prepared action, or authorization payload

Agent Runtime logs prove the Public BFF ID token verified and route policy returned `ALLOWED` for `/internal/workflows/wf-6a1e4689c6bca3eb323025cc/commit`. Gateway emitted one `tm.execution.result` with `SUCCESS`. A public request body containing caller-controlled token/grant/prepared-action fields was ignored by the workflow-id handler and resolved as the existing idempotent workflow replay; those fields did not cross the boundary or alter execution.

Security negatives:

- unauthenticated direct internal Agent Runtime commit from outside the internal ingress: hidden/denied (`404`)
- unrelated external authenticated identity at internal Agent Runtime commit: hidden/denied (`404`)
- Public BFF identity attempting direct internal Gateway commit from outside the internal ingress: hidden/denied (`404`)
- Gateway IAM independently confirms Public BFF has no `run.invoker`
- raw-token internal execution remains restricted to Phase B/C verifier identities

### 22.4 Downstream outcome and next blocker

Commit successfully advanced the same linked durable OutcomeContract:

- state: `AWAITING_OUTCOME`
- payment status: `SUCCESS`
- execution begun: `2026-08-22T17:08:04.295Z`
- original contract linkage and definition remain intact

The next public lifecycle operation failed:

- route: `GET /v1/outcomes/contracts/outcome-evaluation-wf-6a1e4689c6bca3eb323025cc-authority-wf-6a1e4689c6bca3eb323025cc-37ff0ddf5722065c`
- Public BFF result: downstream S2S `403`
- owner route: `GET /internal/outcomes/contracts/:id`
- outcome-resolution revision: `tm-dev-outcome-resolution-00027-s87`
- authentication: succeeded
- verified caller: `tm-dev-public-bff@elite-crossbar-505104-t9.iam.gserviceaccount.com`
- application route policy: `DENIED`

The OutcomeContract itself updated successfully; the blocker is the sanitized public read path's owner-reader caller policy. Per the hard-stop rule, no outcome policy, IAM, route, or DTO change was made in this pass.

## Current closure blocker after Live Fix D

Governed public workflow-id COMMIT, exactly-once execution, token consumption, replay safety, and durable OutcomeContract payment transition are production verified. The current first blocker is authenticated Public BFF being excluded from the outcome-resolution contract-read application policy for `GET /internal/outcomes/contracts/:id`.

**WAVE 4 PRODUCTION CLOSED = NO**

## 23. Live Fix E: Public OutcomeContract read authorization

Date: Saturday, August 22, 2026

### 23.1 Read seam and least-privilege repair

The canonical owner read is `GET /internal/outcomes/contracts/:id`. It performs a durable `OutcomeContractSchema`-validated read and has no mutation or verification behavior. Public BFF calls this seam through `OutcomeS2SClient.getContract(...)`, then applies `toPublicOutcomeView(...)`. The public allowlist contains only `id`, `workflowId`, `intentId`, `intentStateId`, `domain`, `state`, `paymentStatus`, optional monitoring/resolution ids, and `updatedAt`; CommitToken, AuthorityGrant, PreparedAction, execution authorization, requirements, evidence internals, hashes, and verifier data are excluded.

The pre-repair route composed readers from the global owner callers plus Authority and Phase C. Adding Public BFF to the global caller list would also have authorized OutcomeContract creation. The repair instead introduced a dedicated read-only policy:

- `TM_OUTCOME_READER_CALLER_EMAILS`: `tm-dev-public-bff@elite-crossbar-505104-t9.iam.gserviceaccount.com`
- `TM_INTERNAL_ALLOWED_CALLERS`: unchanged `gateway,agent-runtime,evidence-service`
- evaluation caller: unchanged Phase C verifier only
- close/create and resolution mutation policies: unchanged

Regression coverage proves Public BFF is admitted only to the contract GET route and remains absent from create, close, and evidence-evaluation routes. Unauthenticated and unrelated callers remain outside the route policy. Public API and SDK tests continue to reject privileged response fields.

Validation results:

- outcome-resolution owner routes: `15 passed`
- public API sanitization/routes: `19 passed`
- SDK lifecycle and route truth: `10 passed`
- architecture/IAM boundary: `9 passed`
- total focused assertions: `53 passed`
- builds passed: `@truemandate/resolution-service`, `@truemandate/public-api`, `@truemandate/sdk-core`
- Terraform format check: `PASS`
- runtime Terraform validation: `PASS`

### 23.2 Narrow deployment

Cloud Build `e3294bf4-8279-4d6e-9659-f047712cedeb` produced only the outcome-resolution image:

- image digest: `sha256:c863ce64fb4867e81944133458cb676eb2de919444724e568a43c0d1201f290d`
- ready revision: `tm-dev-outcome-resolution-00028-bj9`
- rollout started: `2026-08-22T17:21:22Z`

The saved Terraform plan contained `0 add, 1 change, 0 destroy`. Its only resource was `tm-dev-outcome-resolution`, with the new immutable image digest and the dedicated reader environment value above. Apply completed with `0 added, 1 changed, 0 destroyed`. Service identity, `INTERNAL_ONLY` ingress, Cloud Run IAM, existing global/mutation caller policies, and all unrelated services were unchanged.

### 23.3 Live read proof

The existing durable contract from Live Fix D was read safely:

- contract: `outcome-evaluation-wf-6a1e4689c6bca3eb323025cc-authority-wf-6a1e4689c6bca3eb323025cc-37ff0ddf5722065c`
- durable workflow binding: `preExecutionBinding.workflowId = wf-6a1e4689c6bca3eb323025cc`
- intent: `intent-travel-liveproof14b-1787414136912`
- IntentState: `state-intent-travel-liveproof14b-1787414136912-semantic-af8d3399bca09a5f`
- payment status: `SUCCESS`
- outcome state: `AWAITING_OUTCOME`
- updated at: `2026-08-22T17:08:04.295Z`
- public GET: `200`

Revision logs record verified caller `tm-dev-public-bff@elite-crossbar-505104-t9.iam.gserviceaccount.com`, correct service-origin audience, `verification=SUCCEEDED`, and `routePolicyResult=ALLOWED`. Direct unauthenticated access to the internal owner route remains hidden/denied (`404`). The public body contains no requirements, hashes, verifier metadata, CommitToken, grant, PreparedAction, or execution-authorization payload.

### 23.4 Next closure blocker: SDK outcome DTO mismatch

The immediately required production `sdk-core.readOutcome(...)` proof failed closed:

- SDK result: `SCHEMA_PARSE_FAILED`
- SDK message: `invalid outcome response`
- HTTP owner/public read beneath it: `200`

The mismatch is deterministic:

- `SdkOutcomeViewSchema` requires top-level `workflowId` and `domain`.
- The durable `OutcomeContract` stores workflow lineage under `preExecutionBinding.workflowId`, not top-level `workflowId`.
- The current canonical durable OutcomeContract schema has no `domain` field.
- `toPublicOutcomeView(...)` only allowlists top-level values and therefore emits neither required field for this live record.

The authorization repair is production verified, but the public-safe DTO is incomplete relative to the SDK contract. Per the hard-stop rule, no outcome evaluation, SATISFIED/PARTIAL/BREACHED transition, resolution mutation, or DTO/model repair was attempted after this first new closure-grade failure.

## Current closure blocker after Live Fix E

Public BFF OutcomeContract owner-read authorization is repaired and verified. The next blocker is the live public OutcomeContract DTO lacking `workflowId` and `domain`, causing `sdk-core.readOutcome(...)` to fail closed despite the underlying HTTP read succeeding.

**WAVE 4 PRODUCTION CLOSED = NO**

## Final current status after Repair 16

The Live Fix E DTO blocker above is superseded by Repair 16 (Section 24). Public OutcomeContract lineage and `sdk-core.readOutcome(...)` now pass in production. The current first blocker is the verifier-only outcome evidence derivation path requiring procurement-specific `quantity_received` for a canonical travel OutcomeContract.

**WAVE 4 PRODUCTION CLOSED = NO**

## 25. Repair 18 live action-fidelity proof

Date: Saturday, August 22, 2026

### 25.1 Narrow deployment

Only `agent-runtime` was redeployed for the live Repair 18 proof.

| Service | Ready revision | Immutable image digest | Scope |
| --- | --- | --- | --- |
| `tm-dev-agent-runtime` | `tm-dev-agent-runtime-00036-dch` | `sha256:115aba3f349b50a8ba95d4536afac5f0789e835dc078b8fab9996e083ca2549a` | authoritative proof handoff + action fidelity |

Runtime Terraform changed only the `agent-runtime` image digest. No IAM, ingress, environment, or unrelated service changes were applied in this pass.

### 25.2 Fresh live Travel intent and candidate evidence

A fresh public raw Travel intent was created through the repaired public path:

- `intentId = intent-a25aad4acaa1`
- finalized authoritative tip:
  - `intentStateId v1 = state-intent-a25aad4acaa1-compiled-65ca115fe640b456`
  - `stateHash = 84a5c8a71f11fa22726cc95c8a9a330689cab909100b18f0cb9d381c8e89aa43`
  - `readiness v1 = PLANNABLE`
- authoritative execution-critical constraints on v1:
  - `c1 stay_quantity = 2`
  - `c2 refundability = true`
  - `c3 hotel_name = "Hotel Meridian"`
  - `c4 booking_provider_approval REQUIRE "approved provider"`
  - `c5 check_in_date = 2026-12-20`
  - `c6 check_out_date = 2026-12-22`
  - `c7 total_budget < 4800`
  - `c8 booking_completion_deadline < 2026-12-31`

Public governed evidence submission succeeded against that exact v1 lineage:

- candidate envelope:
  - `ev-livefix18-1787472003001-offer`
- candidate claims:
  - `claim-livefix18-1787472003001-count`
  - `claim-livefix18-1787472003001-refund`
  - `claim-livefix18-1787472003001-hotel`
  - `claim-livefix18-1787472003001-provider`
  - `claim-livefix18-1787472003001-checkin`
  - `claim-livefix18-1787472003001-checkout`
  - `claim-livefix18-1787472003001-budget`
  - `claim-livefix18-1787472003001-deadline`
- lineage:
  - `intentId = intent-a25aad4acaa1`
  - `intentStateId = state-intent-a25aad4acaa1-compiled-65ca115fe640b456`

Public readback remained fail-safe:

- `GET /v1/evidence/ev-livefix18-1787472003001-offer -> 200`
- `trustClass = UNTRUSTED_EXTERNAL`

### 25.3 Verifier-only proof and first live blocker

A temporary private Cloud Run operator execution reused the existing verifier-only path:

- job: `tm-dev-wave4-proof-operator`
- execution: `tm-dev-wave4-proof-operator-xwlhg`
- identity: `tm-dev-phase-c-verifier@elite-crossbar-505104-t9.iam.gserviceaccount.com`
- VPC posture: existing internal `tm-dev-s2s`, `ALL_TRAFFIC`

The verifier seam succeeded and created immutable derivative evidence:

- verification id:
  - `verify-livefix18-1787472003001`
- derivative envelope:
  - `ev-livefix18-1787472003001-offer-verified-verify-livefix18-1787472003001`
- derivative claims:
  - `claim-livefix18-1787472003001-count-verified-verify-livefix18-1787472003001`
  - `claim-livefix18-1787472003001-refund-verified-verify-livefix18-1787472003001`
  - `claim-livefix18-1787472003001-hotel-verified-verify-livefix18-1787472003001`
  - `claim-livefix18-1787472003001-provider-verified-verify-livefix18-1787472003001`
  - `claim-livefix18-1787472003001-checkin-verified-verify-livefix18-1787472003001`
  - `claim-livefix18-1787472003001-checkout-verified-verify-livefix18-1787472003001`
  - `claim-livefix18-1787472003001-budget-verified-verify-livefix18-1787472003001`
  - `claim-livefix18-1787472003001-deadline-verified-verify-livefix18-1787472003001`

The first closure-grade blocker occurs in pre-execution readiness, before semantic supersession, planner submission, action fidelity, Guardian, or Authority:

- route:
  - `POST /internal/pre-execution-readiness`
- result:
  - `status = 200`
  - `superseded = false`
  - `readiness remains PLANNABLE`
- workspace tip after the run:
  - still `state-intent-a25aad4acaa1-compiled-65ca115fe640b456`
  - no v2 successor was created

The exact conflicting proof representation is:

| Constraint | Concept | Proof result | Evidence / claim |
| --- | --- | --- | --- |
| `c1` | `stay_quantity` | `SATISFIED` | verified count claim |
| `c2` | `refundability` | `SATISFIED` | verified refund claim |
| `c3` | `hotel_name` | `SATISFIED` | verified hotel claim |
| `c4` | `booking_provider_approval` | `UNSATISFIED` | verified provider claim |
| `c5` | `check_in_date` | `SATISFIED` | verified check-in claim |
| `c6` | `check_out_date` | `SATISFIED` | verified check-out claim |
| `c7` | `total_budget` | `SATISFIED` | verified budget claim |
| `c8` | `booking_completion_deadline` | `SATISFIED` | verified deadline claim |

Coverage itself is complete:

- `requiredConstraintIds = c1..c8`
- `derivedObligationConstraintIds = c1..c8`
- `evaluatedConstraintIds = c1..c8`
- `missingObligationConstraintIds = []`
- `missingEvaluationConstraintIds = []`
- `allRequiredCovered = true`

But ambiguity remains unresolved and supersession is denied because the provider proof row is not actually satisfied:

- `ambiguityClass = A1`
- unresolved ambiguity:
  - `amb1`
- related concept:
  - `booking_provider_approval`
- matched obligation:
  - `18e16b895d01de056b58df80ff727a6fe8a0880e75dde8f4021cd939b4048b1e`
- exact readiness reason:
  - `Related authoritative constraints are not fully proven by verified evidence`

This means the positive Travel proof did **not** reach the Repair 18 action-fidelity gate. The first false predicate in the live chain is still upstream:

- authoritative proof snapshot completeness: `true`
- authoritative proof satisfaction: **false** because `c4 booking_provider_approval = UNSATISFIED`
- semantic supersession: **not performed**
- planner / plan verification / action fidelity / Guardian / Authority: **not reached**

### 25.4 Controlled negative proof that the gate still fails closed

The same verifier execution also ran a controlled omission case by dropping the verified checkout claim before readiness evaluation.

Observed result:

- `superseded = false`
- readiness remained `PLANNABLE`
- `c6 check_out_date` proof row became:
  - `status = UNKNOWN`
  - `reason = "No verified evidence matched the authoritative constraint"`

This proves the governed pre-execution path still fails closed when a required verified Travel date proof is missing.

### 25.5 Current blocker after Repair 18 live proof

Repair 18 deployment itself is live, but the first fresh Travel proof stops before action fidelity because the verified provider evidence representation does not satisfy the authoritative `booking_provider_approval` constraint under the existing readiness comparator. No v2 semantic supersession was created, so no authoritative proof snapshot was available for the positive action-fidelity workflow submission.

Per the hard-stop rule, the live proof stopped here. The positive Travel workflow, negative cross-domain action-fidelity matrix, RAW retry eligibility recheck, and downstream Repair 17 outcome continuation were **not** run after this blocker appeared.

**WAVE 4 PRODUCTION CLOSED = NO**

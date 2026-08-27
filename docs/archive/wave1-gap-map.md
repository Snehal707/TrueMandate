# Wave 1 — Spec-to-Source Gap Map (2026-08-19)

Source-verified. Requirement → implementation → gap → owner → authority implication.

| Requirement | Current implementation | Gap | Owner | Authority/security |
|---|---|---|---|---|
| Outcome SATISFIED path | Deterministic predicates + aggregate → SATISFIED (`packages/outcome-core/src/{predicates,aggregate}.ts`, applied in `OutcomeService.applyObservations`) | Implemented; needs an end-to-end acceptance proof + durable read | outcome-core/outcome-service | Criticality locked; payment ≠ SATISFIED enforced |
| Outcome CLOSED path | Allowed by transition table (`outcome-core/src/transitions.ts`) but **no code path ever enters CLOSED** | Add owner-backed close route (only from SATISFIED/BREACHED/RESOLVED with no open resolution case) + event | resolution-service (owns outcome routes) | Terminal reconciliation; never auto-close PARTIAL/AT_RISK |
| 500/500 full-delivery fixture | Phase C fixture only proves 450/500 (`services/phase-c-verifier/src/fixture.ts`) | New fresh namespace `wave1-full-delivery-v1` + acceptance verifier | wave1-verifier (new) | Fresh namespace; Phase A/B/C untouched |
| REQUIRE_APPROVAL | EvaluationRecord `PENDING_APPROVAL`, materializationEligible=false — **durable dead-end** (`services/authority-service/src/internal-routes.ts:98`) | Full ApprovalRequest lifecycle + decide route + grant-unlock path | protocol/authority-service | Fail closed; approval never widens scope, never mints, never calls Gateway |
| Approval artifacts/routes/repos/events | `ApprovalArtifact` (mint-and-validate only, `packages/authority/src/approval.ts`); `approvals` Firestore collection exists but **no service writes it**; DemoRuntime in-memory only | Durable ApprovalRequest + approve/decide routes + `approvalEvents` collection | protocol/authority-service/cloud-firestore | decidedBy = verified caller identity, never JSON-supplied |
| Evidence durable persistence | Envelopes/claims durable via `persist.bundle` when TM_PERSISTENCE=firestore (`services/evidence-service/src/bin/start.ts`) | Reads must go through the durable repo (read-through like OutcomeService.getContract) | evidence-service | Caller-bound namespaces preserved; no weakening |
| Evidence read APIs | S2S GET routes exist; SDK `evidence.read` = degraded (process-local in live deploy) | Durable read-through fixes the owner boundary; SDK stays degraded until live verification | evidence-service/sdk-core | Allowlisted public view preserved |
| ResolutionCase | Durable (resolutionCases/resolutionTriggers); canonical evidence requests; responsibility UNKNOWN | Implemented | resolution-service | Verifier asserts, never authors |
| RemedyProposal / RemediationMandate | Protocol + mandate authority guards + `executeRemedyPipeline` + state machine (AWAITING_AUTHORITY → REMEDIATING → VERIFYING_REMEDY → RESOLVED) — **never wired in production** | Production wiring: routes + gateway/authority S2S `PrivilegedRemedyPort` + durable attempts + remedy evidence verification | resolution-service | Mandate ≠ execution grant enforced; independent authority asserted |
| Compensation/remedy authority | `assertIndependentRemedyAuthority` + mandate validation (`packages/authority`) | Wire into production remedy execution path | authority/resolution | Remedy scope ≤ shortfall band; never Resolution-direct execution |
| Remedy execution | `PrivilegedRemedyPort` (Gateway mints distinct grant) — tests only | Production adapter over AuthorityS2SClient + GatewayS2SClient | resolution-service | Reuses trusted PREPARE/AUTHORIZE/COMMIT |
| Remedy outcome verification | `resolveFromRemedyOutcome` → RESOLVED only on remedy contract SATISFIED | Wire evaluate-evidence on remedy contract + restoration acceptance proof | resolution-service | Tool SUCCESS ≠ RESOLVED enforced |
| Governance events | Only `intent.created` reaches Pub/Sub; outcome/resolution/authority/evidence/payment/security families in-memory or absent | Add durable append-only `approvalEvents` + `resolutionEvents` collections; emit on meaningful transitions | cloud-firestore/resolution/authority | Events = history/audit only; materialized docs remain operational state |
| Append-only event stores | outcomeEvents durable; provenanceNodes/Edges; sideEffects/commitTokens/grants/evaluations durable | approvalEvents + resolutionEvents + remedy durability close the touched flows | cloud-firestore | Immutable putIfAbsent |
| State reconstruction | Partial: artifacts + outcome events exist | Deterministic reconstruction test for one complete workflow (intent → approval → execution → outcome → resolution → remedy → RESOLVED) | wave1-verifier (test) | Reconstruct from immutable records only |

---

## Wave 1 closure status (2026-08-19 — appended, original rows preserved)

Every row above is now CLOSED except the ones explicitly out of wave scope
(BigQuery/LearningProposal/preference/reliability/telemetry/monitoring,
ALLOW_WITH_MONITORING consumer, arbitrary external workflow API, final UI,
live deployment). Details and proofs: see `wave1-closure-report.md`.

| Gap | Closure |
|---|---|
| SATISFIED path | predicates + product facts; acceptance B SATISFIED→CLOSED |
| CLOSED path | `OutcomeService.closeContract` + `POST /internal/outcomes/contracts/:id/close` (SATISFIED + no-open-case guard) |
| REQUIRE_APPROVAL dead-end | full durable lifecycle (AWAITING_APPROVAL → decide → resumeWithApproval → AUTHORIZED) |
| approval writes/events | authority-service approval routes + durable `approvals`/`approvalEvents` |
| Evidence durable reads | `EvidenceService` read-through; start.ts service-backed reads |
| Remedy never wired | remedy routes + production `RemedyExecutionPort` (full independent chain) + remedy exposure group |
| Remedy verification | evaluate-evidence on remedy contract → SATISFIED → resolveFromRemedyOutcome → RESOLVED |
| Governance events | approval + resolution event families emitted and durable (`approvalEvents`/`resolutionEvents`) |
| Append-only reconstruction | `reconstructResolutionState` deterministic replay + fails-closed tests |
| SDK approval/resolution | approval.get/decide + resolution.get + remedy inspection (allowlisted); no mint/COMMIT/scope surface |

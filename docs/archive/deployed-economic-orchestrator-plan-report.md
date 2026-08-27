# Deployed Economic Orchestrator Plan Report

## Authority semantic trust boundary

**Status: CLOSED for semantic Authority evaluation.** `POST /internal/authority/procurement` is the only production semantic Authority transport. It accepts strict durable references, resolves owner-held artifacts, reconstructs exact proof obligations, validates current IntentState freshness, and remains evaluation-only: no grant, approval, PreparedAction, Gateway call, or commit is created.

Authority checks immutable proof-to-evidence-reference structure; it does not independently establish underlying evidence authenticity or truth. Owner-held semantic artifacts preserve canonical hashes, typed proof status/action/obligation/evidence/method bindings, canonical Action obligation IDs, and canonical unordered Guardian proof sets. `proofObligationId()` remains the single production obligation identity helper. Taint is monotonic through `OwnerProvenanceAdapter`; Model Armor CLEAN never cleans provenance taint.

The raw `/internal/authority/grants` transport, raw mint DTO, and `AuthorityGatewayOrchestrator` path remain removed. Authority runtime does not construct `GatewayS2SClient`.

## Compilation, coordinator, and temporal authority

Intent compilation is owner-held and immutable: **RAW INTENT -> COMPILATION -> COMPILATION_VERIFICATION -> owner finalization -> IntentState**. Finalization alone may derive `IntentState.temporalAuthority`, and only from verified, explicit, untainted human grounding. External merchant/evidence deadlines, model inference, caller metadata, and unsupported enterprise-policy claims cannot establish or extend execution authority. Missing temporal authority produces a semantic-only state; no default TTL exists.

The authenticated `/internal/workflows/procurement` route remains non-executing. It loads owner-held state/evidence, records external-offer taint, persists `PLAN -> PLAN_VERIFICATION -> ACTION -> PROOF -> GUARDIAN -> WORKFLOW`, and calls Authority only with durable references. Unsafe offers block before Authority execution; valid chains remain evaluation-only.

## EvaluationRecord package reconciliation

**EvaluationRecord lifecycle: CLOSED.** `@truemandate/authority` now owns the domain-only `AuthorityEvaluationRecord` schema, canonical hash, hash-integrity parser, and `EvaluationStore` port. It has no Firestore, cloud-firestore, or service-runtime import. The parser is used for construction and replay, performs strict Zod validation, and recomputes the canonical record hash.

`@truemandate/cloud-firestore` provides `FirestoreAuthorityEvaluationRepository`, limited to typed `get` and transactional create-once `putIfAbsent`. It validates rows on read and write; a malformed or hash-tampered durable row produces a typed fail-closed result instead of being treated as absent. It contains no Authority decision, eligibility, or expiry derivation. Production Authority startup injects `persist.bundle.authorityEvaluations`; `InMemoryEvaluationStore` is an explicit service-test seam only.

Evaluation records remain opaque and Authority-owned. There is no caller-facing create/update route or client, and no caller can provide a canonical hash, decision, expiry, eligibility, or audit reason as an authoritative record field.

## OutcomeContract pre-execution lifecycle

**OutcomeContract pre-execution lifecycle: CLOSED.** `outcome-resolution` is the sole owner of `POST /internal/outcomes/procurement-contract`. Its strict request contains only opaque EvaluationRecord, WORKFLOW, and ACTION references plus idempotency/correlation metadata. The owner reads and canonical-hash-validates the Authority EvaluationRecord, requires current unexpired materializable `ALLOW`, then proves exact workflow/action/IntentState ID/hash/version continuity before it derives a contract.

`@truemandate/outcome-core` owns the strict immutable definition parser, hash integrity check, and narrow `OutcomeContractStore` port. The definition hash includes `preExecutionBinding` and canonicalizes requirements to their immutable `PENDING` definition state, so later lifecycle observations cannot alter quantity, specification, supplier, food-grade, delivery/evidence requirements, or EvaluationRecord/workflow/Action/IntentState bindings. `@truemandate/cloud-firestore` implements that port with validated `get` and transactional `putIfAbsent` only; no generic overwrite operation is used for authoritative pre-execution creation.

The route derives the flagship definition from durable records only: 500 required units, approved supplier, food-grade certification, authorized INR amount/currency, delivery terms, and deterministic quantity/product/supplier/certification evidence requirements. Payment remains `PENDING`; contract state remains `CREATED`. A future 450 delivery cannot satisfy the retained `quantity_received >= 500` hard requirement.

## Validation

- Authority semantic dedicated suites: `semantic-artifact-contract`, resolver, HTTP route, and provenance adapter: **103 passed** (14 + 30 + 49 + 10).
- EvaluationRecord contract plus Authority HTTP suite: **57 passed** (8 + 49).
- Focused semantic/coordinator/compilation/memory regression command: **8 files, 123 tests passed**.
- Builds passed in dependency order for `@truemandate/authority`, `@truemandate/cloud-firestore`, and `@truemandate/authority-service`. Typechecks also passed for those packages plus `@truemandate/cloud-runtime` and `@truemandate/agent-runtime`.
- Memory transactional/restart suite: **8/8 passed**.
- Supported real Firestore runner, `node scripts/cloud/run-firestore-emulator-races.mjs`: **18/18 passed** — 10 established transaction races plus 8 EvaluationRecord races. The latter cover concurrent identical creation, divergent Action/state/decision/economic/expiry conflicts, restart replay, canonical durable round-trip, and malformed/hash-tampered row rejection. The scoped 20-second contention timeout is test-only and reflects observed emulator latency.
- Full suite: `pnpm test` — **76 files / 531 tests passed; 2 files / 18 tests conditionally skipped** without `FIRESTORE_EMULATOR_HOST`. Those exact emulator tests executed successfully via the supported runner above.

## Deferred work

## Current closure validation (supersedes historical totals above)

- Outcome owner-route suite: `services/resolution-service/src/outcome-internal-routes.test.ts` — **11 passed**, including strict raw-field smuggling and replay checks.
- Builds passed for `@truemandate/outcome-core`, `@truemandate/cloud-firestore`, `@truemandate/outcome-service`, and `@truemandate/resolution-service`.
- Supported real Firestore runner: **22/22 passed** — 10 established transaction races, 8 EvaluationRecord races, and 4 OutcomeContract immutable-definition races.
- Full suite: `pnpm test -- --reporter=dot` — **77 files / 542 tests passed; 3 files / 22 tests conditionally skipped** without `FIRESTORE_EMULATOR_HOST`; those emulator tests executed via the supported runner.

## Pre-execution economic authority lifecycle (verification in progress)

**Status: OPEN.** The deployed pre-commit ordering is now **Authority evaluation -> OutcomeContract -> reference-only Gateway PREPARE -> Authority bind-and-mint -> Gateway AUTHORIZE -> CommitToken**. It still stops before `COMMIT`; no payment adapter, outbox, or external economic side effect is invoked by this lifecycle.

Gateway's `POST /internal/gateway/prepare-references` reloads the opaque EvaluationRecord, OutcomeContract, WORKFLOW, ACTION, GUARDIAN, finalized IntentState, and current tip. It rejects non-materializable or expired evaluations, hash or workflow recombination, malformed owner data, stale state, and action economics that differ from the evaluated bounds. It creates the PreparedAction itself; its full canonical hash binds EvaluationRecord, OutcomeContract, workflow, Action, IntentState ID/hash/version, and all execution-critical fields.

PREPARE additionally requires the OutcomeContract pre-execution binding to match the EvaluationRecord's workflow, Action, and evaluated IntentState ID/hash/version exactly, and requires the durable Guardian artifact to be of kind `GUARDIAN` in that same workflow. These are owner-side checks; callers cannot replace them with request diagnostics.

The former raw `POST /internal/gateway/prepare` transport and `GatewayS2SClient.prepare()` client method are retired from production. The only production PREPARE transport is reference-only. PreparedAction now also hashes the complete evaluated capability scope, preventing a capability/scope substitution that preserves payment parameters.

Authority's `POST /internal/authority/bind-and-mint` accepts only EvaluationRecord, PreparedAction, and OutcomeContract references. It revalidates the PreparedAction full hash, exact lineage, current IntentState, expiry, and evaluated economic bounds before using the bounded grant primitive. Gateway AUTHORIZE reloads the durable grant and exact PreparedAction before issuing a CommitToken. The route surface remains reference-only. Dedicated PREPARE, bind-and-mint, AUTHORIZE, coordinator E2E, and real-emulator create-once suites now execute; the complete boundary-by-boundary TOCTOU matrix remains outstanding, so this lifecycle is not closed.

## Current verification

- Existing route regression command: `pnpm test -- services/gateway-service/src/internal-routes.test.ts services/authority-service/src/internal-routes.test.ts services/resolution-service/src/outcome-internal-routes.test.ts` — **65 passed**.
- Full suite after owner-side lineage hardening: `pnpm test -- --reporter=dot` — **77 files / 542 tests passed; 3 files / 22 conditionally skipped** without `FIRESTORE_EMULATOR_HOST`.
- Rebuilt successfully: `@truemandate/cloud-runtime`, `@truemandate/gateway-service`, `@truemandate/authority-service`, `@truemandate/agent-runtime`, and `@truemandate/resolution-service`.
- Post-retirement focused checks: gateway closure hash vectors **10 passed**; gateway/cloud-runtime/Authority route checks **59 passed**. The full suite remains **77 files / 542 tests passed; 3 files / 22 conditionally skipped**.

## Latest pre-execution verification (2026-08-15)

- Added `services/agent-runtime/src/generic-workflow.e2e.test.ts`: **2 passed**. It drives the shared `GenericWorkflowEngine` multi-domain harness through owner-shaped clients and real Authority, Outcome, Gateway PREPARE, bind-and-mint, and AUTHORIZE handlers. Procurement remains the canonical historical specimen inside that shared harness. An industrial-grade offer stops before Authority/Outcome/PREPARE/grant/token; an owner-derived time-bounded food-grade 500-unit, approved-supplier INR 742,000 procurement reaches a durable **unconsumed** CommitToken only. The E2E harness records zero COMMIT, payment-adapter, and outbox calls.
- The E2E test exposed a concrete lineage defect: Guardian used `hashActionProposal`, but PreparedAction had been binding the ActionProposal hash where the EvaluationRecord correctly carries the owner ACTION artifact hash. Reference PREPARE now passes the owner ACTION artifact hash into PreparedAction construction while retaining Guardian's ActionProposal hash verification. This preserves distinct semantic-artifact and proposal bindings.
- Added Outcome-contract TOCTOU protection: the owner route now reloads the current IntentState tip and rejects an eligible EvaluationRecord when its evaluated state is no longer current. `services/resolution-service/src/outcome-internal-routes.test.ts`: **12 passed**, including the advancement regression.
- Current focused cross-boundary command: `pnpm test -- services/agent-runtime/src/generic-workflow.e2e.test.ts services/gateway-service/src/prepare-references.test.ts services/authority-service/src/bind-and-mint.test.ts services/resolution-service/src/outcome-internal-routes.test.ts` — **4 files / 37 tests passed**.
- Dependency-order typechecks passed for `@truemandate/authority`, `@truemandate/cloud-firestore`, `@truemandate/cloud-runtime`, `@truemandate/resolution-service`, `@truemandate/gateway-service`, `@truemandate/authority-service`, and `@truemandate/agent-runtime`; the same affected packages were rebuilt.
- Real Firestore validation: `pnpm test:firestore:emulator` — **4 files / 28 tests passed**, using demo project `demo-truemandate` at `127.0.0.1:8081`.
- Full regression: `pnpm test -- --reporter=dot` — **82 files / 597 tests passed; 4 files / 28 tests conditionally skipped** outside an emulator environment. Those 28 emulator tests executed and passed in the preceding supported runner.
- Rebuilt-source and `dist` audit finds only `/internal/gateway/prepare-references`; no production raw `/internal/gateway/prepare` transport or `GatewayS2SClient.prepare()` remains.

## Final pre-execution TOCTOU closure (2026-08-15)

**Pre-execution economic authority lifecycle: CLOSED.** The closure covers only the owner-resolved, pre-COMMIT path:

`EvaluationRecord -> OutcomeContract -> reference-only PREPARE -> PreparedAction -> bind-and-mint -> AuthorityGrant -> AUTHORIZE -> CommitToken`.

`services/gateway-service/src/preexecution-toctou.test.ts`: **21 passed**. It uses the real Outcome creation, reference-only PREPARE, bind-and-mint, and AUTHORIZE handlers with owner-backed reads. A valid control reaches a persisted, integrity-validated, **unconsumed** CommitToken. The suite verifies fail-closed behavior after exactly one subsequent authoritative mutation: IntentState/tip advancement before Outcome or PREPARE; Action, Guardian, and Outcome binding substitutions; EvaluationRecord expiry; typed invalid PreparedAction durable reads; Action hash, scope, merchant, amount, currency, and expiry changes; and expired, revoked, swapped, or invalid grant/PreparedAction inputs before AUTHORIZE. Failed stages create no PreparedAction, usable grant, or CommitToken.

The related closure regression command executed **7 files / 85 tests passed**: TOCTOU (21), coordinator E2E (2), reference PREPARE (16), bind-and-mint (7), Gateway internal/AUTHORIZE routes (12), typed durable reads (9), and PreparedAction/invariant hash vectors (18). The valid coordinator flow ends at an unconsumed token; the unsafe industrial flow stops before Authority, OutcomeContract, PREPARE, grant, and token. Both record zero COMMIT, payment-adapter, and outbox activity.

Typed durable reads validate PreparedAction, AuthorityGrant, and CommitToken rows before use. The production Firestore pre-execution race file independently proves tampered PreparedAction, grant, and token rows fail closed, alongside create-once/replay races. `pnpm test:firestore:emulator` executed **4 files / 28 tests passed** against demo project `demo-truemandate` at `127.0.0.1:8081`.

Dependency-order typechecks and builds passed for `@truemandate/authority`, `@truemandate/cloud-firestore`, `@truemandate/cloud-runtime`, `@truemandate/resolution-service`, `@truemandate/gateway-service`, `@truemandate/authority-service`, and `@truemandate/agent-runtime`. Full regression, `pnpm test -- --reporter=dot`, passed **83 files / 618 tests**; **4 files / 28 tests** are conditionally skipped without the emulator environment and were executed successfully by the supported emulator runner above.

Rebuilt source and `dist` contain only `POST /internal/gateway/prepare-references` and the prepared-action read route. No production `/internal/gateway/prepare` or `GatewayS2SClient.prepare()` remains. Historical raw-route references are confined to tests that assert route retirement. `TwoPhaseGateway.prepare()` remains an internal domain/test seam invoked by the owner-resolved handler.

This closure does **not** include Gateway `COMMIT`, adapter invocation, execution outbox, BFF forwarding, workspace reconstruction, Terraform, image build/push, deployment, SAFE, or live payments.

Gateway `COMMIT`, adapter invocation, execution outbox, BFF forwarding, workspace reconstruction, Terraform, image build/push, deployment, SAFE, and live payments remain out of scope.

## Phase A — COMMIT provenance prerequisite (in progress)

**Phase A local security verification: CLOSED. Phase A deployment identity evidence: OPEN.** COMMIT remains disabled. After owner-resolved PREPARE, agent-runtime persists a deterministic semantic-ACTION provenance node (`action-provenance-{workflowId}`), then `execution-action-{preparedActionId}` and its semantic-action `DERIVED_FROM` edge from durable PreparedAction/EvaluationRecord/OutcomeContract/IntentState lineage only. External offer influence remains represented by an `INFLUENCED_BY` edge and cannot become authority.

Authority bind-and-mint reloads that execution-action node and, after the bounded grant exists, calls the narrow provenance-owner authority-binding operation. Generic provenance writes reject AUTHORITY nodes and `AUTHORIZES` edges. The authority binding creates replay-stable principal and AuthorityGrant nodes plus the canonical principal-to-authority and authority-to-execution-action `AUTHORIZES` relations. Firestore provenance rows are now strict-schema validated and carry canonical row hashes: malformed or hash-tampered node/edge rows fail closed instead of appearing absent. Divergent immutable replay is a non-retryable fail-closed conflict.

Gateway has a Phase-A-only reconstruction primitive: from durable CommitToken, PreparedAction, and AuthorityGrant it derives all provenance IDs, reloads owner records, validates exact semantic-action, execution-action, principal, Authority, `DERIVED_FROM`, principal, and `AUTHORIZES` bindings, then applies the existing privileged-path and authority-taint gates. It is intentionally not wired into COMMIT.

Cloud Runtime now verifies Google ID tokens when `TM_INTERNAL_AUTH_VERIFY=true`, including the configured audience and verified service-account email. The dedicated authority-binding route accepts only `TM_AUTHORITY_CALLER_EMAIL`; its handler receives `req.caller`, never caller claims from a header or request body. Direct verifier tests cover missing/malformed bearer tokens, malformed JWTs, invalid signature/wrong audience/expiry verifier failures, malformed payloads, Authority, and a valid non-Authority caller. Route tests independently deny agent-runtime, Gateway, intent-provenance, anonymous, and forged caller claims.

Local verification (2026-08-15): focused Phase-A/pre-execution matrix **13 files / 126 tests passed**; `pnpm test:firestore:emulator` **5 files / 31 tests passed**, including production provenance races/restart/tampered-row rejection; dependency-order builds/typechecks passed for provenance, cloud-firestore, cloud-runtime, intent-service, authority-service, gateway-service, and agent-runtime; `pnpm test` **87 files / 652 tests passed**, with **5 emulator files / 31 tests conditionally skipped** in normal mode and executed through the supported runner.

Terraform was validated and rendered only, not applied. The exact unapplied delta is `authority -> intent-provenance` `roles/run.invoker`, plus intent-provenance `TM_INTERNAL_AUTH_VERIFY=true`, `TM_AUTHORITY_CALLER_EMAIL`, and `TM_INTERNAL_ALLOWED_CALLERS`. The local audit also found a legacy production COMMIT route/client despite Phase A being COMMIT-disabled; it was removed in this pass. No `POST /internal/gateway/commit`, `GatewayS2SClient.commit`, or commit DTO remains in source or rebuilt output. `TwoPhaseGateway.commit()` remains only an internal domain/test seam. Phase A remains deployment-open until that revision is applied/deployed and real Cloud Run acceptance proves Authority succeeds while agent-runtime, Gateway, unsigned, and direct callers fail. No COMMIT, adapter, outbox, payment, or outcome execution is enabled.

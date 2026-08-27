# P0 Submission Build — Final Report (2026-08-19)

**HARD STOP RESPECTED: nothing was deployed, nothing was registered.**
All work is local. Phase A/B/C trusted economic core untouched; no
production economic execution occurred.

> CLOSURE UPDATE (2026-08-19, final): the sections below were superseded by
> the final closure pass A–G. Authoritative final state:
> - **Combined 500 run** (one corpus, one immutable artifact
>   `evals/safe/v1/stress/combined/combined-results_2026-08-18T21-33-19-700Z.json`):
>   TRUEMANDATE_FULL **472/500** (composite 0.9628, 0 critical, 0
>   unauthorized; 28 failed = 10 base matching the accepted catalog + 18
>   stress), BASELINE_SINGLE_AGENT **40/500** (425 critical, 325
>   unauthorized). Hashes: base `52da0d8f…`, stress manifest `e31e9903…`,
>   combined manifest `ab773cc5…`. The UI's "Evaluated across 500
>   deterministic adversarial scenarios" claim is generated from — and gated
>   on — this artifact.
> - **ADK backend**: Vertex AI + ADC, verified from installed sources
>   (`@google/adk@1.6.0` models/google_llm.js; `@google/genai@2.17.1`
>   dist/node/index.mjs). One real read-only smoke succeeded: model
>   `gemini-3.7-flash`, backend VERTEX_AI, location global, auth ADC, tool
>   `true_mandate_canonical_proof`, zero writes. **No GEMINI_API_KEY
>   anywhere.**
> - **Nav**: exactly four primary items — Live Proof | SAFE Benchmark |
>   Attack Lab | Architecture — with provenance nested under Live Proof,
>   the 500 Product Stress Suite under SAFE Benchmark, and Developer SDK /
>   Google ADK · A2A / Agent Registry readiness under Architecture.
> - **SDK capability classification**: `intents.record` + `proof.canonical`
>   = supported; `evidence.read` = degraded; `workspace.read` = demo-only;
>   eight infrastructure-owned capabilities with no route and no method.
> - Final verification: full suite 940 passed / 32 skipped / 0 failed
>   (131 files); workspace typecheck 0 errors; all builds green.

## 1. SDK — audit + implementation

- `packages/sdk-core` (new) — framework-neutral client.
  - Exports: `createSdkCore`, `SdkCore`, `SdkTransport`, `SdkCoreConfig`,
    `SdkEvidenceView`, `SDK_CAPABILITIES`, `RecordIntentRequestSchema`,
    `IntentWireSchema`, type re-exports (`Result`, `ErrorCode`, `Intent`,
    `IntentState`, `CanonicalProjection`, `IntentWorkspaceView`).
  - Methods: `recordIntent`, `readCanonicalProjection`, `readEvidence`,
    `readWorkspace` — the four real public routes only.
- `packages/sdk-agent` (new) — agent-developer surface.
  - Exports: `createAgentSdk`, `AgentSdk`, `ActionProposalDraftSchema`,
    `boundaries` (propose: local-validation-only; submit/execute/pay/
    commit/mint: false).
  - Tool classification via the real `@truemandate/tool-registry`
    (registry-owned privilege; T2/T3 always require a PreparedAction).
- Route matrix + ingress recommendation: `docs/sdk-route-truth.md`.
- Security tests (all passing): route truth (exactly 4 routes, one request
  per record), authority negative boundaries (no S2S deps, no `/internal/`,
  no grant/token exports, strict wire schemas), evidence allowlist sync
  against `packages/public-api/src/dto.ts`, sdk-agent no-fake-execute scan.

## 2. Google ADK + A2A 1.0 — reference integration

- `integrations/google-adk/` (new) — official packages, versions verified
  against installed artifacts: `@google/adk@1.6.0`, `@a2a-js/sdk@1.0.1`.
  - `src/agent.ts` — `LlmAgent` + exactly two `FunctionTool`s backed by
    sdk-core: `true_mandate_record_intent`, `true_mandate_canonical_proof`.
    No payment tool, no execution surface.
  - `src/a2a-executor.ts` — native A2A 1.0 `AgentExecutor` driving the ADK
    `Runner` (ADK 1.6.0 bundles a2a 0.3 internally; verified caveat,
    documented in README).
  - `src/agent-card.ts` — A2A 1.0 Agent Card (`supportedInterfaces`
    JSONRPC / protocolVersion 1.0, skills, < 10 KB).
  - `src/server.ts` — Express serving `/.well-known/agent-card.json` +
    JSON-RPC at `/a2a` (smoke-tested locally: card 200 + JSON).
- Tests: card schema/limit/determinism, boundary scan, tool-surface honesty.

## 3. Agent Registry — readiness only

- `docs/agent-registry-readiness.md` — GA API facts (v1, `A2A_AGENT_CARD`,
  max 10 KB, global or us-central1, `roles/agentregistry.editor`), exact
  gcloud command, Terraform alternative (`google_agent_registry_service`,
  provider ≥ 7.39.0), discovery semantics, hard boundaries.
- NOT registered. Zero path into AuthorityGrant / PreparedAction /
  CommitToken / Gateway decision (discovery only).

## 4. 500 deterministic product stress suite

- `packages/safe-benchmark/src/stress/` (new): `validity.ts` (canonical
  validity rule + content hash + documented ground-truth completion),
  `stress-generator.ts` (T1–T7 buckets + rejection ledger + manifest),
  `harness-integrity.ts` (70 rows, separate), paraphrases.
- Composition (generation-guarded, all pinned by tests):
  T2 79 · T1 74 · T3 60 · T4 23 · T5 20 · T6 2 · T7 9 = **267** stress rows
  + 233 untouched base = **500 product scenarios**; harness integrity 70
  (never counted).
- Generation guards: unique canonical content hashes (267/267), zero
  rejectedInvalid / rejectedNoOp, 6 rejectedDuplicate (T1×T2 golden-source
  collisions, deterministically substituted — recorded in the manifest),
  generated-context pool 924, family distribution execution 102 · injection
  74 · authority 40 · semantic 21 · outcome 16 · resolution 11 · benign 3.
- Real results (immutable artifacts `evals/safe/v1/stress/`, run
  `2026-08-18T20-49-39-042Z`):
  - TRUEMANDATE_FULL **249/267** (composite 0.9516), **0 critical**,
    **0 unauthorized**.
  - BASELINE_SINGLE_AGENT 5/267, 232 critical, 205 unauthorized
    (the divergence the suite exists to expose).
  - Harness integrity **70/70**.
  - Failures (18) fully categorized: 10 T2 (change_amount ×4, drop_constraint
    ×5 — SUT detection gaps — + golden-20 deadline precedence), 5 T5
    (deliberate blocker-#6 probes), 3 T7 anchors. No fixture was modified to
    improve the score.
- Old results proof: base catalog hash pinned (`52da0d8f…`) and re-verified
  in manifest + tests; SAFE_V1 acceptance summary byte-unchanged after stress
  runs (stress-cli.test.ts fingerprints the accepted artifacts dir).
- Runner: `services/benchmark-runner/src/stress-cli.ts` (bin `stress-run`),
  immutable `wx`-flag stamped artifacts; reruns never overwrite (tested).

## 5. Judge UI — integration + truth cleanup

- Nav preserved and extended: Live Proof | SAFE Benchmark | Attack Lab |
  Provenance | 500 Stress | Developer SDK | Architecture.
- `ProvenancePage` — real canonical chain (10 durable records + evidence +
  timeline) rendered strictly from the projection; test proves every
  rendered id exists verbatim in the projection (no fabricated edges).
- `StressPage` — generated read model from the immutable artifacts
  (`scripts/demo/build-stress-readmodel.mjs` + equality test).
- `DeveloperPage` — SDK capability table rendered from the real
  `SDK_CAPABILITIES` constant + ADK/A2A facts + "Agent Registry ready ·
  PLANNED ONLY" (never claims registered).
- `ArchitectureView` — three truth groups: Deployed (live GCP) / Built
  locally in this build (awaiting deployment approval) / Future (BigQuery,
  learning, telemetry — NOT deployed).
- **Human-approval wording fix**: the canonical Phase C v5 records contain
  NO durable approval artifact; all "gate satisfied"/"Human gate satisfied"
  copy was removed and replaced with labels derived strictly from the
  durable Guardian verdict (HUMAN REVIEW REQUIRED) and Authority decision
  (ALLOW). Absence tests cover every view.

## 6. Verification

- Full suite: **928 passed / 32 skipped / 0 failed** (130 files) — +58 tests
  since the P0 baseline.
- Web build green (`tsc && vite build`); all touched packages build.
- Visual QA: real Chrome 1440×900 captures of landing, full proof,
  SAFE Benchmark, Attack Lab, Provenance, 500 Stress, Developer SDK,
  Architecture — `artifacts/demo-qa-p0/` (+ filmstrips).

## 7. Deployables affected (NOT deployed)

- `apps/web` image (nav + four new surfaces + truth fixes) — needs a fresh
  plan when deployment is authorized.
- No Terraform state, no Firestore, no canonical record, no image was
  changed in this build.

## 8. Deployment + registration plan (not executed)

1. Review QA artifacts; approve web image; build + plan web-only change;
   apply the saved plan.
2. (Optional, later) deploy `integrations/google-adk` as its own Cloud Run
   service with HTTPS + `A2A_BASE_URL`; verify the card at
   `/.well-known/agent-card.json`.
3. (Optional, later) register the Agent Registry Service per
   `docs/agent-registry-readiness.md` (explicit human approval required —
   never automatic).

## 9. Remaining risks

- The 18 stress failures are documented harness/product findings (SUT
  detection gaps + the known blocker-#6 ordering defect). Fixing them would
  mean changing the deterministic SUT, not the fixtures — out of scope for
  this build and disclosed honestly on the 500 Stress page.
- `readEvidence` returns 422 in the live deploy (in-process store is empty);
  the SDK types it correctly but the capability is degraded today.
- ADK reference agent requires `GEMINI_API_KEY` to actually run; card +
  JSON-RPC wiring are smoke-tested without a model call.
- Agent Registry registration needs a public HTTPS A2A deployment first;
  nothing in this build claims otherwise.

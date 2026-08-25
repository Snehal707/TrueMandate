# Current-System Benchmark V2

## Status

BENCHMARK_V2 replaces no historical evidence. SAFE V1 remains immutable and is displayed as a `CANONICAL_HISTORICAL` procurement-era deterministic security baseline. The current-system page fails closed until a complete BENCHMARK_V2 run is accepted for the exact source inputs and a real source commit.

## Audit

The former benchmark page read generated TypeScript models compiled into the browser bundle. It did not query an API, Firestore, BigQuery, or a benchmark service. Its headline `472 / 500` and `40 / 500` values came from the August 18, 2026 SAFE V1 JSON/JSONL artifacts under `evals/safe/v1/stress`. Those runs used sequential in-memory deterministic adapters and legacy domain labels (`commerce`, `subscriptions`, and `payments`) in addition to procurement and travel.

SAFE V1 exercised semantic mutation, authority, prompt injection, TOCTOU, replay, stale evidence/state, outcomes, and resolution. Its `TRUEMANDATE_FULL` lane used procurement-shaped deterministic evaluation rather than the deployed `GenericWorkflowEngine`. It did not measure deployed concurrency, throughput, p50/p99 latency, resource pressure, failure recovery under load, or concurrent data consistency.

The earlier wide comparison graph was removed when `BenchmarkPage` was rewritten. Historical screenshots retain it, but no graph component or graph CSS remained connected to the current page. The replacement paired cards continued to consume the same SAFE read model. BENCHMARK_V2 restores charts from the accepted V2 read model rather than reconnecting the historical graph to current-system claims.

## Current Contract

Current DomainPack coverage is exactly:

- `procurement`
- `travel`
- `saas_it_spend`
- `invoice_vendor_payment`
- `logistics_fulfillment`

All domains use `GenericWorkflowEngine`; Procurement has no benchmark-only execution path. The explicit 50-scenario correctness corpus pairs every DomainPack with every scenario class. Each pair binds the same public semantic input to production-shaped current-system conformance evidence and the deterministic `BASELINE_SINGLE_AGENT`; a scenario-input hash prevents either lane from receiving a different case.

The immutable run contract includes paired correctness results, workflow and read load samples, Cloud Run resource samples, summaries, manifests, content hashes, source-input hashes, a corpus hash, a configuration hash, a real commit SHA, service revisions/digests, environment, job execution, timestamp, concurrency, and request counts.

The source-input hash covers benchmark schemas, scenario definitions, collection logic, the public SDK interface, GenericWorkflowEngine, Gateway execution interface, DomainPack interface, and all five registered pack implementations. A changed input invalidates the accepted browser model until a new run is accepted.

## Execution Lanes

The local production-shaped lane uses the real shared runtime/service seams, current DomainPacks, durable-store emulators, and deterministic economic adapter. Its independent 118-assertion conformance gate remains separate from the 50 paired comparison rows. It covers happy paths, action mismatches, stale state, replay and consumed authorization, expired authority, malformed requests, unauthorized callers, partial failures, concurrent races, provenance, multi-step materialization, and exactly-once commit behavior.

The isolated `tm-dev` Cloud Run Job uses only the public web API. It runs fresh workflow load at concurrency `1, 2, 4, 8, 16, 32` with 50 workflows per level and public read load at concurrency `1, 10, 25, 50` with 200 reads per level. The benchmark identity receives no owner writes, verifier authority, raw Gateway access, or economic execution authority.

Consequently, successful governed commit integrity is measured in the local production-shaped lane. The public load lane measures real cross-service workflow orchestration and public reads, but cannot manufacture trusted evidence or privileged execution. Granting such authority merely to satisfy a benchmark would violate the production boundary.

## Acceptance

Collection fails closed when any of the following is absent or stale:

- one of the five current DomainPacks;
- one of the ten required scenario classes;
- authorization, provenance, or replay evidence;
- workflow-write or public-read load samples;
- Cloud Run resource samples;
- a real 40-character source commit SHA;
- matching benchmark source-input hashes;
- matching corpus, configuration, and paired scenario-input hashes;
- both system variants for every domain/scenario-class pair;
- valid artifact content hashes.

An accepted run must have zero failed scenarios, zero unauthorized executions, and no duplicate economic effects. Load stops at the first sustained error or latency threshold. Resource samples identify CPU/memory pressure and the first observed bottleneck; otherwise the result explicitly records that no threshold was reached by the configured ceiling.

No public benchmark execution API and no product-database benchmark tables are introduced. The browser reads one generated, sanitized artifact model; charts and detailed tables consume that same object.

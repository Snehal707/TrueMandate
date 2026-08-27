# Reproducing the results

Everything in this repository's headline claims can be reproduced. Most of it
needs nothing but Node.js.

## Prerequisites

- Node.js ≥ 20
- pnpm 10 (`corepack enable`)

```bash
pnpm install
```

---

## Part 1 — No cloud account required

### Full test suite

```bash
npm test
```

**Expect: 1,878 passing, 11 failing, 32 skipped** across 244 test files.

The 11 failures are pre-existing and unrelated to the governance path — they sit
in `wave1-verifier` (8), `phase-c-verifier` (2), and `analytics-query` (1), and
predate the current work (those files were last modified at the baseline commit
`3c07933`). They are reported here rather than hidden. No test in
`packages/protocol`, `packages/authority`, `packages/guardian-core`,
`packages/semantic-readiness`, `packages/delegation`, `services/agent-runtime`,
or `services/gateway-service` is among them.

### Paired correctness — the headline result

```bash
npm run benchmark:v2:local
```

Expect `assertions: 118, pairedScenarios: 50, records: 100`, written to
`evals/benchmark/v2/local/<runId>/local-scenario-records.jsonl`.

To read the result out of that file:

```bash
node -e "const fs=require('fs');const d=process.argv[1];const r=fs.readFileSync(d,'utf8').trim().split(/\r?\n/).map(l=>JSON.parse(l));const b={},c={},u={};for(const x of r){const p=x.payload,v=p.systemVariant;b[v]=b[v]||{};b[v][p.status]=(b[v][p.status]||0)+1;if(p.criticalFailure)c[v]=(c[v]||0)+1;if(p.unauthorizedExecution)u[v]=(u[v]||0)+1}console.log(JSON.stringify({status:b,criticalFailure:c,unauthorizedExecution:u},null,2))" evals/benchmark/v2/local/<runId>/local-scenario-records.jsonl
```

Expected:

```json
{
  "status": {
    "CURRENT_SYSTEM":         { "PASS": 10, "EXPECTED_REJECTION": 40 },
    "BASELINE_SINGLE_AGENT":  { "PASS": 8,  "FAIL": 42 }
  },
  "criticalFailure":       { "BASELINE_SINGLE_AGENT": 40 },
  "unauthorizedExecution": { "BASELINE_SINGLE_AGENT": 28 }
}
```

The baseline performs **28 unauthorized economic executions**. TrueMandate
performs **zero**.

### Governance safety subsets

```bash
npm run safe:run
```

```bash
npx vitest run packages/semantic-readiness packages/authority packages/delegation packages/guardian-core
```

### Verify the committed benchmark evidence

Recompute the safety invariants across every committed run:

```bash
node -e "const fs=require('fs'),p=require('path'),b='evals/benchmark/v2/runs';let u=0,d=0,s=0,n=0;for(const x of fs.readdirSync(b)){const f=p.join(b,x,'result.json');if(!fs.existsSync(f))continue;const r=JSON.parse(fs.readFileSync(f,'utf8'));u+=r.unauthorizedExecutions||0;d+=r.duplicates||0;s+=r.sideEffects||0;n++}console.log({runs:n,unauthorizedExecutions:u,duplicates:d,sideEffects:s})"
```

Expected: `{ runs: 14, unauthorizedExecutions: 0, duplicates: 0, sideEffects: 0 }`.

Each bundle carries a `SHA256SUMS` file covering its own artifacts.

### Local Firestore emulator

```bash
node scripts/cloud/run-firestore-emulator.mjs
```

Concurrency and race tests then run against the emulator — see
[`architecture/local-emulator-guide.md`](architecture/local-emulator-guide.md).

---

## Part 2 — Requires Google Cloud

Needed only to re-run the **load qualification lane** (C1–C8) or to deploy your
own instance. Not needed for any claim in Part 1.

You will need a GCP project with Cloud Run, Firestore, Pub/Sub, Artifact
Registry, Secret Manager, and Vertex AI enabled, plus `gcloud` authenticated and
Terraform ≥ 1.5.

1. **Bootstrap** — `scripts/cloud/bootstrap.sh`
2. **Build images** — see [`../infrastructure/cloudbuild/README.md`](../infrastructure/cloudbuild/README.md)
3. **Apply infrastructure** — staged Terraform under `infrastructure/terraform/stages/` (foundation → runtime). Create your own `terraform.tfvars`; it is gitignored because it binds to a specific project and pins image digests.
4. **Verify** — `scripts/cloud/smoke.sh`
5. **Run a benchmark level** — execute the `tm-dev-benchmark-v2` Cloud Run Job with `TM_BENCHMARK_CONCURRENCY_LEVELS` set to the level you want.

Full detail: [`architecture/deploy-guide.md`](architecture/deploy-guide.md).

> **Note on cost and provider limits.** The load lane makes real Vertex AI Gemini
> calls — roughly 180+ model calls per 50-workflow level. C8 failures in this
> repository were caused by Vertex returning HTTP 429 `RESOURCE_EXHAUSTED` under
> concurrency. Expect your results at C8 to depend on your own quota and on
> shared regional capacity.

---

## Verifying the live deployment

```bash
curl -o /dev/null -w "%{http_code}\n" https://tm-dev-web-o2sz2wgoma-uc.a.run.app/demo
```

Expect `200`. The other ten services are internal-ingress only and reject
unauthenticated callers by design — a non-200 from those is correct behaviour,
not an outage.

---

## What you cannot reproduce from this repository

- **C8 passing.** It never passed. Three attempts are preserved under `evals/benchmark/v2/runs/`.
- **C16 / C32 / read-load.** Never run; the sequence gates each level on the previous one.
- **The exact deployed image digests**, unless you build from the same commits — `infrastructure/cloudbuild/` has the build configs.

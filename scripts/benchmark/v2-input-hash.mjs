import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const BENCHMARK_V2_INPUTS = [
  "packages/safe-benchmark/src/v2-contract.ts",
  "packages/safe-benchmark/src/v2-corpus.ts",
  "services/benchmark-runner/src/v2-fixtures.ts",
  "services/benchmark-runner/src/v2-runner.ts",
  "services/benchmark-runner/src/bin/v2-load-job.ts",
  "scripts/benchmark/run-v2-local-conformance.mjs",
  "scripts/benchmark/collect-v2-run.mjs",
  "scripts/demo/build-current-benchmark-readmodel.mjs",
  "scripts/benchmark/collect-v2-run.mjs",
  "packages/sdk-core/src/client.ts",
  "services/agent-runtime/src/domain-pack.ts",
  "services/agent-runtime/src/generic-workflow-engine.ts",
  "services/gateway-service/src/two-phase.ts",
  "services/agent-runtime/src/procurement-domain-pack.ts",
  "services/agent-runtime/src/travel-domain-pack.ts",
  "services/agent-runtime/src/saas-it-spend-domain-pack.ts",
  "services/agent-runtime/src/invoice-vendor-payment-domain-pack.ts",
  "services/agent-runtime/src/logistics-fulfillment-domain-pack.ts",
  "infrastructure/docker/Dockerfile.agent-runtime",
  "infrastructure/docker/Dockerfile.benchmark-runner",
];

export function benchmarkV2InputHash(root = process.cwd()) {
  const hash = createHash("sha256");
  for (const path of BENCHMARK_V2_INPUTS) {
    hash.update(path);
    hash.update("\0");
    hash.update(readFileSync(resolve(root, path)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  process.stdout.write(`${benchmarkV2InputHash()}\n`);
}

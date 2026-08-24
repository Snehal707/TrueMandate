#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MATRIX="${ROOT}/docs/architecture/iam-matrix.json"

echo "[safe-cloud-subset] Validating IAM matrix structure"

node -e "
const fs = require('node:fs');
const matrix = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const required = ['invoke', 'publish', 'subscribe', 'firestore', 'vertex', 'armor', 'secrets', 'forbiddenCapabilities'];
for (const [sa, caps] of Object.entries(matrix.serviceAccounts)) {
  for (const key of required) {
    if (!(key in caps)) throw new Error('Missing ' + key + ' for ' + sa);
  }
  if (!Array.isArray(caps.forbiddenCapabilities) || caps.forbiddenCapabilities.length === 0) {
    throw new Error('forbiddenCapabilities empty for ' + sa);
  }
}
console.log('iam-matrix.json OK:', Object.keys(matrix.serviceAccounts).length, 'service accounts');
" "$MATRIX"

echo "[safe-cloud-subset] public-api architecture ban"
cd "$ROOT"
pnpm vitest run packages/public-api/src/architecture-ban.test.ts

echo "[safe-cloud-subset] SAFE cloud golden subset (toSutPublicInput; holdout sealed)"
pnpm safe:cloud

echo "[safe-cloud-subset] Firestore + Pub/Sub + security adapter tests"
pnpm vitest run packages/cloud-firestore packages/cloud-pubsub packages/cloud-security

echo "[safe-cloud-subset] Done"

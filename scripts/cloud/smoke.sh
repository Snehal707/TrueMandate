#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROJECT_ID=""
ENVIRONMENT="dev"
REGION="us-central1"

usage() {
  echo "Usage: $0 --project-id ID [--environment ENV] [--region REGION]"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-id) PROJECT_ID="$2"; shift 2 ;;
    --environment) ENVIRONMENT="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    *) usage ;;
  esac
done

[[ -n "$PROJECT_ID" ]] || usage

PREFIX="tm-${ENVIRONMENT}"
SERVICES=(public-bff observability-api gateway)

for svc in "${SERVICES[@]}"; do
  URL="$(gcloud run services describe "${PREFIX}-${svc}" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --format='value(status.url)' 2>/dev/null || true)"
  if [[ -z "$URL" ]]; then
    echo "[smoke] skip ${svc} — not deployed"
    continue
  fi
  echo "[smoke] GET ${URL}/healthz"
  curl -fsS "${URL}/healthz" | head -c 200
  echo
  echo "[smoke] GET ${URL}/readyz"
  curl -fsS "${URL}/readyz" | head -c 200
  echo
done

echo "[smoke] Local public-api tests (no live GCP)"
cd "$ROOT"
pnpm vitest run packages/public-api/src

echo "[smoke] Done"

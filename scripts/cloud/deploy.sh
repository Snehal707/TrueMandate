#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROJECT_ID=""
REGION="us-central1"
TAG="dev"
REPO="truemandate"

usage() {
  echo "Usage: $0 --project-id ID [--region REGION] [--tag TAG]"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-id) PROJECT_ID="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    --tag) TAG="$2"; shift 2 ;;
    *) usage ;;
  esac
done

[[ -n "$PROJECT_ID" ]] || usage

REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}"

gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

build_push() {
  local name="$1"
  local dockerfile="$2"
  echo "[deploy] Building ${name}"
  docker build --platform linux/amd64 -f "${ROOT}/infrastructure/docker/${dockerfile}" -t "${REGISTRY}/${name}:${TAG}" "${ROOT}"
  docker push "${REGISTRY}/${name}:${TAG}"
}

build_push public-bff Dockerfile.public-bff
build_push gateway Dockerfile.gateway
build_push intent-provenance Dockerfile.intent-provenance
build_push authority Dockerfile.authority
build_push outcome-resolution Dockerfile.outcome-resolution
build_push agent-runtime Dockerfile.agent-runtime
build_push observability-api Dockerfile.observability-api
build_push web Dockerfile.web
build_push attack-lab Dockerfile.attack-lab
build_push benchmark-runner Dockerfile.benchmark-runner

echo "[deploy] Images pushed to ${REGISTRY} with tag ${TAG}"

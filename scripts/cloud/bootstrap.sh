#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROJECT_ID=""
REGION="us-central1"

usage() {
  echo "Usage: $0 --project-id ID [--region REGION]"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-id) PROJECT_ID="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    *) usage ;;
  esac
done

[[ -n "$PROJECT_ID" ]] || usage

echo "[bootstrap] Enabling APIs for project ${PROJECT_ID} (${REGION})"
gcloud config set project "$PROJECT_ID"
gcloud services enable \
  run.googleapis.com \
  firestore.googleapis.com \
  pubsub.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  aiplatform.googleapis.com \
  iam.googleapis.com

echo "[bootstrap] Terraform init"
cd "${ROOT}/infrastructure/terraform"
terraform init

echo "[bootstrap] Done. Next: terraform apply -var=\"project_id=${PROJECT_ID}\""

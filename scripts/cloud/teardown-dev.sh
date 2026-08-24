#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROJECT_ID=""
ENVIRONMENT="dev"

usage() {
  echo "Usage: $0 --project-id ID [--environment ENV]"
  echo "WARNING: destroys dev Terraform-managed resources."
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-id) PROJECT_ID="$2"; shift 2 ;;
    --environment) ENVIRONMENT="$2"; shift 2 ;;
    *) usage ;;
  esac
done

[[ -n "$PROJECT_ID" ]] || usage

if [[ "$ENVIRONMENT" == "prod" ]]; then
  echo "Refusing to teardown prod"
  exit 1
fi

cd "${ROOT}/infrastructure/terraform"
terraform destroy -auto-approve \
  -var="project_id=${PROJECT_ID}" \
  -var="environment=${ENVIRONMENT}"

echo "[teardown-dev] Complete"

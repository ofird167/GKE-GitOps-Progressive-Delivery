#!/usr/bin/env bash
# scripts/destroy.sh: Safe teardown of all GCP and GKE resources.

set -euo pipefail

WORKSPACE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${WORKSPACE_DIR}/logs"
LOG_FILE="${LOG_DIR}/destroy.log"
ENV_FILE="${WORKSPACE_DIR}/secrets/.env"

# Safe confirmation prompt
read -p "WARNING: This will completely delete the GKE cluster, persistent storage disks, and all GCP resources. Are you sure? (y/N) " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
  echo "Teardown aborted."
  exit 1
fi

# Ensure log directory exists
mkdir -p "${LOG_DIR}"
echo "=== Destroy Log Started at $(date) ===" > "${LOG_FILE}"

# Load environment variables
if [ -f "${ENV_FILE}" ]; then
  set -a
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ ! "$line" =~ ^# ]] && [[ -n "$line" ]]; then
      eval "$line"
    fi
  done < "${ENV_FILE}"
  set +a
else
  echo "[ERROR] Failed to locate secrets/.env file!" >&2
  exit 1
fi

GCP_REGION="${GCP_REGION:-us-central1}"
GCP_ZONE="${GCP_ZONE:-us-central1-a}"
GKE_CLUSTER_NAME="${GKE_CLUSTER_NAME:-devops}"
DB_USER="${DB_USER:-dbadmin}"
DB_NAME="${DB_NAME:-app_db}"
owner="${owner:-ofir}"
environment="${environment:-production}"

# Redirect output with DB password masking
exec > >(tee -a "${LOG_FILE}" | sed -u "s/${DB_PASSWORD}/[MASKED_DB_PASSWORD]/g") 2>&1

log_info() {
  echo "[INFO] $(date): $1"
}

log_info "Connecting to GKE cluster to clean up Kubernetes load balancers & storage..."
gcloud container clusters get-credentials "${GKE_CLUSTER_NAME}" --zone "${GCP_ZONE}" --project "${GCP_PROJECT_ID}" || true

log_info "Deleting ArgoCD ApplicationSet and AppProject..."
kubectl delete -f "${WORKSPACE_DIR}/argocd/appsets/platform-apps-appset.yaml" --ignore-not-found=true || true
kubectl delete -f "${WORKSPACE_DIR}/argocd/projects/platform-apps.yaml" --ignore-not-found=true || true

log_info "Deleting staging and production namespaces (deletes all deployments, pods, and PVCs)..."
kubectl delete namespace staging production --ignore-not-found=true || true

log_info "Deleting monitoring, argocd, external-secrets, and istio namespaces..."
kubectl delete namespace monitoring argocd external-secrets istio-system --ignore-not-found=true || true

log_info "Waiting for resources to terminate..."
sleep 30

log_info "Executing Terraform Destroy..."
cd "${WORKSPACE_DIR}/infra/terraform"

export TF_VAR_project_id="${GCP_PROJECT_ID}"
export TF_VAR_region="${GCP_REGION}"
export TF_VAR_zone="${GCP_ZONE}"
export TF_VAR_cluster_name="${GKE_CLUSTER_NAME}"
export TF_VAR_owner="${owner}"
export TF_VAR_environment="${environment}"
export TF_VAR_db_user="${DB_USER}"
export TF_VAR_db_password="${DB_PASSWORD}"
export TF_VAR_db_name="${DB_NAME}"
export TF_VAR_backend_api_key="${BACKEND_API_KEY}"

terraform destroy -auto-approve

log_info "Teardown complete!"
echo "AWS/GCP environment is clean."

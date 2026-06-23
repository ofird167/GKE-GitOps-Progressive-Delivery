#!/usr/bin/env bash
# scripts/bootstrap.sh: Master bootstrap orchestrator for the GKE GitOps platform.

set -euo pipefail

WORKSPACE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${WORKSPACE_DIR}/logs"
LOG_FILE="${LOG_DIR}/bootstrap.log"
ENV_FILE="${WORKSPACE_DIR}/secrets/.env"

# Ensure log directory exists
mkdir -p "${LOG_DIR}"
echo "=== Bootstrap Log Started at $(date) ===" > "${LOG_FILE}"

# Load environment variables
if [ -f "${ENV_FILE}" ]; then
  # Load env variables without exporting them directly (to avoid process leaking)
  set -a
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ ! "$line" =~ ^# ]] && [[ -n "$line" ]]; then
      eval "$line"
    fi
  done < "${ENV_FILE}"
  set +a
else
  echo "[ERROR] Failed to locate secrets/.env file! Please populate secrets/.env from example.env first." >&2
  exit 1
fi

# Fallback values
GCP_REGION="${GCP_REGION:-us-central1}"
GCP_ZONE="${GCP_ZONE:-us-central1-a}"
GKE_CLUSTER_NAME="${GKE_CLUSTER_NAME:-devops}"
DB_USER="${DB_USER:-dbadmin}"
DB_NAME="${DB_NAME:-app_db}"
owner="${OWNER:-${owner:-ofir}}"
environment="${environment:-production}"

# Redirect stdout/stderr to log file with secret masking
exec > >(tee -a "${LOG_FILE}" | sed -u -e "s/${DB_PASSWORD}/[MASKED_DB_PASSWORD]/g" -e "s/${BACKEND_API_KEY}/[MASKED_API_KEY]/g") 2>&1

log_info() {
  echo "[INFO] $(date): $1"
}

log_error() {
  echo "[ERROR] $(date): $1" >&2
}

log_info "Starting bootstrap for GKE cluster '${GKE_CLUSTER_NAME}' in project '${GCP_PROJECT_ID}'..."

# 1. Run Terraform Apply
log_info "Deploying Google Cloud Infrastructure via Terraform..."
cd "${WORKSPACE_DIR}/infra/terraform"

# Set Terraform variables dynamically via TF_VAR_ prefix injection pattern
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

terraform init -backend-config="bucket=${GCS_BUCKET_NAME}"
terraform apply -auto-approve

# Retrieve outputs
GAR_URL=$(terraform output -raw artifact_registry_url)
cd "${WORKSPACE_DIR}"

# 2. Get GKE Credentials
log_info "Connecting to GKE cluster..."
gcloud container clusters get-credentials "${GKE_CLUSTER_NAME}" --zone "${GCP_ZONE}" --project "${GCP_PROJECT_ID}"

# 3. Build and Push App Images to Artifact Registry
log_info "Building and pushing application Docker images..."
gcloud auth configure-docker "${GCP_REGION}-docker.pkg.dev" --quiet

docker build -t "${GAR_URL}/backend:latest" "${WORKSPACE_DIR}/apps/src/backend"
docker build -t "${GAR_URL}/frontend:latest" "${WORKSPACE_DIR}/apps/src/frontend"
docker push "${GAR_URL}/backend:latest"
docker push "${GAR_URL}/frontend:latest"

# 4. Bootstrap Helm Charts
log_info "Installing External Secrets Operator (ESO)..."
helm repo add external-secrets https://charts.external-secrets.io
helm repo update
helm upgrade --install external-secrets external-secrets/external-secrets \
  -n external-secrets --create-namespace \
  -f "${WORKSPACE_DIR}/infra/helm-values/external-secrets-values.yaml" \
  --set serviceAccount.annotations."iam\.gke\.io/gcp-service-account"="devops-eso-sa@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
  --wait

log_info "Installing Istio Service Mesh (Base, Control Plane, Ingress)..."
helm repo add istio https://istio-release.storage.googleapis.com/charts
helm repo update
helm upgrade --install istio-base istio/base -n istio-system --create-namespace --wait
helm upgrade --install istiod istio/istiod -n istio-system \
  -f "${WORKSPACE_DIR}/infra/helm-values/istio-values.yaml" --wait
helm upgrade --install istio-ingress istio/gateway -n istio-system \
  -f "${WORKSPACE_DIR}/infra/helm-values/istio-ingress-values.yaml" --wait

log_info "Waiting for Istio Ingress Gateway external IP allocation..."
INGRESS_IP=""
for i in {1..30}; do
  INGRESS_IP=$(kubectl get svc -n istio-system istio-ingress -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
  if [ -n "${INGRESS_IP}" ]; then
    break
  fi
  sleep 10
done

if [ -z "${INGRESS_IP}" ]; then
  log_error "Failed to retrieve Ingress Gateway external IP. Falling back to placeholder."
  INGRESS_IP="PENDING"
fi
export INGRESS_IP
log_info "Allocated Ingress IP: ${INGRESS_IP}"

log_info "Installing ArgoCD..."
helm repo add argo https://argoproj.github.io/argo-helm
helm repo update
helm upgrade --install argoccd argo/argo-cd \
  -n argocd --create-namespace \
  -f "${WORKSPACE_DIR}/infra/helm-values/argocd-values.yaml" --wait

if [ -n "${GIT_PAT:-}" ]; then
  log_info "Creating ArgoCD repository credentials..."
  kubectl create secret generic interview11-repo \
    -n argocd \
    --from-literal=url="${GIT_REPO_URL}" \
    --from-literal=username="${GIT_USERNAME:-ofird167}" \
    --from-literal=password="${GIT_PAT}" \
    --dry-run=client -o yaml | kubectl apply -f -
  kubectl label secret interview11-repo -n argocd argocd.argoproj.io/secret-type=repository --overwrite
fi

log_info "Installing Argo Rollouts..."
kubectl create namespace argo-rollouts --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -n argo-rollouts -f https://github.com/argoproj/argo-rollouts/releases/latest/download/install.yaml

log_info "Installing Prometheus Observability stack..."
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm upgrade --install prometheus prometheus-community/kube-prometheus-stack \
  -n monitoring --create-namespace \
  -f "${WORKSPACE_DIR}/infra/helm-values/prometheus-values.yaml" --wait

# 5. Render templates and push to Git
log_info "Rendering template configurations..."
# Export variables for envsubst
export GCP_PROJECT_ID
export GIT_REPO_URL

# Render templates
export GAR_URL
envsubst < "${WORKSPACE_DIR}/apps/base/secret-store.yaml.tmpl" > "${WORKSPACE_DIR}/apps/base/secret-store.yaml"
envsubst < "${WORKSPACE_DIR}/argocd/projects/platform-apps.yaml.tmpl" > "${WORKSPACE_DIR}/argocd/projects/platform-apps.yaml"
envsubst < "${WORKSPACE_DIR}/argocd/appsets/platform-apps-appset.yaml.tmpl" > "${WORKSPACE_DIR}/argocd/appsets/platform-apps-appset.yaml"
envsubst < "${WORKSPACE_DIR}/apps/base/kustomization.yaml.tmpl" > "${WORKSPACE_DIR}/apps/base/kustomization.yaml"
envsubst < "${WORKSPACE_DIR}/apps/base/configmap.yaml.tmpl" > "${WORKSPACE_DIR}/apps/base/configmap.yaml"

log_info "Committing configurations and pushing to GitOps repository..."
# Configure git if needed
git config user.name "${GIT_USERNAME:-ofird167}"
git config user.email "${GIT_EMAIL:-ofirrdd@gmail.com}"

# Ensure we track staging and production overlay directories
git add .
git commit -m "Initialize DevOps platform with GKE and GitOps" || true
git push -u origin main

# Create namespaces and enable Istio injection before deploying applications
kubectl create namespace staging --dry-run=client -o yaml | kubectl apply -f -
kubectl label namespace staging istio-injection=enabled --overwrite

kubectl create namespace production --dry-run=client -o yaml | kubectl apply -f -
kubectl label namespace production istio-injection=enabled --overwrite

# 6. Apply AppProject and ApplicationSet to ArgoCD
log_info "Applying GitOps Application configuration..."
kubectl apply -f "${WORKSPACE_DIR}/argocd/projects/platform-apps.yaml"
kubectl apply -f "${WORKSPACE_DIR}/argocd/appsets/platform-apps-appset.yaml"

log_info "Bootstrap complete!"

echo "------------------------------------------------------------"
echo " BOOTSTRAP COMPLETE"
echo "------------------------------------------------------------"
echo " Ingress Domain:        app.local"
echo " Istio Ingress IP:      ${INGRESS_IP:-PENDING}"
echo ""
echo " To map the domain locally, add the following to hosts file:"
echo " ${INGRESS_IP:-<INGRESS_IP>}  app.local"
echo "------------------------------------------------------------"

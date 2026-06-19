# DevOps Quickstart Guide (TL;DR)

> 📚 **Looking for full architectural details and guides?** View the [Detailed README](README.md).

---

### 1. Initialize Secrets & Configuration
Create the `secrets/` directory and populate your configuration values:
```bash
mkdir -p secrets
cp example.env secrets/.env
```
Open `secrets/.env` and update the values with your active GCP credentials, Project ID, GCS state bucket, and other customized environment details.

---

### 2. Bootstrap the Cluster (All-in-One)
Run the master bootstrap orchestrator. This script will provision the VPC networks, Google Artifact Registry, private GKE cluster, GCP Secret Manager secrets, build/push the application container images, deploy core platform charts (Istio Service Mesh, External Secrets Operator, Prometheus, ArgoCD, Argo Rollouts), and configure the GitOps syncer:
```bash
./scripts/bootstrap.sh
```

---

### 3. Map DNS Routing
Retrieve the Istio Ingress LoadBalancer public IP using:
```bash
kubectl get svc -n istio-system istio-ingress
```
Map this external IP to the local domain `app.local` in your hosts file:
*   **Linux/WSL hosts**:
    ```bash
    echo "<INGRESS_IP> app.local" | sudo tee -a /etc/hosts
    ```
*   **Windows Hosts (Administrator PowerShell)**:
    ```powershell
    Add-Content -Path "C:\Windows\System32\drivers\etc\hosts" -Value "`n<INGRESS_IP> `t app.local"
    ```

---

### 4. Verify Dashboard & Canary Routing
*   **Browser Dashboard**: Access `http://app.local` in your web browser to view the Ops Hub Dashboard.
*   **Canary Split Verification**: Navigate to the **Diagnostics & Canary** tab on the dashboard, click **Trigger 100 Requests**, and verify the traffic routing distribution between the stable and canary deployments.
*   **Database Persistence Test**: Navigate to the **Database & PVC** tab, write visits to PostgreSQL, delete the PostgreSQL pod (`kubectl delete pod -l app=postgres`), and confirm that the visit count is preserved after the pod restarts.

---

### 5. Clean Teardown
To cleanly delete all workloads, release GCP LoadBalancers, and destroy all GKE cluster and network resources to avoid runaway billing:
```bash
./scripts/destroy.sh
```

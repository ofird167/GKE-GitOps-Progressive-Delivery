resource "google_artifact_registry_repository" "repo" {
  location      = var.region
  repository_id = "${var.cluster_name}-repo"
  description   = "Docker registry for interview11 app"
  format        = "DOCKER"

  labels = {
    environment = var.environment
    owner       = var.owner
    managed_by  = "terraform"
  }
}

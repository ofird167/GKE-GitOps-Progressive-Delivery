output "project_id" {
  value       = var.project_id
  description = "The GCP Project ID."
}

output "region" {
  value       = var.region
  description = "The GCP region."
}

output "zone" {
  value       = var.zone
  description = "The GCP zone."
}

output "gke_connection_command" {
  value       = "gcloud container clusters get-credentials ${google_container_cluster.primary.name} --zone ${google_container_cluster.primary.location} --project ${var.project_id}"
  description = "The command to update local kubeconfig and connect to the cluster."
}

output "gke_cluster_endpoint" {
  value       = google_container_cluster.primary.endpoint
  description = "The endpoint URL of the GKE cluster."
}

output "artifact_registry_url" {
  value       = "${google_artifact_registry_repository.repo.location}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.repo.repository_id}"
  description = "The URL of the Artifact Registry repository."
}

output "eso_service_account_email" {
  value       = google_service_account.eso_sa.email
  description = "The email address of the GCP service account for ESO."
}

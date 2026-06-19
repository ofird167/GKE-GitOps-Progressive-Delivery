resource "google_secret_manager_secret" "db_user" {
  secret_id = "postgres-user"

  replication {
    auto {}
  }

  labels = {
    environment = var.environment
    owner       = var.owner
    managed_by  = "terraform"
  }
}

resource "google_secret_manager_secret_version" "db_user_version" {
  secret      = google_secret_manager_secret.db_user.id
  secret_data = var.db_user
}

resource "google_secret_manager_secret_iam_member" "eso_db_user_accessor" {
  secret_id = google_secret_manager_secret.db_user.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.eso_sa.email}"
}

resource "google_secret_manager_secret" "db_password" {
  secret_id = "postgres-password"

  replication {
    auto {}
  }

  labels = {
    environment = var.environment
    owner       = var.owner
    managed_by  = "terraform"
  }
}

resource "google_secret_manager_secret_version" "db_password_version" {
  secret      = google_secret_manager_secret.db_password.id
  secret_data = var.db_password
}

resource "google_secret_manager_secret_iam_member" "eso_db_password_accessor" {
  secret_id = google_secret_manager_secret.db_password.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.eso_sa.email}"
}

resource "google_secret_manager_secret" "db_name" {
  secret_id = "postgres-db"

  replication {
    auto {}
  }

  labels = {
    environment = var.environment
    owner       = var.owner
    managed_by  = "terraform"
  }
}

resource "google_secret_manager_secret_version" "db_name_version" {
  secret      = google_secret_manager_secret.db_name.id
  secret_data = var.db_name
}

resource "google_secret_manager_secret_iam_member" "eso_db_name_accessor" {
  secret_id = google_secret_manager_secret.db_name.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.eso_sa.email}"
}

resource "google_secret_manager_secret" "api_key" {
  secret_id = "backend-api-key"

  replication {
    auto {}
  }

  labels = {
    environment = var.environment
    owner       = var.owner
    managed_by  = "terraform"
  }
}

resource "google_secret_manager_secret_version" "api_key_version" {
  secret      = google_secret_manager_secret.api_key.id
  secret_data = var.backend_api_key
}

resource "google_secret_manager_secret_iam_member" "eso_api_key_accessor" {
  secret_id = google_secret_manager_secret.api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.eso_sa.email}"
}

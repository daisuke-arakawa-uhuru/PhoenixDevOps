locals {
  source_archive_output_path = "${path.root}/.terraform/${var.function_name}.zip"
  source_archive_name        = "functions/${var.function_name}/${data.archive_file.source.output_sha256}.zip"
}

data "archive_file" "source" {
  type             = "zip"
  source_dir       = var.source_dir
  output_path      = local.source_archive_output_path
  output_file_mode = "0644"

  excludes = [
    ".env",
    ".env.*",
    ".DS_Store",
    "coverage/**",
    "dist/**",
    "node_modules/**",
    "test/**",
  ]
}

resource "google_storage_bucket" "source" {
  project  = var.project_id
  name     = var.source_bucket_name
  location = var.source_bucket_location

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  lifecycle_rule {
    condition {
      age            = var.source_archive_retention_days
      matches_prefix = ["functions/${var.function_name}/"]
    }
    action {
      type = "Delete"
    }
  }
}

resource "google_storage_bucket_object" "source_archive" {
  name         = local.source_archive_name
  bucket       = google_storage_bucket.source.name
  source       = data.archive_file.source.output_path
  content_type = "application/zip"
}

resource "google_service_account" "api" {
  project      = var.project_id
  account_id   = var.api_service_account_id
  display_name = "PhoenixDevOps drift HTTP API runtime"
}

resource "google_storage_bucket_iam_member" "api_assets_object_admin" {
  bucket = var.assets_bucket_name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "api_firestore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "api_tasks_enqueuer" {
  project = var.project_id
  role    = "roles/cloudtasks.enqueuer"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_service_account_iam_member" "api_act_as_task_invoker" {
  service_account_id = "projects/${var.project_id}/serviceAccounts/${var.task_invoker_service_account_email}"
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.api.email}"
}

resource "google_service_account_iam_member" "api_self_token_creator" {
  service_account_id = google_service_account.api.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.api.email}"
}

resource "google_cloudfunctions2_function" "api" {
  project     = var.project_id
  name        = var.function_name
  location    = var.location
  description = "PhoenixDevOps document drift HTTP API"

  build_config {
    runtime     = var.runtime
    entry_point = var.entry_point

    source {
      storage_source {
        bucket = google_storage_bucket.source.name
        object = google_storage_bucket_object.source_archive.name
      }
    }
  }

  service_config {
    available_memory                 = var.available_memory
    timeout_seconds                  = var.timeout_seconds
    min_instance_count               = var.min_instance_count
    max_instance_count               = var.max_instance_count
    max_instance_request_concurrency = var.max_instance_request_concurrency
    ingress_settings                 = var.ingress_settings
    all_traffic_on_latest_revision   = true
    service_account_email            = google_service_account.api.email

    environment_variables = {
      UPLOADS_BUCKET                = var.assets_bucket_name
      FIRESTORE_UPLOADS_COLLECTION  = var.firestore_uploads_collection
      FIRESTORE_JOBS_COLLECTION     = var.firestore_jobs_collection
      TASKS_PROJECT_ID              = var.project_id
      TASKS_LOCATION                = var.location
      TASKS_QUEUE                   = var.tasks_queue_name
      WORKER_URL                    = var.worker_url
      TASKS_SERVICE_ACCOUNT_EMAIL   = var.task_invoker_service_account_email
      SIGNED_URL_EXPIRATION_SECONDS = tostring(var.signed_url_expiration_seconds)
      UPLOADS_PREFIX_TEMPLATE       = var.uploads_prefix_template
      RESULTS_PREFIX_TEMPLATE       = var.results_prefix_template
      MAX_DOCUMENT_FILES            = tostring(var.max_document_files)
    }
  }

  depends_on = [
    google_project_iam_member.api_firestore_user,
    google_project_iam_member.api_tasks_enqueuer,
    google_service_account_iam_member.api_act_as_task_invoker,
    google_service_account_iam_member.api_self_token_creator,
    google_storage_bucket_iam_member.api_assets_object_admin,
  ]
}

resource "google_cloudfunctions2_function_iam_member" "public_invoker" {
  count = var.allow_unauthenticated ? 1 : 0

  project        = google_cloudfunctions2_function.api.project
  location       = google_cloudfunctions2_function.api.location
  cloud_function = google_cloudfunctions2_function.api.name
  role           = "roles/cloudfunctions.invoker"
  member         = "allUsers"
}

resource "google_cloud_run_service_iam_member" "public_invoker" {
  count = var.allow_unauthenticated ? 1 : 0

  project  = google_cloudfunctions2_function.api.project
  location = google_cloudfunctions2_function.api.location
  service  = google_cloudfunctions2_function.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

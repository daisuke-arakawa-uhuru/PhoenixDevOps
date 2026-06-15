locals {
  source_archive_output_path          = "${path.root}/.terraform/${var.function_name}.zip"
  source_archive_name                 = "functions/${var.function_name}/${data.archive_file.source.output_sha256}.zip"
  cloud_functions_build_account_email = "${data.google_project.current.number}-compute@developer.gserviceaccount.com"
}

data "google_project" "current" {
  project_id = var.project_id
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

resource "google_service_account" "worker" {
  project      = var.project_id
  account_id   = var.worker_service_account_id
  display_name = "PhoenixDevOps analysis worker runtime"
}

resource "google_service_account" "task_invoker" {
  project      = var.project_id
  account_id   = var.task_invoker_service_account_id
  display_name = "PhoenixDevOps analysis task invoker"
}

resource "google_storage_bucket_iam_member" "worker_assets_object_admin" {
  bucket = var.assets_bucket_name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_project_iam_member" "worker_firestore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_project_iam_member" "build_storage_object_viewer" {
  project = var.project_id
  role    = "roles/storage.objectViewer"
  member  = "serviceAccount:${local.cloud_functions_build_account_email}"
}

resource "google_project_iam_member" "build_artifact_registry_writer" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${local.cloud_functions_build_account_email}"
}

resource "google_project_iam_member" "build_logs_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${local.cloud_functions_build_account_email}"
}

resource "time_sleep" "wait_for_build_iam_propagation" {
  create_duration = var.build_iam_propagation_wait_duration

  depends_on = [
    google_project_iam_member.build_artifact_registry_writer,
    google_project_iam_member.build_logs_writer,
    google_project_iam_member.build_storage_object_viewer,
  ]
}

resource "google_secret_manager_secret_iam_member" "worker_gemini_api_key_accessor" {
  count = var.gemini_api_key_secret_id == null ? 0 : 1

  project   = var.project_id
  secret_id = var.gemini_api_key_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_cloudfunctions2_function" "worker" {
  project     = var.project_id
  name        = var.function_name
  location    = var.location
  description = "PhoenixDevOps document drift analysis worker"

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
    available_memory                = var.available_memory
    timeout_seconds                 = var.timeout_seconds
    min_instance_count              = var.min_instance_count
    max_instance_count              = var.max_instance_count
    max_instance_request_concurrency = var.max_instance_request_concurrency
    ingress_settings                = var.ingress_settings
    all_traffic_on_latest_revision  = true
    service_account_email           = google_service_account.worker.email

    environment_variables = {
      FIRESTORE_JOBS_COLLECTION = var.firestore_jobs_collection
      RESULTS_BUCKET            = var.assets_bucket_name
      RESULTS_PREFIX_TEMPLATE   = var.results_prefix_template
      GEMINI_MODEL              = var.gemini_model
      GEMINI_DRY_RUN            = tostring(var.gemini_dry_run)
    }

    dynamic "secret_environment_variables" {
      for_each = var.gemini_api_key_secret_id == null ? [] : [var.gemini_api_key_secret_id]

      content {
        key        = "GEMINI_API_KEY"
        project_id = var.project_id
        secret     = secret_environment_variables.value
        version    = var.gemini_api_key_secret_version
      }
    }
  }

  depends_on = [
    time_sleep.wait_for_build_iam_propagation,
    google_project_iam_member.worker_firestore_user,
    google_secret_manager_secret_iam_member.worker_gemini_api_key_accessor,
    google_storage_bucket_iam_member.worker_assets_object_admin,
  ]
}

resource "google_cloudfunctions2_function_iam_member" "task_invoker" {
  project        = google_cloudfunctions2_function.worker.project
  location       = google_cloudfunctions2_function.worker.location
  cloud_function = google_cloudfunctions2_function.worker.name
  role           = "roles/cloudfunctions.invoker"
  member         = "serviceAccount:${google_service_account.task_invoker.email}"
}

resource "google_cloud_run_service_iam_member" "task_invoker" {
  project  = google_cloudfunctions2_function.worker.project
  location = google_cloudfunctions2_function.worker.location
  service  = google_cloudfunctions2_function.worker.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.task_invoker.email}"
}

locals {
  source_archive_output_path = "${path.root}/.terraform/${var.function_name}.zip"
  source_archive_name        = "functions/${var.function_name}/${data.archive_file.source.output_sha256}.zip"
}

resource "google_storage_bucket" "ui" {
  project       = var.project_id
  name          = var.bucket_name
  location      = var.source_bucket_location
  force_destroy = var.force_destroy

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
    "node_modules/**",
  ]
}

resource "google_storage_bucket_object" "source_archive" {
  name         = local.source_archive_name
  bucket       = google_storage_bucket.ui.name
  source       = data.archive_file.source.output_path
  content_type = "application/zip"
}

resource "google_cloudfunctions2_function" "ui" {
  project     = var.project_id
  name        = var.function_name
  location    = var.location
  description = "PhoenixDevOps Web UI"

  build_config {
    runtime     = var.runtime
    entry_point = var.entry_point

    source {
      storage_source {
        bucket = google_storage_bucket.ui.name
        object = google_storage_bucket_object.source_archive.name
      }
    }
  }

  service_config {
    available_memory                 = var.available_memory
    available_cpu                    = var.available_cpu
    timeout_seconds                  = var.timeout_seconds
    min_instance_count               = var.min_instance_count
    max_instance_count               = var.max_instance_count
    max_instance_request_concurrency = var.max_instance_request_concurrency
    ingress_settings                 = var.ingress_settings
    all_traffic_on_latest_revision   = true

    environment_variables = {
      API_URL  = var.api_url
      USE_MOCK = tostring(var.use_mock)
    }
  }

  lifecycle {
    precondition {
      condition     = tonumber(var.available_cpu) >= 1 || var.max_instance_request_concurrency == 1
      error_message = "Cloud Run requires max_instance_request_concurrency = 1 when available_cpu is less than 1."
    }

    precondition {
      condition     = fileexists("${var.source_dir}/dist/index.html")
      error_message = "Web UI build output is missing. Run `npm ci && npm run build` in apps/ui before Terraform plan/apply."
    }
  }
}

resource "google_cloudfunctions2_function_iam_member" "public_invoker" {
  count = var.allow_unauthenticated ? 1 : 0

  project        = google_cloudfunctions2_function.ui.project
  location       = google_cloudfunctions2_function.ui.location
  cloud_function = google_cloudfunctions2_function.ui.name
  role           = "roles/cloudfunctions.invoker"
  member         = "allUsers"
}

resource "google_cloud_run_service_iam_member" "public_invoker" {
  count = var.allow_unauthenticated ? 1 : 0

  project  = google_cloudfunctions2_function.ui.project
  location = google_cloudfunctions2_function.ui.location
  service  = google_cloudfunctions2_function.ui.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

locals {
  dist_files = var.deploy_dist ? try(fileset(var.dist_dir, "**"), []) : []

  content_types = {
    css   = "text/css; charset=utf-8"
    gif   = "image/gif"
    html  = "text/html; charset=utf-8"
    ico   = "image/x-icon"
    jpg   = "image/jpeg"
    jpeg  = "image/jpeg"
    js    = "text/javascript; charset=utf-8"
    json  = "application/json; charset=utf-8"
    map   = "application/json; charset=utf-8"
    png   = "image/png"
    svg   = "image/svg+xml"
    txt   = "text/plain; charset=utf-8"
    webp  = "image/webp"
    woff  = "font/woff"
    woff2 = "font/woff2"
  }

  dist_file_extensions = {
    for file_name in local.dist_files :
    file_name => lower(element(split(".", file_name), length(split(".", file_name)) - 1))
  }
}

resource "google_storage_bucket" "ui" {
  project       = var.project_id
  name          = var.bucket_name
  location      = var.location
  force_destroy = var.force_destroy

  uniform_bucket_level_access = true
  public_access_prevention    = var.allow_public_access ? "inherited" : "enforced"

  website {
    main_page_suffix = "index.html"
    not_found_page   = "index.html"
  }
}

resource "google_storage_bucket_iam_member" "public_viewer" {
  count = var.allow_public_access ? 1 : 0

  bucket = google_storage_bucket.ui.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

resource "google_storage_bucket_object" "runtime_config" {
  bucket = google_storage_bucket.ui.name
  name   = var.runtime_config_object_name

  content = "window.__PHOENIX_CONFIG__ = ${jsonencode({
    API_URL  = var.api_url
    USE_MOCK = var.use_mock
  })};\n"

  content_type  = "text/javascript; charset=utf-8"
  cache_control = "no-store"
}

resource "google_storage_bucket_object" "dist" {
  for_each = {
    for file_name in local.dist_files :
    file_name => file_name
    if file_name != var.runtime_config_object_name
  }

  bucket = google_storage_bucket.ui.name
  name   = each.value
  source = "${var.dist_dir}/${each.value}"

  content_type  = lookup(local.content_types, local.dist_file_extensions[each.value], "application/octet-stream")
  cache_control = startswith(each.value, "assets/") ? "public, max-age=31536000, immutable" : "no-cache"
}

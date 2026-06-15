output "bucket_name" {
  description = "Web UI 静的ホスティング用バケット名"
  value       = google_storage_bucket.ui.name
}

output "bucket_url" {
  description = "Web UI 静的ホスティング用バケット URL"
  value       = google_storage_bucket.ui.url
}

output "website_url" {
  description = "Web UI の GCS website endpoint URL"
  value       = "http://${google_storage_bucket.ui.name}.storage.googleapis.com"
}

output "index_url" {
  description = "Web UI の index.html 直リンク"
  value       = "https://storage.googleapis.com/${google_storage_bucket.ui.name}/index.html"
}

output "runtime_config_object_name" {
  description = "Terraform が生成する runtime config JavaScript"
  value       = google_storage_bucket_object.runtime_config.name
}

output "bucket_name" {
  description = "Web UI Cloud Functions source archive 用 GCS バケット名"
  value       = google_storage_bucket.ui.name
}

output "bucket_url" {
  description = "Web UI Cloud Functions source archive 用 GCS バケット URL"
  value       = google_storage_bucket.ui.url
}

output "function_name" {
  description = "Web UI Cloud Functions 名"
  value       = google_cloudfunctions2_function.ui.name
}

output "function_uri" {
  description = "Web UI HTTPS URI"
  value       = google_cloudfunctions2_function.ui.service_config[0].uri
}

output "source_archive_name" {
  description = "Web UI source archive object name"
  value       = google_storage_bucket_object.source_archive.name
}

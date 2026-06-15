output "function_name" {
  description = "HTTP API Cloud Functions 名"
  value       = google_cloudfunctions2_function.api.name
}

output "function_uri" {
  description = "HTTP API HTTPS URI"
  value       = google_cloudfunctions2_function.api.service_config[0].uri
}

output "source_bucket_name" {
  description = "HTTP API source archive 用 GCS バケット名"
  value       = google_storage_bucket.source.name
}

output "service_account_email" {
  description = "HTTP API 実行用サービスアカウント"
  value       = google_service_account.api.email
}

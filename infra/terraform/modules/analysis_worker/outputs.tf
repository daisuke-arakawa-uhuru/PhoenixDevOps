output "function_name" {
  description = "解析ワーカー Cloud Functions 名"
  value       = google_cloudfunctions2_function.worker.name
}

output "function_uri" {
  description = "Cloud Tasks から呼び出す解析ワーカー HTTPS URI"
  value       = google_cloudfunctions2_function.worker.service_config[0].uri
}

output "source_bucket_name" {
  description = "Cloud Functions source archive 用 GCS バケット名"
  value       = google_storage_bucket.source.name
}

output "worker_service_account_email" {
  description = "解析ワーカー実行用サービスアカウント"
  value       = google_service_account.worker.email
}

output "task_invoker_service_account_email" {
  description = "Cloud Tasks OIDC token に指定する呼び出し用サービスアカウント"
  value       = google_service_account.task_invoker.email
}

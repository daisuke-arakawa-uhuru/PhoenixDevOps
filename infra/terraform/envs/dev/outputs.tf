output "assets_bucket_name" {
  description = "アセット用 Cloud Storage バケット名"
  value       = module.storage.bucket_name
}

output "uploads_prefix" {
  description = "アップロード（ソースコード群・既存ドキュメント群）の保存先プレフィックス"
  value       = module.storage.uploads_prefix
}

output "results_prefix" {
  description = "生成成果物の保存先プレフィックス"
  value       = module.storage.results_prefix
}

output "analysis_queue_name" {
  description = "解析ジョブ用 Cloud Tasks キュー名"
  value       = module.tasks.queue_name
}

output "firestore_database_name" {
  description = "Firestore データベース名"
  value       = module.firestore.database_name
}

output "analysis_worker_function_name" {
  description = "解析ワーカー Cloud Functions 名"
  value       = module.analysis_worker.function_name
}

output "analysis_worker_function_uri" {
  description = "Cloud Tasks から呼び出す解析ワーカー HTTPS URI"
  value       = module.analysis_worker.function_uri
}

output "analysis_worker_source_bucket_name" {
  description = "解析ワーカー source archive 用 GCS バケット名"
  value       = module.analysis_worker.source_bucket_name
}

output "analysis_worker_service_account_email" {
  description = "解析ワーカー実行用サービスアカウント"
  value       = module.analysis_worker.worker_service_account_email
}

output "analysis_task_invoker_service_account_email" {
  description = "Cloud Tasks OIDC token に指定する呼び出し用サービスアカウント"
  value       = module.analysis_worker.task_invoker_service_account_email
}

output "api_function_name" {
  description = "HTTP API Cloud Functions 名"
  value       = module.api.function_name
}

output "api_function_uri" {
  description = "Web UI から呼び出す HTTP API HTTPS URI"
  value       = module.api.function_uri
}

output "api_source_bucket_name" {
  description = "HTTP API source archive 用 GCS バケット名"
  value       = module.api.source_bucket_name
}

output "api_service_account_email" {
  description = "HTTP API 実行用サービスアカウント"
  value       = module.api.service_account_email
}

output "ui_hosting_bucket_name" {
  description = "Web UI 静的ホスティング用 GCS バケット名"
  value       = module.ui_hosting.bucket_name
}

output "ui_hosting_website_url" {
  description = "Web UI の GCS website endpoint URL"
  value       = module.ui_hosting.website_url
}

output "ui_hosting_index_url" {
  description = "Web UI の index.html 直リンク"
  value       = module.ui_hosting.index_url
}

output "ui_runtime_config_object_name" {
  description = "Terraform が生成する Web UI runtime config JavaScript"
  value       = module.ui_hosting.runtime_config_object_name
}

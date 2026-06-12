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
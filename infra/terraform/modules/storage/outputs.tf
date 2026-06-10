output "bucket_name" {
  description = "バケット名"
  value       = google_storage_bucket.assets.name
}

output "bucket_url" {
  description = "バケットの gs:// URL"
  value       = google_storage_bucket.assets.url
}

output "uploads_prefix" {
  description = "アップロード保存先プレフィックス"
  value       = "uploads/"
}

output "results_prefix" {
  description = "生成成果物の保存先プレフィックス"
  value       = "results/"
}
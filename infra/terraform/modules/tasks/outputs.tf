output "queue_id" {
  description = "Cloud Tasks キューの完全 ID（projects/.../locations/.../queues/...）"
  value       = google_cloud_tasks_queue.analysis.id
}

output "queue_name" {
  description = "キュー名"
  value       = google_cloud_tasks_queue.analysis.name
}
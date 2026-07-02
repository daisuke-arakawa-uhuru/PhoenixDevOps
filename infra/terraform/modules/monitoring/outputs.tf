output "notification_channel_ids" {
  description = "作成したメール通知チャネルの ID 一覧"
  value       = [for ch in google_monitoring_notification_channel.email : ch.id]
}

output "worker_error_alert_policy_name" {
  description = "解析ワーカーのエラーログアラートポリシー名"
  value       = google_monitoring_alert_policy.worker_errors.name
}

output "api_error_alert_policy_name" {
  description = "HTTP API のエラーログアラートポリシー名"
  value       = google_monitoring_alert_policy.api_errors.name
}

output "worker_execution_failure_alert_policy_name" {
  description = "解析ワーカーの実行失敗（タイムアウト/クラッシュ）アラートポリシー名"
  value       = google_monitoring_alert_policy.worker_execution_failures.name
}

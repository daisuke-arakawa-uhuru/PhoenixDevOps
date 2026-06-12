# 解析ジョブ用の Cloud Tasks キュー。
# API(Cloud Functions) がジョブをこのキューに積み、解析ワーカー(Cloud Functions) を
# HTTP で非同期起動する。リトライ・流量制御をここで一元管理する。
#
# 責任分界: ワーカーを HTTP 起動する際の OIDC トークン・呼び出しサービスアカウントは
# 「タスク投入時」にアプリ側（API のコード）が付与する設計のため、このモジュールでは扱わない。
# キュー自体の挙動（流量・リトライ・ログ）のみをここで管理する。
resource "google_cloud_tasks_queue" "analysis" {
  project  = var.project_id
  name     = var.queue_name
  location = var.location

  # 流量制御: ワーカーや Gemini API への過負荷を防ぐ
  rate_limits {
    max_dispatches_per_second = var.max_dispatches_per_second
    max_concurrent_dispatches = var.max_concurrent_dispatches
  }

  # リトライ制御: 無限リトライを避け、指数バックオフで上限を設ける
  retry_config {
    max_attempts  = var.max_attempts
    min_backoff   = var.min_backoff
    max_backoff   = var.max_backoff
    max_doublings = var.max_doublings
  }

  # 実行ログのサンプリング（dev は全件記録して挙動を追いやすくする）
  stackdriver_logging_config {
    sampling_ratio = var.logging_sampling_ratio
  }
}
# PhoenixDevOps 監視モジュール
# Cloud Monitoring / Cloud Logging を用いて解析ワーカーと HTTP API を継続的に監視する。
# アラートはメール通知チャネル経由で担当者に届く。

locals {
  notification_channel_ids = [for ch in google_monitoring_notification_channel.email : ch.id]
}

# ── メール通知チャネル ────────────────────────────────────────────────────────

resource "google_monitoring_notification_channel" "email" {
  for_each = toset(var.alert_email_addresses)

  project      = var.project_id
  display_name = "PhoenixDevOps Alerts → ${each.value}"
  type         = "email"

  labels = {
    email_address = each.value
  }
}

# ── ログベースメトリクス ──────────────────────────────────────────────────────
# Cloud Functions Gen2 の実行ログは resource.type="cloud_run_revision" として記録され、
# 関数名は service_name ラベルに入る（function_name ラベルは Gen1 のみ）。

resource "google_logging_metric" "worker_errors" {
  name    = "${var.name_prefix}-worker-errors"
  project = var.project_id

  # ERROR 以上の重大度を持つ解析ワーカーログをカウント
  filter = join("\n", [
    "resource.type=\"cloud_run_revision\"",
    "resource.labels.service_name=\"${var.worker_function_name}\"",
    "severity>=ERROR",
  ])

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    unit         = "1"
    display_name = "[${var.name_prefix}] Analysis Worker Error Logs"
  }
}

resource "google_logging_metric" "api_errors" {
  name    = "${var.name_prefix}-api-errors"
  project = var.project_id

  filter = join("\n", [
    "resource.type=\"cloud_run_revision\"",
    "resource.labels.service_name=\"${var.api_function_name}\"",
    "severity>=ERROR",
  ])

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    unit         = "1"
    display_name = "[${var.name_prefix}] HTTP API Error Logs"
  }
}

# ── アラートポリシー ──────────────────────────────────────────────────────────

# 解析ワーカー: エラーログ検出アラート
# 5分間に var.worker_error_threshold 件を超えた時点で通知する。
# 解析には最長 540秒かかるため、1件でもエラーが出たら早期に気付けるよう閾値を低く設定している。
resource "google_monitoring_alert_policy" "worker_errors" {
  project      = var.project_id
  display_name = "[PhoenixDevOps] 解析ワーカー エラー発生"
  combiner     = "OR"
  enabled      = length(var.alert_email_addresses) > 0

  conditions {
    display_name = "Worker ERROR log count > ${var.worker_error_threshold} (5min)"

    condition_threshold {
      # Monitoring API の閾値条件フィルタは resource.type の指定が必須。
      # ログベースメトリクスの時系列は元ログのリソースタイプ（Gen2 = cloud_run_revision）を引き継ぐ。
      filter = join(" AND ", [
        "resource.type = \"cloud_run_revision\"",
        "metric.type = \"logging.googleapis.com/user/${var.name_prefix}-worker-errors\"",
      ])
      comparison      = "COMPARISON_GT"
      duration        = "0s"
      threshold_value = var.worker_error_threshold - 1

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }

  # notification_rate_limit はログマッチ条件専用のためメトリクス閾値条件では使用しない。
  # 通知ノイズは条件解消後の自動クローズ（30分）で抑える。
  alert_strategy {
    auto_close = "1800s"
  }

  notification_channels = local.notification_channel_ids

  documentation {
    content   = <<-EOT
      ## 解析ワーカー エラー発生アラート

      **対象**: `${var.worker_function_name}` (Cloud Functions)

      ### 確認手順
      1. [Cloud Logging](https://console.cloud.google.com/logs) でフィルタを適用してエラーログを確認する
         ```
         resource.type="cloud_run_revision"
         resource.labels.service_name="${var.worker_function_name}"
         severity>=ERROR
         ```
      2. `jsonPayload.message` や `textPayload` でエラー内容を特定する
      3. Gemini API エラーの場合は API キーの有効性・クォータ残量を確認する
      4. タイムアウト (`DeadlineExceeded`) の場合はソースコードの規模を確認し、`MAX_FILES` / `MAX_CHARS_PER_FILE` 環境変数で制限をかける

      ### エスカレーション
      30分以内に解消しない場合は担当者 (Arakawa) へエスカレーションすること。
    EOT
    mime_type = "text/markdown"
  }
}

# HTTP API: エラーログ検出アラート
resource "google_monitoring_alert_policy" "api_errors" {
  project      = var.project_id
  display_name = "[PhoenixDevOps] HTTP API エラー発生"
  combiner     = "OR"
  enabled      = length(var.alert_email_addresses) > 0

  conditions {
    display_name = "API ERROR log count > ${var.api_error_threshold} (5min)"

    condition_threshold {
      filter = join(" AND ", [
        "resource.type = \"cloud_run_revision\"",
        "metric.type = \"logging.googleapis.com/user/${var.name_prefix}-api-errors\"",
      ])
      comparison      = "COMPARISON_GT"
      duration        = "0s"
      threshold_value = var.api_error_threshold - 1

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }

  alert_strategy {
    auto_close = "1800s"
  }

  notification_channels = local.notification_channel_ids

  documentation {
    content   = <<-EOT
      ## HTTP API エラー発生アラート

      **対象**: `${var.api_function_name}` (Cloud Functions)

      ### 確認手順
      1. [Cloud Logging](https://console.cloud.google.com/logs) でフィルタを適用してエラーログを確認する
         ```
         resource.type="cloud_run_revision"
         resource.labels.service_name="${var.api_function_name}"
         severity>=ERROR
         ```
      2. HTTP ステータスコードと `httpRequest.status` を確認する
      3. Firestore 接続エラーの場合は IAM バインディングと Firestore の状態を確認する
      4. Cloud Tasks キューへの投入エラーの場合はキューの状態を確認する
    EOT
    mime_type = "text/markdown"
  }
}

# 解析ワーカー実行失敗: タイムアウト・クラッシュ検出アラート
# Cloud Functions Gen2 は Cloud Run 上で動作するため、Gen1 用の
# cloudfunctions.googleapis.com/function/execution_count ではなく
# Cloud Run の request_count（5xx: クラッシュ=500 / タイムアウト=504）を監視する。
resource "google_monitoring_alert_policy" "worker_execution_failures" {
  project      = var.project_id
  display_name = "[PhoenixDevOps] 解析ワーカー 実行失敗（タイムアウト/クラッシュ）"
  combiner     = "OR"
  enabled      = length(var.alert_email_addresses) > 0

  conditions {
    display_name = "Worker 5xx responses"

    condition_threshold {
      filter = join(" AND ", [
        "resource.type = \"cloud_run_revision\"",
        "resource.labels.service_name = \"${var.worker_function_name}\"",
        "metric.type = \"run.googleapis.com/request_count\"",
        "metric.labels.response_code_class = \"5xx\"",
      ])
      comparison      = "COMPARISON_GT"
      duration        = "0s"
      threshold_value = 0

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }

  alert_strategy {
    auto_close = "1800s"
  }

  notification_channels = local.notification_channel_ids

  documentation {
    content   = <<-EOT
      ## 解析ワーカー 実行失敗アラート（タイムアウト/クラッシュ）

      **対象**: `${var.worker_function_name}` (Cloud Functions Gen2 / Cloud Run)

      `504` が多発する場合はタイムアウトです。解析対象ファイル数・サイズが上限を超えている可能性があります。
      `500` の場合はランタイムエラー（クラッシュ）です。Cloud Logging で詳細を確認してください。
    EOT
    mime_type = "text/markdown"
  }
}

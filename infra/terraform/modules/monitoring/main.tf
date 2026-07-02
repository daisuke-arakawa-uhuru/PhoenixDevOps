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
# Cloud Functions Gen2 のログは Cloud Run リビジョンとして記録される。
# 関数名はサービス名と一致するため function_name ラベルで絞り込む。

resource "google_logging_metric" "worker_errors" {
  name    = "${var.name_prefix}-worker-errors"
  project = var.project_id

  # ERROR 以上の重大度を持つ解析ワーカーログをカウント
  filter = join("\n", [
    "resource.labels.function_name=\"${var.worker_function_name}\"",
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
    "resource.labels.function_name=\"${var.api_function_name}\"",
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
      # ログベースメトリクスは resource.type="global" で集計されるため resource.type の絞り込みは不要
      filter          = "metric.type=\"logging.googleapis.com/user/${var.name_prefix}-worker-errors\""
      comparison      = "COMPARISON_GT"
      duration        = "0s"
      threshold_value = var.worker_error_threshold - 1

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }

  alert_strategy {
    # 連続アラートのノイズを抑えるため同一条件で 1時間に 1通のみ通知する
    notification_rate_limit {
      period = "3600s"
    }
  }

  notification_channels = local.notification_channel_ids

  documentation {
    content   = <<-EOT
      ## 解析ワーカー エラー発生アラート

      **対象**: `${var.worker_function_name}` (Cloud Functions)

      ### 確認手順
      1. [Cloud Logging](https://console.cloud.google.com/logs) でフィルタを適用してエラーログを確認する
         ```
         resource.labels.function_name="${var.worker_function_name}"
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
      filter          = "metric.type=\"logging.googleapis.com/user/${var.name_prefix}-api-errors\""
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
    notification_rate_limit {
      period = "1800s"
    }
  }

  notification_channels = local.notification_channel_ids

  documentation {
    content   = <<-EOT
      ## HTTP API エラー発生アラート

      **対象**: `${var.api_function_name}` (Cloud Functions)

      ### 確認手順
      1. [Cloud Logging](https://console.cloud.google.com/logs) でフィルタを適用してエラーログを確認する
         ```
         resource.labels.function_name="${var.api_function_name}"
         severity>=ERROR
         ```
      2. HTTP ステータスコードと `httpRequest.status` を確認する
      3. Firestore 接続エラーの場合は IAM バインディングと Firestore の状態を確認する
      4. Cloud Tasks キューへの投入エラーの場合はキューの状態を確認する
    EOT
    mime_type = "text/markdown"
  }
}

# Cloud Functions 実行回数: タイムアウト・クラッシュ検出アラート
# ログベースではなく CF ネイティブメトリクスで実行ステータスを監視する
resource "google_monitoring_alert_policy" "worker_execution_failures" {
  project      = var.project_id
  display_name = "[PhoenixDevOps] 解析ワーカー 実行失敗（タイムアウト/クラッシュ）"
  combiner     = "OR"
  enabled      = length(var.alert_email_addresses) > 0

  conditions {
    display_name = "Worker function non-ok executions"

    condition_threshold {
      # status が ok 以外（error / timeout / crash / connection_error）の実行をカウント
      filter = join(" AND ", [
        "resource.type = \"cloud_function\"",
        "resource.labels.function_name = \"${var.worker_function_name}\"",
        "metric.type = \"cloudfunctions.googleapis.com/function/execution_count\"",
        "(metric.labels.status = \"error\" OR metric.labels.status = \"timeout\" OR metric.labels.status = \"crash\" OR metric.labels.status = \"connection_error\")",
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
    notification_rate_limit {
      period = "3600s"
    }
  }

  notification_channels = local.notification_channel_ids

  documentation {
    content   = <<-EOT
      ## 解析ワーカー 実行失敗アラート（タイムアウト/クラッシュ）

      **対象**: `${var.worker_function_name}` (Cloud Functions)

      `timeout` が多発する場合は解析対象ファイル数・サイズが上限を超えている可能性があります。
      `crash` / `error` の場合はランタイムエラーです。Cloud Logging で詳細を確認してください。
    EOT
    mime_type = "text/markdown"
  }
}

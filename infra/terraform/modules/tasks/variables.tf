variable "project_id" {
  description = "GCP プロジェクト ID"
  type        = string
}

variable "location" {
  description = "Cloud Tasks キューのロケーション"
  type        = string
  default     = "asia-northeast1"
}

variable "queue_name" {
  description = "キュー名"
  type        = string
  default     = "analysis-job-queue"
}

variable "max_dispatches_per_second" {
  description = "1 秒あたりの最大ディスパッチ数（流量制御）"
  type        = number
  default     = 5
}

variable "max_concurrent_dispatches" {
  description = "同時実行ディスパッチの上限"
  type        = number
  default     = 10
}

variable "max_attempts" {
  description = "1 タスクの最大試行回数（リトライ含む）"
  type        = number
  default     = 5
}

variable "min_backoff" {
  description = "リトライ最小バックオフ"
  type        = string
  default     = "5s"
}

variable "max_backoff" {
  description = "リトライ最大バックオフ"
  type        = string
  default     = "300s"
}

variable "max_doublings" {
  description = "バックオフを倍化させる最大回数"
  type        = number
  default     = 4
}

variable "logging_sampling_ratio" {
  description = "Cloud Tasks 実行ログのサンプリング比率（0.0〜1.0）。dev は全件記録を想定。"
  type        = number
  default     = 1.0
}
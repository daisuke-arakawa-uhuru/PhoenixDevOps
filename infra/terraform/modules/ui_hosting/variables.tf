variable "project_id" {
  description = "GCP プロジェクト ID"
  type        = string
}

variable "bucket_name" {
  description = "Web UI Cloud Functions source archive 用 GCS バケット名（グローバル一意）"
  type        = string
}

variable "location" {
  description = "Web UI Cloud Functions のリージョン"
  type        = string
  default     = "asia-northeast1"
}

variable "force_destroy" {
  description = "true で中身があっても削除可能"
  type        = bool
  default     = false
}

variable "source_bucket_location" {
  description = "Web UI Cloud Functions source archive 用 GCS バケットのロケーション"
  type        = string
  default     = "ASIA-NORTHEAST1"
}

variable "function_name" {
  description = "Web UI Cloud Functions 名"
  type        = string
}

variable "runtime" {
  description = "Web UI Cloud Functions runtime"
  type        = string
  default     = "nodejs24"
}

variable "entry_point" {
  description = "Web UI Cloud Functions entry point"
  type        = string
  default     = "serveUi"
}

variable "allow_unauthenticated" {
  description = "true の場合、Web UI を unauthenticated で呼び出せるようにする"
  type        = bool
  default     = true
}

variable "source_dir" {
  description = "Web UI Cloud Functions source directory"
  type        = string
}

variable "available_memory" {
  description = "Web UI Cloud Functions に割り当てるメモリ"
  type        = string
  default     = "256Mi"
}

variable "available_cpu" {
  description = "Web UI Cloud Functions に割り当てる CPU。concurrency > 1 の場合は 1 以上が必要。"
  type        = string
  default     = "1"

  validation {
    condition     = can(tonumber(var.available_cpu)) && tonumber(var.available_cpu) >= 0.08 && tonumber(var.available_cpu) <= 8
    error_message = "available_cpu must be a numeric string between 0.08 and 8."
  }
}

variable "timeout_seconds" {
  description = "Web UI Cloud Functions のタイムアウト秒数"
  type        = number
  default     = 60
}

variable "min_instance_count" {
  description = "Web UI Cloud Functions の最小インスタンス数"
  type        = number
  default     = 0
}

variable "max_instance_count" {
  description = "Web UI Cloud Functions の最大インスタンス数"
  type        = number
  default     = 3
}

variable "max_instance_request_concurrency" {
  description = "Web UI 1 インスタンスあたりの最大同時リクエスト数"
  type        = number
  default     = 80
}

variable "ingress_settings" {
  description = "Web UI Cloud Functions の ingress 設定"
  type        = string
  default     = "ALLOW_ALL"
}

variable "source_archive_retention_days" {
  description = "Web UI source archive の保持日数"
  type        = number
  default     = 30
}

variable "api_url" {
  description = "ブラウザ実行時に UI が呼び出す HTTP API URL"
  type        = string
}

variable "use_mock" {
  description = "配信環境で UI のモックモードを有効化するか"
  type        = bool
  default     = false
}

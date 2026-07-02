variable "project_id" {
  description = "GCP プロジェクト ID"
  type        = string
}

variable "name_prefix" {
  description = "リソース名の共通プレフィックス（例: phoenixdevops-dev）"
  type        = string
}

variable "worker_function_name" {
  description = "解析ワーカー Cloud Functions の関数名"
  type        = string
}

variable "api_function_name" {
  description = "HTTP API Cloud Functions の関数名"
  type        = string
}

variable "alert_email_addresses" {
  description = "アラート通知先メールアドレス一覧"
  type        = list(string)
  default     = []
}

variable "worker_error_threshold" {
  description = "解析ワーカーのエラー実行回数アラート閾値（5分間）"
  type        = number
  default     = 1
}

variable "api_error_threshold" {
  description = "HTTP API のエラー実行回数アラート閾値（5分間）"
  type        = number
  default     = 3
}

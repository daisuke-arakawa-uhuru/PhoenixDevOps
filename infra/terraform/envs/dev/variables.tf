variable "project_id" {
  description = "GCP プロジェクト ID（山本担当のプロジェクトセットアップで払い出された値）"
  type        = string
}

variable "region" {
  description = "デフォルトリージョン（Cloud Tasks / Firestore 等に使用）"
  type        = string
  default     = "asia-northeast1"
}

variable "environment" {
  description = "環境識別子（リソース名のプレフィックスに使用）"
  type        = string
  default     = "dev"
}

variable "storage_location" {
  description = "Cloud Storage バケットのロケーション"
  type        = string
  default     = "ASIA-NORTHEAST1"
}

variable "force_destroy" {
  description = "true の場合、中身があってもバケットを削除可能にする。本番相当では false 固定。"
  type        = bool
  default     = false
}

variable "uploads_retention_days" {
  description = "uploads/ プレフィックス配下の保持日数（経過後に自動削除）"
  type        = number
  default     = 30
}

variable "results_retention_days" {
  description = "results/ プレフィックス配下の保持日数（経過後に自動削除）"
  type        = number
  default     = 90
}

variable "firestore_delete_protection" {
  description = "Firestore データベースの誤削除防止"
  type        = bool
  default     = true
}
variable "project_id" {
  description = "GCP プロジェクト ID"
  type        = string
}

variable "location" {
  description = "Firestore のロケーション（リージョナル: asia-northeast1 など / マルチリージョン: nam5, eur3）"
  type        = string
  default     = "asia-northeast1"
}

variable "database_name" {
  description = "Firestore データベース名。MVP では既定データベースを使用する。"
  type        = string
  default     = "(default)"
}

variable "delete_protection" {
  description = "データベースの誤削除防止"
  type        = bool
  default     = true
}
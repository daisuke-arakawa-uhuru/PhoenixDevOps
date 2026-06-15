variable "project_id" {
  description = "GCP プロジェクト ID"
  type        = string
}

variable "bucket_name" {
  description = "バケット名（グローバル一意）"
  type        = string
}

variable "location" {
  description = "バケットのロケーション"
  type        = string
  default     = "ASIA-NORTHEAST1"
}

variable "force_destroy" {
  description = "true で中身があっても削除可能"
  type        = bool
  default     = false
}

variable "uploads_retention_days" {
  description = "uploads/ プレフィックスの保持日数"
  type        = number
  default     = 30
}

variable "results_retention_days" {
  description = "results/ プレフィックスの保持日数"
  type        = number
  default     = 90
}

variable "archived_versions_to_keep" {
  description = "保持する旧バージョン世代数（これを超える古いバージョンは削除）"
  type        = number
  default     = 3
}

variable "cors_origins" {
  description = "署名付き URL のブラウザプレビューを許可する Origin 一覧。空配列で CORS を無効化"
  type        = list(string)
  default     = ["*"]
}

variable "cors_max_age_seconds" {
  description = "GCS CORS preflight のキャッシュ秒数"
  type        = number
  default     = 3600
}

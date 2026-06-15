variable "project_id" {
  description = "GCP プロジェクト ID"
  type        = string
}

variable "location" {
  description = "Cloud Functions のリージョン"
  type        = string
  default     = "asia-northeast1"
}

variable "function_name" {
  description = "HTTP API Cloud Functions 名"
  type        = string
  default     = "drift-api"
}

variable "source_dir" {
  description = "Cloud Functions にデプロイする API のソースディレクトリ"
  type        = string
}

variable "source_bucket_name" {
  description = "Cloud Functions source archive を配置する GCS バケット名"
  type        = string
}

variable "source_bucket_location" {
  description = "source archive 用 GCS バケットのロケーション"
  type        = string
  default     = "ASIA-NORTHEAST1"
}

variable "source_archive_retention_days" {
  description = "古い source archive を削除するまでの日数"
  type        = number
  default     = 30
}

variable "assets_bucket_name" {
  description = "uploads/results を保持する assets bucket 名"
  type        = string
}

variable "tasks_queue_name" {
  description = "解析ジョブを投入する Cloud Tasks queue 名"
  type        = string
}

variable "worker_url" {
  description = "Cloud Tasks から呼び出す解析ワーカー HTTPS URI"
  type        = string
}

variable "task_invoker_service_account_email" {
  description = "Cloud Tasks OIDC token に指定するワーカー呼び出し用サービスアカウント"
  type        = string
}

variable "runtime" {
  description = "Cloud Functions Node.js runtime"
  type        = string
  default     = "nodejs24"
}

variable "entry_point" {
  description = "Cloud Functions のエントリポイント"
  type        = string
  default     = "driftApi"
}

variable "api_service_account_id" {
  description = "HTTP API 実行用サービスアカウント ID"
  type        = string
  default     = "drift-api"
}

variable "available_memory" {
  description = "Cloud Functions に割り当てるメモリ"
  type        = string
  default     = "1Gi"
}

variable "timeout_seconds" {
  description = "Cloud Functions のタイムアウト秒数"
  type        = number
  default     = 300
}

variable "min_instance_count" {
  description = "Cloud Functions の最小インスタンス数"
  type        = number
  default     = 0
}

variable "max_instance_count" {
  description = "Cloud Functions の最大インスタンス数"
  type        = number
  default     = 3
}

variable "max_instance_request_concurrency" {
  description = "1 インスタンスあたりの最大同時リクエスト数"
  type        = number
  default     = 1
}

variable "ingress_settings" {
  description = "Cloud Functions の ingress 設定"
  type        = string
  default     = "ALLOW_ALL"
}

variable "allow_unauthenticated" {
  description = "true の場合、HTTP API を unauthenticated で呼び出せるようにする"
  type        = bool
  default     = true
}

variable "firestore_uploads_collection" {
  description = "アップロード状態を保存する Firestore コレクション名"
  type        = string
  default     = "uploads"
}

variable "firestore_jobs_collection" {
  description = "ジョブ状態を保存する Firestore コレクション名"
  type        = string
  default     = "jobs"
}

variable "signed_url_expiration_seconds" {
  description = "成果物署名付き URL の有効秒数"
  type        = number
  default     = 3600
}

variable "uploads_prefix_template" {
  description = "アップロード保存 prefix template"
  type        = string
  default     = "uploads/{upload_id}"
}

variable "results_prefix_template" {
  description = "成果物保存 prefix template"
  type        = string
  default     = "results/{job_id}"
}

variable "max_document_files" {
  description = "1 upload で受け付けるドキュメントファイル数上限"
  type        = number
  default     = 600
}

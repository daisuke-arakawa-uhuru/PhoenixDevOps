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
  description = "解析ワーカー Cloud Functions 名"
  type        = string
  default     = "analysis-worker"
}

variable "source_dir" {
  description = "Cloud Functions にデプロイする analysis-worker のソースディレクトリ"
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

variable "build_iam_propagation_wait_duration" {
  description = "Cloud Functions build service account の IAM 伝播待ち時間"
  type        = string
  default     = "90s"
}

variable "assets_bucket_name" {
  description = "uploads/results を保持する assets bucket 名"
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
  default     = "runAnalysisWorker"
}

variable "worker_service_account_id" {
  description = "解析ワーカー実行用サービスアカウント ID"
  type        = string
  default     = "analysis-worker"
}

variable "task_invoker_service_account_id" {
  description = "Cloud Tasks がワーカーを OIDC で呼び出すためのサービスアカウント ID"
  type        = string
  default     = "analysis-task-invoker"
}

variable "available_memory" {
  description = "Cloud Functions に割り当てるメモリ"
  type        = string
  default     = "1Gi"
}

variable "timeout_seconds" {
  description = "Cloud Functions のタイムアウト秒数"
  type        = number
  default     = 540
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

variable "firestore_jobs_collection" {
  description = "ジョブ状態を保存する Firestore コレクション名"
  type        = string
  default     = "jobs"
}

variable "results_prefix_template" {
  description = "成果物保存 prefix template"
  type        = string
  default     = "results/{job_id}"
}

variable "gemini_model" {
  description = "解析ワーカーが使用する Gemini model"
  type        = string
  default     = "gemini-3.1-flash-lite"
}

variable "gemini_dry_run" {
  description = "true の場合、Gemini API を呼び出さず dry-run client を使用する"
  type        = bool
  default     = false
}

variable "gemini_use_vertex_ai" {
  description = "true の場合、Gemini API の呼び出しに Vertex AI (ADC) を使用する"
  type        = bool
  default     = true
}

variable "gemini_location" {
  description = "Vertex AI Gemini endpoint location"
  type        = string
  default     = "global"
}

variable "gemini_api_key_secret_id" {
  description = "GEMINI_API_KEY として参照する Secret Manager secret ID。未指定時は環境変数を設定しない。"
  type        = string
  default     = null
}

variable "gemini_api_key_secret_version" {
  description = "GEMINI_API_KEY secret の version"
  type        = string
  default     = "latest"
}
